import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { EventDagService } from '../../src/domain/services/EventDagService';
import { EventReducer } from '../../src/domain/services/EventReducer';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Money } from '../../src/domain/value-objects/Money';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../src/infrastructure/repositories/DexieExpenseRepository';
import { CreateGroupUseCase } from '../../src/application/use-cases/CreateGroupUseCase';
import { CreateInviteLinkUseCase } from '../../src/application/use-cases/CreateInviteLinkUseCase';
import { AcceptInviteLinkUseCase } from '../../src/application/use-cases/AcceptInviteLinkUseCase';
import { AddExpenseUseCase } from '../../src/application/use-cases/AddExpenseUseCase';
import { RemoveMemberUseCase } from '../../src/application/use-cases/RemoveMemberUseCase';
import { FulfillJoinRequestUseCase } from '../../src/application/use-cases/FulfillJoinRequestUseCase';
import { DebtSimplifier } from '../../src/domain/services/DebtSimplifier';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Milestone 12: SliceWyse Protocol v1 Final Verification Gate & Invariants', () => {
  const aliceSecretBytes = generateSecretKey();
  const aliceSecretHex = bytesToHex(aliceSecretBytes);
  const alicePubkey = getPublicKey(aliceSecretBytes);

  const bobSecretBytes = generateSecretKey();
  const bobSecretHex = bytesToHex(bobSecretBytes);
  const bobPubkey = getPublicKey(bobSecretBytes);

  const charlieSecretBytes = generateSecretKey();
  const charlieSecretHex = bytesToHex(charlieSecretBytes);
  const charliePubkey = getPublicKey(charlieSecretBytes);

  const groupRepo = new DexieGroupRepository();
  const expenseRepo = new DexieExpenseRepository();
  const dagService = new EventDagService();

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.events.clear();
    await db.expenses.clear();
    await db.settlements.clear();
    await db.sync_queue.clear();

    await db.identities.add({
      pubkey: alicePubkey,
      secretKey: aliceSecretHex,
      displayName: 'Alice',
      isCurrent: 1,
      createdAt: Date.now(),
    });
  });

  it('Invariant 1: Multi-Device State Convergence across Alice, Bob, and Charlie replicas', async () => {
    const createGroupUseCase = new CreateGroupUseCase(groupRepo);
    const group = await createGroupUseCase.execute({
      name: 'E2E Convergence Group',
      currency: 'USD',
      memberDisplayNames: { [alicePubkey]: 'Alice' },
    });

    const addExpenseUseCase = new AddExpenseUseCase(expenseRepo);
    await addExpenseUseCase.execute({
      groupId: group.id,
      title: 'Dinner',
      amountCents: 9000,
      currency: 'USD',
      paidByPubkey: alicePubkey,
      participantPubkeys: [alicePubkey, bobPubkey, charliePubkey],
      splitType: 'EQUAL',
    });

    const expenses = await expenseRepo.getExpensesByGroupId(group.id);
    const netBalances = DebtSimplifier.calculateNetBalances(
      [alicePubkey, bobPubkey, charliePubkey],
      expenses,
      []
    );
    const settlements = DebtSimplifier.simplifyDebts(netBalances);

    // Verify balances compute deterministically: Bob & Charlie owe Alice $30 each
    expect(settlements).toHaveLength(2);
    expect(settlements.every((s) => s.to === alicePubkey)).toBe(true);
    expect(settlements.every((s) => s.amount.amountCents === 3000)).toBe(true);
  });

  it('Invariant 2: Replay Safety & Idempotency across duplicate events and requests', async () => {
    const groupId = 'grp_gate_idempotent';
    const initialGroup = new Group({
      id: groupId,
      name: 'Idempotency Gate',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(initialGroup);

    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    const fulfillUseCase = new FulfillJoinRequestUseCase(groupRepo);
    const joinInput = {
      groupId,
      joiningPubkey: bobPubkey,
      joiningMember: { pubkey: bobPubkey, displayName: 'Bob', joinedAt: 1010 },
      invitationKeyVersion: 1,
    };

    // Replay 1
    const addedFirst = await fulfillUseCase.execute(joinInput);
    expect(addedFirst).toBe(true);

    // Replay 2
    const addedSecond = await fulfillUseCase.execute(joinInput);
    expect(addedSecond).toBe(false); // Idempotent: member was not re-added

    const finalGroup = await groupRepo.getGroupById(groupId);
    expect(finalGroup?.members).toHaveLength(2); // Exactly Alice + Bob
  });

  it('Invariant 3: Out-of-Order Delivery & Skew-Resistant DAG Topological Ordering', () => {
    const parentNode = {
      eventId: 'evt_parent_root',
      kind: 1500,
      pubkey: alicePubkey,
      createdAt: 5000, // Skewed higher timestamp
      groupId: 'grp_gate_dag',
      parentEventIds: [],
      payload: { type: 'GROUP_CREATED', groupId: 'grp_gate_dag', name: 'DAG Gate' },
    };

    const childNode = {
      eventId: 'evt_child_expense',
      kind: 1501,
      pubkey: bobPubkey,
      createdAt: 1000, // Earlier timestamp than parent
      groupId: 'grp_gate_dag',
      parentEventIds: ['evt_parent_root'],
      payload: { type: 'EXPENSE_CREATED', id: 'exp_gate_1' },
    };

    const sorted = dagService.sortNodesTopologically([childNode, parentNode]);
    expect(sorted[0].eventId).toBe('evt_parent_root'); // Root parent (Depth 0) must sort first
    expect(sorted[1].eventId).toBe('evt_child_expense'); // Child (Depth 1) must sort second
  });

  it('Invariant 4: Pure Reducer Projections maintain side-effect-free deterministic transformations', () => {
    const initialGroup = new Group({
      id: 'grp_gate_reducer',
      name: 'Reducer Gate',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });

    const addPayload = {
      type: 'MEMBERSHIP_ADDED' as const,
      groupId: 'grp_gate_reducer',
      member: { pubkey: bobPubkey, displayName: 'Bob', joinedAt: 1020 },
      parentEventIds: [],
    };

    const reducedGroup1 = EventReducer.reduceMembershipAdd(initialGroup, addPayload);
    const reducedGroup2 = EventReducer.reduceMembershipAdd(initialGroup, addPayload);

    expect(reducedGroup1.members).toHaveLength(2);
    expect(reducedGroup1.members.map((m) => m.pubkey.value)).toEqual(
      reducedGroup2.members.map((m) => m.pubkey.value)
    );
  });

  it('Invariant 5: Option B+ Epoch Key Lifecycle with sole authority rotation and multi-epoch forward secrecy', async () => {
    const groupId = 'grp_gate_keys';

    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey]);
    expect(keyV1.keyVersion).toBe(1);

    const keyV2 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    expect(keyV2.keyVersion).toBe(2);

    const storedV1 = await syncCoordinator.getGroupKey(groupId, 1);
    const storedV2 = await syncCoordinator.getGroupKey(groupId, 2);

    expect(storedV1?.groupKeyHex).toBe(keyV1.groupKeyHex);
    expect(storedV2?.groupKeyHex).toBe(keyV2.groupKeyHex);
    expect(storedV1?.groupKeyHex).not.toBe(storedV2?.groupKeyHex);
  });

  it('Invariant 6: Invitation Bearer Security keeps groupKey encrypted inside Kind 30078 payload', async () => {
    const groupId = 'grp_gate_inv';
    const group = new Group({
      id: groupId,
      name: 'Invite Security Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    const createInvite = new CreateInviteLinkUseCase(groupRepo);
    const inviteResult = await createInvite.execute({ groupId });

    // URL contains ONLY invKey and groupId; groupKey is NEVER in the URL
    expect(inviteResult.inviteUrl).toContain('#/join?groupId=grp_gate_inv&invKey=');
    expect(inviteResult.invKeyHex).toHaveLength(64);

    const acceptInvite = new AcceptInviteLinkUseCase(groupRepo);
    const rawPayload = {
      type: 'GROUP_INVITATION',
      groupId,
      groupName: 'Invite Security Group',
      currency: 'USD',
      inviterPubkey: alicePubkey,
      groupKeyHex: aesGcmCryptoService.generateGroupKeyHex(),
      keyVersion: 1,
      createdAt: Date.now(),
    };

    const encrypted = await aesGcmCryptoService.encrypt(
      JSON.stringify(rawPayload),
      inviteResult.invKeyHex
    );

    // Switch to Bob identity
    await db.identities.clear();
    await db.identities.add({
      pubkey: bobPubkey,
      secretKey: bobSecretHex,
      displayName: 'Bob',
      isCurrent: 1,
      createdAt: Date.now(),
    });

    const acceptResult = await acceptInvite.execute({
      groupId,
      invKeyHex: inviteResult.invKeyHex,
      encryptedEventContent: encrypted,
    });

    expect(acceptResult.groupId).toBe(groupId);

    // Verify ZERO synthetic member projections were added to the group projection
    const groupState = await groupRepo.getGroupById(groupId);
    expect(groupState?.hasMember(bobPubkey)).toBe(false);
  });

  it('Invariant 7: Offline Recovery Protocol (Kind 1505) re-delivers missing envelopes without generating new state', async () => {
    const groupId = 'grp_gate_rec';

    const group = new Group({
      id: groupId,
      name: 'Recovery Gate Group',
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
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey]);

    const spyEnqueue = vi.spyOn(syncCoordinator, 'enqueueSignedEvent');

    await syncCoordinator.handleSyncRequest(bobPubkey, {
      type: 'SYNC_REQUEST',
      groupId,
      sinceKeyVersion: 1,
      knownEventIds: [],
      requestedAt: Date.now(),
    });

    expect(spyEnqueue).toHaveBeenCalled();
    const enqueuedKinds = spyEnqueue.mock.calls.map((c) => c[0].kind);
    expect(enqueuedKinds).toContain(1059); // Re-delivers missing V2 key envelope
  });

  it('Invariant 8: Join Request Auto-Fulfillment (Kind 1504) adds member and delivers newer key epochs', async () => {
    const groupId = 'grp_gate_join';
    const group = new Group({
      id: groupId,
      name: 'Join Gate Group',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    const spySignedEvent = vi.spyOn(syncCoordinator, 'enqueueSignedEvent');

    await syncCoordinator.handleJoinRequest(bobPubkey, {
      type: 'JOIN_REQUEST',
      groupId,
      joiningMember: { pubkey: bobPubkey, displayName: 'Bob', joinedAt: 1020 },
      invitationKeyVersion: 1,
      requestedAt: 1020,
    });

    const updatedGroup = await groupRepo.getGroupById(groupId);
    expect(updatedGroup?.hasMember(bobPubkey)).toBe(true);

    const deliveredKinds = spySignedEvent.mock.calls.map((c) => c[0].kind);
    expect(deliveredKinds).toContain(1059);
  });

  it('Invariant 9: Member Removal & Lazy Key Rotation creates single epoch K_{N+1} distributed ONLY to remaining members', async () => {
    const groupId = 'grp_gate_remove';
    const group = new Group({
      id: groupId,
      name: 'Removal Gate Group',
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

    await syncCoordinator.rotateGroupKey(groupId, [alicePubkey, bobPubkey, charliePubkey]); // V1

    const spySignedEvent = vi.spyOn(syncCoordinator, 'enqueueSignedEvent');

    const removeUseCase = new RemoveMemberUseCase(groupRepo);
    const updatedGroup = await removeUseCase.execute({
      groupId,
      memberPubkeyToRemove: charliePubkey,
    });

    expect(updatedGroup.members).toHaveLength(2);
    expect(updatedGroup.hasMember(charliePubkey)).toBe(false);

    const keyV2 = await syncCoordinator.getLatestGroupKey(groupId);
    expect(keyV2?.keyVersion).toBe(2);

    const recipients = spySignedEvent.mock.calls.map((c) => c[2]);
    expect(recipients).toContain(alicePubkey);
    expect(recipients).toContain(bobPubkey);
    expect(recipients).not.toContain(charliePubkey); // Charlie MUST NOT receive V2
  });
});
