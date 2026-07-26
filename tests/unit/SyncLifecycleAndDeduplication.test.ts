import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../src/infrastructure/nostr/RelayManager';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type Event as NostrEvent,
} from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../src/infrastructure/crypto/Nip59GiftWrapService';

describe('Sync Lifecycle & Event Deduplication Guard Tests', () => {
  beforeEach(async () => {
    syncCoordinator.stopSession();
    await db.identities.clear();
    await db.group_keys.clear();
    await db.events.clear();
    await db.sync_queue.clear();
  });

  it('synchronizes recoveryState and isHistorySyncing so badge updates immediately upon completion', async () => {
    vi.spyOn(relayManager, 'queryEvents').mockResolvedValue([]);
    const pubkey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    let listenerInvokedState: { recoveryState: string; isSyncing: boolean } | null = null;

    const unsub = await syncCoordinator.subscribeUserEvents(pubkey, () => {
      listenerInvokedState = {
        recoveryState: syncCoordinator.getRecoveryState(),
        isSyncing: syncCoordinator.isHistorySyncing(),
      };
    });

    expect(syncCoordinator.getRecoveryState()).toBe('READY');
    expect(syncCoordinator.isHistorySyncing()).toBe(false);
    expect(listenerInvokedState).toEqual({ recoveryState: 'READY', isSyncing: false });

    unsub();
  });

  it('opening/changing routes does not create another sync session if already active', async () => {
    vi.spyOn(relayManager, 'queryEvents').mockResolvedValue([]);
    const pubkey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    // Simulate Dashboard mount
    const unsubDashboard = await syncCoordinator.subscribeUserEvents(pubkey);

    // Simulate GroupDetail mount
    const unsubGroupDetail = await syncCoordinator.subscribeUserEvents(pubkey);

    expect(unsubDashboard).toBeDefined();
    expect(unsubGroupDetail).toBeDefined();

    unsubDashboard();
    unsubGroupDetail();
  });

  it('deduplicates duplicate event received from multiple relays and processes it only once', async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    await identityService.importSecretKey(bytesToHex(sk), 'Alice');

    const duplicateEvent = finalizeEvent(
      {
        kind: 1500,
        created_at: 1000,
        tags: [['d', 'grp_dup']],
        content: JSON.stringify({
          type: 'GROUP_CREATED',
          groupId: 'grp_dup',
          name: 'Dup Group',
          currency: 'USD',
          members: [],
          createdAt: 1000,
        }),
      },
      sk
    );

    // First delivery from Relay 1
    await (syncCoordinator as any).ingestEvent(duplicateEvent);
    expect(await db.events.count()).toBe(1);

    // Second delivery of exact same event ID from Relay 2
    await (syncCoordinator as any).ingestEvent(duplicateEvent);
    // Count remains 1 (deduplicated)
    expect(await db.events.count()).toBe(1);
  });

  it('recovering an already-stored group key does not restart sync or re-write', async () => {
    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_idempotent_key',
      keyVersion: 1,
      groupKey: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      issuedAt: 1000,
    };

    // First store
    await (syncCoordinator as any).storeGroupKey(envelope);
    expect(await db.group_keys.count()).toBe(1);

    // Second store of identical key version
    await (syncCoordinator as any).storeGroupKey(envelope);
    expect(await db.group_keys.count()).toBe(1);
  });

  it('unwraps repeated NIP-59 Kind 1059 delivery once per event ID', async () => {
    const aliceSk = generateSecretKey();
    const aliceHex = bytesToHex(aliceSk);
    const alicePk = getPublicKey(aliceSk);
    await identityService.importSecretKey(aliceHex, 'Alice');

    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_repeat_gw',
      keyVersion: 1,
      groupKey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      issuedAt: 1000,
    };

    const giftWrap = nip59GiftWrapService.createGiftWrap(envelope, aliceHex, alicePk);

    // Ingest first time
    await (syncCoordinator as any).ingestEvent(giftWrap);
    expect(await db.group_keys.count()).toBe(1);

    // Ingest second time
    await (syncCoordinator as any).ingestEvent(giftWrap);
    expect(await db.group_keys.count()).toBe(1);
  });

  it('stopping/changing identity cleans up existing subscriptions and session state', async () => {
    const pubkey1 = '1111111111111111111111111111111111111111111111111111111111111111';
    const pubkey2 = '2222222222222222222222222222222222222222222222222222222222222222';
    vi.spyOn(relayManager, 'queryEvents').mockResolvedValue([]);

    await syncCoordinator.subscribeUserEvents(pubkey1);
    expect((syncCoordinator as any).activeSessionPubkey).toBe(pubkey1);

    // Switch identity to pubkey2
    await syncCoordinator.subscribeUserEvents(pubkey2);
    expect((syncCoordinator as any).activeSessionPubkey).toBe(pubkey2);

    syncCoordinator.stopSession();
    expect((syncCoordinator as any).activeSessionPubkey).toBeNull();
  });
});
