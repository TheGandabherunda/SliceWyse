import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import { EventReducer } from '../../src/domain/services/EventReducer';

describe('ADR-005 Commit 1A: SyncCoordinator Pipeline APIs', () => {
  const mockIdentity = {
    pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
    secretKey: '2222222222222222222222222222222222222222222222222222222222222222',
    displayName: 'Test User',
    isExtension: false,
    isCurrent: 1,
    createdAt: Date.now(),
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    await db.events.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.expenses.clear();
    await db.settlements.clear();
    await db.group_keys.clear();
    await db.sync_queue.clear();
    await db.identities.clear();

    await db.identities.add(mockIdentity);

    // Provide a valid group key in db.group_keys for group encryption
    await db.group_keys.add({
      groupId: 'grp_pipeline_100',
      keyVersion: 1,
      groupKeyHex: '3333333333333333333333333333333333333333333333333333333333333333',
      createdAt: Date.now(),
    });

    vi.spyOn(syncCoordinator as any, 'processSyncQueue').mockResolvedValue(undefined);
  });

  it('successful local submission via submitLocalEvent() validates, persists to db.events, reduces to db.groups/db.members, and enqueues to db.sync_queue', async () => {
    const payload = {
      type: 'GROUP_CREATED',
      groupId: 'grp_pipeline_100',
      name: 'Pipeline Test Group',
      currency: 'USD',
      members: [
        {
          pubkey: mockIdentity.pubkey,
          displayName: mockIdentity.displayName,
          joinedAt: Date.now(),
        },
      ],
      keyVersion: 1,
      parentEventIds: [],
      createdAt: Date.now(),
    };

    const validated = await syncCoordinator.submitLocalEvent({
      groupId: 'grp_pipeline_100',
      eventKind: 1500,
      unencryptedPayload: payload,
      parentEventIds: [],
    });

    expect(validated.isValid).toBe(true);
    expect(validated.groupId).toBe('grp_pipeline_100');

    // 1. Verify db.events contains the signed Nostr event
    const storedEvent = await db.events.get(validated.event.id);
    expect(storedEvent).toBeDefined();
    expect(storedEvent?.kind).toBe(1500);

    // 2. Verify projections were reduced via EventReducer
    const storedGroup = await db.groups.get('grp_pipeline_100');
    expect(storedGroup).toBeDefined();
    expect(storedGroup?.name).toBe('Pipeline Test Group');

    const storedMembers = await db.members.where({ groupId: 'grp_pipeline_100' }).toArray();
    expect(storedMembers).toHaveLength(1);
    expect(storedMembers[0].pubkey).toBe(mockIdentity.pubkey);

    // 3. Verify sync_queue item exists
    const queueItems = await db.sync_queue.toArray();
    expect(queueItems).toHaveLength(1);
    expect(queueItems[0].eventId).toBe(validated.event.id);
  });

  it('publishSignalEvent() signs and queues operational signals without invoking EventReducer or writing to projections', async () => {
    const joinPayload = {
      type: 'JOIN_REQUEST',
      groupId: 'grp_pipeline_100',
      joiningMember: {
        pubkey: mockIdentity.pubkey,
        displayName: mockIdentity.displayName,
      },
      invitationKeyVersion: 1,
      requestedAt: Date.now(),
    };

    const reduceSpy = vi.spyOn(EventReducer, 'reduceGroup');

    const eventId = await syncCoordinator.publishSignalEvent({
      groupId: 'grp_pipeline_100',
      eventKind: 1504,
      unencryptedPayload: joinPayload,
      parentEventIds: [],
      recipientPubkeys: ['4444444444444444444444444444444444444444444444444444444444444444'],
    });

    expect(eventId).toBeDefined();
    expect(typeof eventId).toBe('string');

    // Verify EventReducer was NEVER called
    expect(reduceSpy).not.toHaveBeenCalled();

    // Verify projection tables remain unchanged
    const storedGroup = await db.groups.get('grp_pipeline_100');
    expect(storedGroup).toBeUndefined();

    // Verify queue item exists in db.sync_queue
    const queueItems = await db.sync_queue.toArray();
    expect(queueItems).toHaveLength(1);
    expect(queueItems[0].eventKind).toBe(1504);
  });

  it('transaction rollback: errors during projection reduction abort Dexie transaction atomically', async () => {
    const payload = {
      type: 'GROUP_CREATED',
      groupId: 'grp_pipeline_100',
      name: 'Rollback Test Group',
      currency: 'USD',
      members: [
        {
          pubkey: mockIdentity.pubkey,
          displayName: mockIdentity.displayName,
          joinedAt: Date.now(),
        },
      ],
      keyVersion: 1,
      parentEventIds: [],
      createdAt: Date.now(),
    };

    // Force an error inside persistAndReduceValidatedEvent to trigger transaction abort
    vi.spyOn(syncCoordinator as any, 'persistAndReduceValidatedEvent').mockRejectedValue(
      new Error('Simulated Reduction Failure')
    );

    await expect(
      syncCoordinator.submitLocalEvent({
        groupId: 'grp_pipeline_100',
        eventKind: 1500,
        unencryptedPayload: payload,
        parentEventIds: [],
      })
    ).rejects.toThrow('Simulated Reduction Failure');

    // Verify COMPLETE ROLLBACK: 0 events, 0 groups, 0 queue items
    const eventsCount = await db.events.count();
    const groupsCount = await db.groups.count();
    const queueCount = await db.sync_queue.count();

    expect(eventsCount).toBe(0);
    expect(groupsCount).toBe(0);
    expect(queueCount).toBe(0);
  });

  it('reduction invariant: submitLocalEvent() routes reduction strictly through persistAndReduceValidatedEvent()', async () => {
    const payload = {
      type: 'GROUP_CREATED',
      groupId: 'grp_pipeline_100',
      name: 'Invariant Group',
      currency: 'USD',
      members: [
        {
          pubkey: mockIdentity.pubkey,
          displayName: mockIdentity.displayName,
          joinedAt: Date.now(),
        },
      ],
      keyVersion: 1,
      parentEventIds: [],
      createdAt: Date.now(),
    };

    const persistSpy = vi.spyOn(syncCoordinator as any, 'persistAndReduceValidatedEvent');

    await syncCoordinator.submitLocalEvent({
      groupId: 'grp_pipeline_100',
      eventKind: 1500,
      unencryptedPayload: payload,
      parentEventIds: [],
    });

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  describe('Commit 1B: Self-Echo & Duplicate Ingestion Deduplication', () => {
    it('relay echo of a locally-authored event is ignored without re-validation, re-reduction, or UI notifications', async () => {
      const payload = {
        type: 'GROUP_CREATED',
        groupId: 'grp_pipeline_100',
        name: 'Echo Test Group',
        currency: 'USD',
        members: [
          {
            pubkey: mockIdentity.pubkey,
            displayName: mockIdentity.displayName,
            joinedAt: Date.now(),
          },
        ],
        keyVersion: 1,
        parentEventIds: [],
        createdAt: Date.now(),
      };

      // 1. Author local event via submitLocalEvent
      const validated = await syncCoordinator.submitLocalEvent({
        groupId: 'grp_pipeline_100',
        eventKind: 1500,
        unencryptedPayload: payload,
        parentEventIds: [],
      });

      // Reset spies to monitor duplicate relay echo
      const validateSpy = vi.spyOn(
        await import('../../src/domain/services/EventValidationPipeline'),
        'EventValidationPipeline'
      );
      const persistSpy = vi.spyOn(syncCoordinator as any, 'persistAndReduceValidatedEvent');
      const listenerSpy = vi.fn();
      syncCoordinator.subscribe(listenerSpy);

      // 2. Simulate relay echo delivering the exact same event back over WebSocket
      await (syncCoordinator as any).ingestEvent(validated.event);

      // 3. Assert zero re-validation, zero re-reduction, zero listener notifications
      expect(persistSpy).not.toHaveBeenCalled();
      expect(listenerSpy).not.toHaveBeenCalled();

      // Assert event store count remains exactly 1
      const eventsCount = await db.events.count();
      expect(eventsCount).toBe(1);
    });

    it('duplicate remote delivery returns early without re-reducing or modifying IndexedDB', async () => {
      const remoteEvent = {
        id: 'evt_remote_dup_9999',
        kind: 1500,
        pubkey: '5555555555555555555555555555555555555555555555555555555555555555',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'grp_pipeline_100'],
          ['k', '1'],
        ],
        content: 'encrypted_content',
        sig: '6666666666666666666666666666666666666666666666666666666666666666',
      };

      // Pre-seed event in db.events to simulate Tier 2 IndexedDB cold storage hit
      await db.events.add({
        id: remoteEvent.id,
        kind: remoteEvent.kind,
        pubkey: remoteEvent.pubkey,
        createdAt: remoteEvent.created_at,
        groupId: 'grp_pipeline_100',
        parentEventIdsJson: '[]',
        rawEvent: JSON.stringify(remoteEvent),
        keyVersion: 1,
      });

      const persistSpy = vi.spyOn(syncCoordinator as any, 'persistAndReduceValidatedEvent');
      const listenerSpy = vi.fn();
      syncCoordinator.subscribe(listenerSpy);

      // Ingest duplicate remote event
      await (syncCoordinator as any).ingestEvent(remoteEvent);

      // Assert early return at Tier 2
      expect(persistSpy).not.toHaveBeenCalled();
      expect(listenerSpy).not.toHaveBeenCalled();

      // Ingest second time to hit Tier 1 in-memory Set
      await (syncCoordinator as any).ingestEvent(remoteEvent);
      expect(persistSpy).not.toHaveBeenCalled();
      expect(listenerSpy).not.toHaveBeenCalled();
    });
  });
});
