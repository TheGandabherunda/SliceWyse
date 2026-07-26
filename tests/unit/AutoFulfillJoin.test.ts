import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { parseAndValidateEventPayload } from '../../src/domain/events/EventSchemas';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { AcceptInviteLinkUseCase } from '../../src/application/use-cases/AcceptInviteLinkUseCase';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Milestone 8: Automatic Member Auto-Fulfillment & Join Requests (Kind 1504)', () => {
  const aliceSecretBytes = generateSecretKey();
  const aliceSecretHex = bytesToHex(aliceSecretBytes);
  const alicePubkey = getPublicKey(aliceSecretBytes);

  const bobSecretBytes = generateSecretKey();
  const bobPubkey = getPublicKey(bobSecretBytes);

  const groupRepo = new DexieGroupRepository();

  beforeEach(async () => {
    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.members.clear();
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

  it('validates Kind 1504 JOIN_REQUEST payload schema', () => {
    const rawPayload = {
      type: 'JOIN_REQUEST',
      groupId: 'grp_join_100',
      joiningMember: {
        pubkey: bobPubkey,
        displayName: 'Bob',
        joinedAt: 1700000000,
      },
      invitationKeyVersion: 1,
      requestedAt: 1700000000,
    };

    const validated = parseAndValidateEventPayload(1504, rawPayload);
    expect(validated.type).toBe('JOIN_REQUEST');
    expect(validated.joiningMember.displayName).toBe('Bob');
  });

  it('handleJoinRequest auto-adds joining member and delivers newer key envelopes', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_join_200';

    const group = new Group({
      id: groupId,
      name: 'Join Test Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    // Group rotates from V1 to V2
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    const spySignedEvent = vi.spyOn(syncCoordinator, 'enqueueSignedEvent');

    // Bob submits join request holding invitationKeyVersion: 1
    await syncCoordinator.handleJoinRequest(bobPubkey, {
      type: 'JOIN_REQUEST',
      groupId,
      joiningMember: {
        pubkey: bobPubkey,
        displayName: 'Bob',
        joinedAt: 1020,
      },
      invitationKeyVersion: 1,
      requestedAt: 1020,
    });

    const updatedGroup = await groupRepo.getGroupById(groupId);
    expect(updatedGroup?.hasMember(bobPubkey)).toBe(true);

    // Verify NIP-59 key envelope for V2 delivered to Bob
    expect(spySignedEvent).toHaveBeenCalled();
    const deliveredKinds = spySignedEvent.mock.calls.map((c) => c[0].kind);
    expect(deliveredKinds).toContain(1059);
  });

  it('guarantees idempotency when replaying duplicate JOIN_REQUEST events', async () => {
    const groupId = 'grp_join_idempotent_400';

    const group = new Group({
      id: groupId,
      name: 'Idempotent Join Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    const joinInput = {
      type: 'JOIN_REQUEST',
      groupId,
      joiningMember: {
        pubkey: bobPubkey,
        displayName: 'Bob',
        joinedAt: 1020,
      },
      invitationKeyVersion: 1,
      requestedAt: 1020,
    };

    const spySubmit = vi.spyOn(syncCoordinator, 'submitLocalEvent');

    // First JOIN_REQUEST replay
    await syncCoordinator.handleJoinRequest(bobPubkey, joinInput);
    const initialCallCount = spySubmit.mock.calls.length;

    const groupAfterFirst = await groupRepo.getGroupById(groupId);
    expect(groupAfterFirst?.members).toHaveLength(2); // Alice + Bob

    // Second (duplicate) JOIN_REQUEST replay
    await syncCoordinator.handleJoinRequest(bobPubkey, joinInput);

    const groupAfterSecond = await groupRepo.getGroupById(groupId);
    expect(groupAfterSecond?.members).toHaveLength(2); // Remains exactly 2, NO DUPLICATE MEMBERS

    // Verify NO DUPLICATE MEMBERSHIP_ADDED events were submitted
    const secondCallCount = spySubmit.mock.calls.length;
    expect(secondCallCount).toBe(initialCallCount);
  });
});
