import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { parseAndValidateEventPayload } from '../../src/domain/events/EventSchemas';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Milestone 6: Offline Sync Recovery Requests (Kind 1505)', () => {
  const aliceSecretBytes = generateSecretKey();
  const aliceSecretHex = bytesToHex(aliceSecretBytes);
  const alicePubkey = getPublicKey(aliceSecretBytes);

  const bobSecretBytes = generateSecretKey();
  const bobPubkey = getPublicKey(bobSecretBytes);

  const evePubkey = getPublicKey(generateSecretKey());

  const groupRepo = new DexieGroupRepository();

  beforeEach(async () => {
    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.events.clear();
    await db.sync_queue.clear();

    await db.identities.add({
      pubkey: alicePubkey,
      secretKey: aliceSecretHex,
      displayName: 'Alice',
      isCurrent: 1,
      createdAt: Date.now(),
    });
  });

  it('validates Kind 1505 SYNC_REQUEST payload schema', () => {
    const rawPayload = {
      type: 'SYNC_REQUEST',
      groupId: 'grp_sync_100',
      sinceKeyVersion: 1,
      knownEventIds: ['evt_1', 'evt_2'],
      requestedAt: 1700000000,
    };

    const validated = parseAndValidateEventPayload(1505, rawPayload);
    expect(validated.type).toBe('SYNC_REQUEST');
    expect(validated.groupId).toBe('grp_sync_100');
    expect(validated.knownEventIds).toHaveLength(2);
  });

  it('handleSyncRequest re-sends missing key envelopes and events for authorized member', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_sync_200';

    const group = new Group({
      id: groupId,
      name: 'Sync Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
        new Member({ pubkey: new Pubkey(bobPubkey), displayName: 'Bob', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    // Initialize key V1 and rotate to V2
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey]);
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey]);

    const histEventId = '0f'.repeat(32);

    // Store a historical event in db.events
    await db.events.put({
      id: histEventId,
      kind: 1501,
      pubkey: alicePubkey,
      createdAt: 1010,
      groupId,
      parentEventIdsJson: '[]',
      rawEvent: JSON.stringify({
        id: histEventId,
        kind: 1501,
        pubkey: alicePubkey,
        created_at: 1010,
        tags: [['d', groupId]],
        content: '{}',
        sig: '00'.repeat(64),
      }),
    });

    await db.sync_queue.clear();

    const spyEnqueue = vi.spyOn(syncCoordinator, 'enqueueSignedEvent');

    // Bob requests sync from sinceKeyVersion 1, missing histEventId
    await syncCoordinator.handleSyncRequest(bobPubkey, {
      type: 'SYNC_REQUEST',
      groupId,
      sinceKeyVersion: 1,
      knownEventIds: [],
      requestedAt: Date.now(),
    });

    expect(spyEnqueue).toHaveBeenCalled();
    const enqueuedKinds = spyEnqueue.mock.calls.map((call) => call[0].kind);
    expect(enqueuedKinds).toContain(1059);
    expect(enqueuedKinds).toContain(1501);
  });

  it('handleSyncRequest rejects recovery requests from non-members', async () => {
    const groupId = 'grp_sync_300';

    const group = new Group({
      id: groupId,
      name: 'Private Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    await db.sync_queue.clear();

    // Eve (non-member) requests sync
    await syncCoordinator.handleSyncRequest(evePubkey, {
      type: 'SYNC_REQUEST',
      groupId,
      sinceKeyVersion: 0,
      knownEventIds: [],
      requestedAt: 1020,
    });

    const queueItems = await db.sync_queue.toArray();
    expect(queueItems).toHaveLength(0);
  });
});
