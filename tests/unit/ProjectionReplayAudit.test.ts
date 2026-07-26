import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { CreateGroupUseCase } from '../../src/application/use-cases/CreateGroupUseCase';
import { CreateInviteLinkUseCase } from '../../src/application/use-cases/CreateInviteLinkUseCase';
import { AcceptInviteLinkUseCase } from '../../src/application/use-cases/AcceptInviteLinkUseCase';
import { FulfillJoinRequestUseCase } from '../../src/application/use-cases/FulfillJoinRequestUseCase';
import { AddExpenseUseCase } from '../../src/application/use-cases/AddExpenseUseCase';
import { UpdateExpenseUseCase } from '../../src/application/use-cases/UpdateExpenseUseCase';
import { DeleteExpenseUseCase } from '../../src/application/use-cases/DeleteExpenseUseCase';
import { SettleUpUseCase } from '../../src/application/use-cases/SettleUpUseCase';
import { RemoveMemberUseCase } from '../../src/application/use-cases/RemoveMemberUseCase';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../src/infrastructure/repositories/DexieExpenseRepository';
import { DexieSettlementRepository } from '../../src/infrastructure/repositories/DexieSettlementRepository';
import { EventValidationPipeline } from '../../src/domain/services/EventValidationPipeline';
import { eventDagService } from '../../src/domain/services/EventDagService';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('ADR-005 Commit 7: Architecture Verification & Replay Audit', () => {
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
  const settlementRepo = new DexieSettlementRepository();

  beforeEach(async () => {
    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.expenses.clear();
    await db.settlements.clear();
    await db.events.clear();
    await db.sync_queue.clear();

    // Alice is active identity
    await db.identities.add({
      pubkey: alicePubkey,
      secretKey: aliceSecretHex,
      displayName: 'Alice',
      isCurrent: 1,
      createdAt: Date.now(),
    });
  });

  it('verifies complete domain lifecycle, disposable projections, and deterministic replay', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const createGroup = new CreateGroupUseCase();
    const createInvite = new CreateInviteLinkUseCase(groupRepo);
    const acceptInvite = new AcceptInviteLinkUseCase();
    const fulfillJoin = new FulfillJoinRequestUseCase();
    const addExpense = new AddExpenseUseCase();
    const updateExpense = new UpdateExpenseUseCase();
    const deleteExpense = new DeleteExpenseUseCase();
    const settleUp = new SettleUpUseCase();
    const removeMember = new RemoveMemberUseCase();

    // Step 1: Create Group (Alice)
    const initialGroup = await createGroup.execute({
      name: 'Full Audit Trip',
      currency: 'USD',
    });
    const groupId = initialGroup.id;

    // Step 2: Create Invite Link (Alice)
    const invite = await createInvite.execute({ groupId, relayUrl: 'wss://relay.damus.io' });

    // Step 3: Accept Invitation (Bob)
    await db.identities.clear();
    await db.identities.add({
      pubkey: bobPubkey,
      secretKey: bobSecretHex,
      displayName: 'Bob',
      isCurrent: 1,
      createdAt: Date.now(),
    });

    const rawPayload = {
      type: 'GROUP_INVITATION',
      groupId,
      groupName: 'Full Audit Trip',
      currency: 'USD',
      inviterPubkey: alicePubkey,
      groupKeyHex: (await syncCoordinator.getGroupKey(groupId, 1))!.groupKeyHex,
      keyVersion: 1,
      createdAt: Date.now(),
    };
    const encryptedInvite = await aesGcmCryptoService.encrypt(
      JSON.stringify(rawPayload),
      invite.invKeyHex
    );

    const acceptResult = await acceptInvite.execute({
      groupId,
      invKeyHex: invite.invKeyHex,
      encryptedEventContent: encryptedInvite,
    });
    expect(acceptResult.groupId).toBe(groupId);

    // Verify Bob has zero group projection prior to fulfillment
    const groupBeforeFulfill = await groupRepo.getGroupById(groupId);
    expect(groupBeforeFulfill?.hasMember(bobPubkey)).toBe(false);

    // Step 4: Fulfill Join Request (Alice auto-fulfills Bob's join request)
    await db.identities.clear();
    await db.identities.add({
      pubkey: alicePubkey,
      secretKey: aliceSecretHex,
      displayName: 'Alice',
      isCurrent: 1,
      createdAt: Date.now(),
    });

    await fulfillJoin.execute({
      groupId,
      joiningPubkey: bobPubkey,
      joiningMember: { pubkey: bobPubkey, displayName: 'Bob', joinedAt: Date.now() },
      invitationKeyVersion: 1,
    });

    const groupWithBob = await groupRepo.getGroupById(groupId);
    expect(groupWithBob?.hasMember(bobPubkey)).toBe(true);

    // Step 5: Add Expenses
    const eventsStep4 = await db.events.where('groupId').equals(groupId).toArray();
    const tipStep4 = eventsStep4[eventsStep4.length - 1].id;

    const expense1 = await addExpense.execute({
      groupId,
      title: 'Groceries',
      amountCents: 8000,
      currency: 'USD',
      paidByPubkey: alicePubkey,
      parentEventIds: [tipStep4],
    });

    const eventsStep5 = await db.events.where('groupId').equals(groupId).toArray();
    const tipStep5 = eventsStep5[eventsStep5.length - 1].id;

    const expense2 = await addExpense.execute({
      groupId,
      title: 'Taxi',
      amountCents: 4000,
      currency: 'USD',
      paidByPubkey: bobPubkey,
      parentEventIds: [tipStep5],
    });

    // Step 6: Update Expense 1
    const eventsStep6 = await db.events.where('groupId').equals(groupId).toArray();
    const tipStep6 = eventsStep6[eventsStep6.length - 1].id;

    const updatedExpense1 = await updateExpense.execute({
      expenseId: expense1.id,
      groupId,
      title: 'Organic Groceries',
      amountCents: 9500,
      parentEventId: tipStep6,
    });
    expect(updatedExpense1.title).toBe('Organic Groceries');

    // Step 7: Create Settlement (Bob settles $30 to Alice)
    const eventsStep7 = await db.events.where('groupId').equals(groupId).toArray();
    const tipStep7 = eventsStep7[eventsStep7.length - 1].id;

    const settlement = await settleUp.execute({
      groupId,
      payerPubkey: bobPubkey,
      payeePubkey: alicePubkey,
      amountCents: 3000,
      currency: 'USD',
    });
    expect(settlement).toBeDefined();

    // Step 8: Delete Expense 2
    const deletedExpense2 = await deleteExpense.execute({
      expenseId: expense2.id,
      groupId,
      parentEventId: tipStep7,
    });
    expect(deletedExpense2.isDeleted).toBe(true);

    // Capture Canonical State before wiping projections
    const preWipeGroup = await groupRepo.getGroupById(groupId);
    const preWipeExpenses = await expenseRepo.getExpensesByGroupId(groupId);
    const preWipeSettlements = await settlementRepo.getSettlementsByGroupId(groupId);
    const storedEvents = await db.events.where('groupId').equals(groupId).toArray();

    expect(storedEvents.length).toBeGreaterThanOrEqual(6);

    // -----------------------------------------------------------------------
    // DISPOSABLE PROJECTION REPLAY AUDIT
    // -----------------------------------------------------------------------
    // Wipe all projection tables completely
    await db.groups.clear();
    await db.members.clear();
    await db.expenses.clear();
    await db.settlements.clear();

    expect(await groupRepo.getGroupById(groupId)).toBeNull();
    expect(await expenseRepo.getExpensesByGroupId(groupId)).toHaveLength(0);
    expect(await settlementRepo.getSettlementsByGroupId(groupId)).toHaveLength(0);

    // Replay 1: Reconstruct strictly from db.events in DAG topological order
    const validatedEvents: any[] = [];
    for (const record of storedEvents) {
      const rawNostrEvent = JSON.parse(record.rawEvent);
      const validated = await EventValidationPipeline.validateAndDecryptEvent(
        rawNostrEvent,
        async (gId: string) => db.group_keys.where('groupId').equals(gId).toArray()
      );
      if (validated.isValid) {
        validatedEvents.push(validated);
      }
    }

    const dagNodes = validatedEvents.map((v) => ({
      eventId: v.event.id,
      kind: v.event.kind,
      pubkey: v.event.pubkey,
      createdAt: v.event.created_at,
      groupId: v.groupId,
      parentEventIds: v.parentEventIds,
      payload: v.payload,
    }));

    const sortedNodes = eventDagService.sortNodesTopologically(dagNodes);

    for (const node of sortedNodes) {
      const val = validatedEvents.find((v) => v.event.id === node.eventId)!;
      await (syncCoordinator as any).persistAndReduceValidatedEvent(val);
    }

    const replayedGroup1 = await groupRepo.getGroupById(groupId);
    const replayedExpenses1 = await expenseRepo.getExpensesByGroupId(groupId);
    const replayedSettlements1 = await settlementRepo.getSettlementsByGroupId(groupId);

    expect(replayedGroup1?.name).toBe(preWipeGroup?.name);
    expect(replayedGroup1?.members.map((m) => m.pubkey.value)).toEqual(
      preWipeGroup?.members.map((m) => m.pubkey.value)
    );
    expect(replayedExpenses1).toHaveLength(preWipeExpenses.length);
    expect(replayedSettlements1).toHaveLength(preWipeSettlements.length);

    // -----------------------------------------------------------------------
    // REPLAY IDEMPOTENCY AUDIT
    // -----------------------------------------------------------------------
    // Replay the exact same event log a SECOND time without wiping
    for (const node of sortedNodes) {
      const val = validatedEvents.find((v) => v.event.id === node.eventId)!;
      await (syncCoordinator as any).persistAndReduceValidatedEvent(val);
    }

    const replayedGroup2 = await groupRepo.getGroupById(groupId);
    const replayedExpenses2 = await expenseRepo.getExpensesByGroupId(groupId);
    const replayedSettlements2 = await settlementRepo.getSettlementsByGroupId(groupId);

    expect(replayedGroup2?.members).toHaveLength(replayedGroup1!.members.length);
    expect(replayedExpenses2.length).toBe(replayedExpenses1.length);
    expect(replayedSettlements2.length).toBe(replayedSettlements1.length);
  });
});
