import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { RemoveMemberUseCase } from '../../src/application/use-cases/RemoveMemberUseCase';
import { EventValidationPipeline } from '../../src/domain/services/EventValidationPipeline';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { EventReducer } from '../../src/domain/services/EventReducer';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Milestone 9: Member Removal & Lazy Key Rotation', () => {
  const aliceSecretBytes = generateSecretKey();
  const aliceSecretHex = bytesToHex(aliceSecretBytes);
  const alicePubkey = getPublicKey(aliceSecretBytes);

  const bobSecretBytes = generateSecretKey();
  const bobPubkey = getPublicKey(bobSecretBytes);

  const charlieSecretBytes = generateSecretKey();
  const charliePubkey = getPublicKey(charlieSecretBytes);

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

  it('removes member, rotates key epoch (K1 -> K2), and delivers key envelope only to remaining members', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_rem_100';
    const group = new Group({
      id: groupId,
      name: 'Trips Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
        new Member({ pubkey: new Pubkey(bobPubkey), displayName: 'Bob', joinedAt: 1000 }),
        new Member({ pubkey: new Pubkey(charliePubkey), displayName: 'Charlie', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    // Initialize epoch 1
    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [
      alicePubkey,
      bobPubkey,
      charliePubkey,
    ]);
    expect(keyV1.keyVersion).toBe(1);

    const spySignedEvent = vi.spyOn(syncCoordinator, 'enqueueSignedEvent');

    // Remove Charlie from group
    const useCase = new RemoveMemberUseCase(groupRepo);
    const updatedGroup = await useCase.execute({
      groupId,
      memberPubkeyToRemove: charliePubkey,
    });

    expect(updatedGroup.members).toHaveLength(2);
    expect(updatedGroup.hasMember(charliePubkey)).toBe(false);

    // Verify key version incremented to 2
    const keyV2 = await syncCoordinator.getLatestGroupKey(groupId);
    expect(keyV2?.keyVersion).toBe(2);

    // Verify NIP-59 key envelope for V2 delivered ONLY to Alice & Bob (NOT Charlie)
    const envelopeRecipients = spySignedEvent.mock.calls.map((call) => call[2]);
    expect(envelopeRecipients).toContain(alicePubkey);
    expect(envelopeRecipients).toContain(bobPubkey);
    expect(envelopeRecipients).not.toContain(charliePubkey);
  });

  it('guarantees replay safety and idempotency when removing an already-removed member', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_rem_idempotent_200';
    const group = new Group({
      id: groupId,
      name: 'Replay Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
        new Member({ pubkey: new Pubkey(bobPubkey), displayName: 'Bob', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey]);

    const useCase = new RemoveMemberUseCase(groupRepo);

    // First removal execution
    await useCase.execute({ groupId, memberPubkeyToRemove: bobPubkey });
    const keysAfterFirst = await syncCoordinator.getAllGroupKeys(groupId);
    expect(keysAfterFirst).toHaveLength(2); // V1 and V2

    // Second (duplicate replay) removal execution
    await useCase.execute({ groupId, memberPubkeyToRemove: bobPubkey });
    const keysAfterSecond = await syncCoordinator.getAllGroupKeys(groupId);
    expect(keysAfterSecond).toHaveLength(2); // Still V2, NO EXTRA KEY ROTATION
  });

  it('enforces forward secrecy: removed member cannot decrypt post-removal V2 events', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_rem_secrecy_300';
    const group = new Group({
      id: groupId,
      name: 'Secrecy Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
        new Member({ pubkey: new Pubkey(charliePubkey), displayName: 'Charlie', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, charliePubkey]);

    // Remove Charlie
    const useCase = new RemoveMemberUseCase(groupRepo);
    await useCase.execute({ groupId, memberPubkeyToRemove: charliePubkey });

    const keyV2 = await syncCoordinator.getLatestGroupKey(groupId);

    // Encrypt new post-removal expense under V2
    const postRemovalPayload = {
      type: 'EXPENSE_CREATED',
      id: 'exp_v2_secret',
      groupId,
      title: 'Alice Private Expense',
      amountCents: 5000,
      currency: 'USD',
      paidBy: [{ pubkey: alicePubkey, amountCents: 5000 }],
      splits: [{ pubkey: alicePubkey, amountCents: 5000 }],
      splitType: 'EQUAL',
      date: Date.now(),
      revision: 1,
      parentEventIds: [],
      isDeleted: false,
      createdBy: alicePubkey,
    };

    const encryptedV2 = await aesGcmCryptoService.encrypt(
      JSON.stringify(postRemovalPayload),
      keyV2!.groupKeyHex
    );

    const eventV2 = finalizeEvent(
      {
        kind: 1501,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', groupId],
          ['k', '2'],
        ],
        content: encryptedV2,
      },
      aliceSecretBytes
    );

    // Charlie's device only possesses key V1
    const charlieKeys = [keyV1];
    const result = await EventValidationPipeline.validateAndDecryptEvent(
      eventV2,
      async () => charlieKeys
    );

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 5 Failed');
  });

  it('guarantees multi-replica convergence when replaying MEMBERSHIP_REMOVED event', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_rem_convergence_400';
    const initialGroup = new Group({
      id: groupId,
      name: 'Convergence Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
        new Member({ pubkey: new Pubkey(bobPubkey), displayName: 'Bob', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(initialGroup);

    // Initial group key V1
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey]);

    const removalPayload = {
      type: 'MEMBERSHIP_REMOVED',
      groupId,
      removedPubkey: bobPubkey,
      keyVersion: 2,
      parentEventIds: [],
    };

    // Replay MEMBERSHIP_REMOVED via EventReducer pure function directly (replica 1)
    const replica1Group = EventReducer.reduceMembershipRemove(initialGroup, removalPayload);
    expect(replica1Group.hasMember(bobPubkey)).toBe(false);
    expect(replica1Group.members).toHaveLength(1);

    // Replay MEMBERSHIP_REMOVED via EventReducer pure function again (replica 2)
    const replica2Group = EventReducer.reduceMembershipRemove(replica1Group, removalPayload);
    expect(replica2Group.hasMember(bobPubkey)).toBe(false);
    expect(replica2Group.members).toHaveLength(1);

    // Identical membership state across both replicas
    expect(replica1Group.members.map((m) => m.pubkey.value)).toEqual(
      replica2Group.members.map((m) => m.pubkey.value)
    );
  });
});
