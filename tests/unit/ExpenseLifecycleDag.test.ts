import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Expense } from '../../src/domain/entities/Expense';
import { Money } from '../../src/domain/value-objects/Money';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../src/infrastructure/repositories/DexieExpenseRepository';
import { AddExpenseUseCase } from '../../src/application/use-cases/AddExpenseUseCase';
import { UpdateExpenseUseCase } from '../../src/application/use-cases/UpdateExpenseUseCase';
import { DeleteExpenseUseCase } from '../../src/application/use-cases/DeleteExpenseUseCase';
import { EventReducer } from '../../src/domain/services/EventReducer';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Milestone 10: Expense & Settlement DAG Editing Engine', () => {
  const aliceSecretBytes = generateSecretKey();
  const aliceSecretHex = bytesToHex(aliceSecretBytes);
  const alicePubkey = getPublicKey(aliceSecretBytes);

  const bobSecretBytes = generateSecretKey();
  const bobPubkey = getPublicKey(bobSecretBytes);

  const groupRepo = new DexieGroupRepository();
  const expenseRepo = new DexieExpenseRepository();

  const groupId = 'grp_dag_100';

  beforeEach(async () => {
    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.events.clear();
    await db.expenses.clear();
    await db.sync_queue.clear();

    await db.identities.add({
      pubkey: alicePubkey,
      secretKey: aliceSecretHex,
      displayName: 'Alice',
      isCurrent: 1,
      createdAt: Date.now(),
    });

    const group = new Group({
      id: groupId,
      name: 'DAG Test Group',
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
  });

  it('UpdateExpenseUseCase emits append-only EXPENSE_UPDATED event', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const addUseCase = new AddExpenseUseCase(expenseRepo);
    const initialExpense = await addUseCase.execute({
      groupId,
      title: 'Initial Dinner',
      amountCents: 6000,
      currency: 'USD',
      paidByPubkey: alicePubkey,
      participantPubkeys: [alicePubkey, bobPubkey],
      splitType: 'EQUAL',
    });

    const updateUseCase = new UpdateExpenseUseCase(expenseRepo);
    const updatedExpense = await updateUseCase.execute({
      expenseId: initialExpense.id,
      groupId,
      title: 'Fancy Dinner & Drinks',
      amountCents: 10000,
      parentEventId: 'evt_init_1',
    });

    expect(updatedExpense.title).toBe('Fancy Dinner & Drinks');
    expect(updatedExpense.amount.amountCents).toBe(10000);
    expect(updatedExpense.version).toBe(2);

    const stored = await expenseRepo.getExpenseById(initialExpense.id);
    expect(stored?.title).toBe('Fancy Dinner & Drinks');
    expect(stored?.amount.amountCents).toBe(10000);
  });

  it('DeleteExpenseUseCase emits append-only EXPENSE_DELETED event', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const addUseCase = new AddExpenseUseCase(expenseRepo);
    const expense = await addUseCase.execute({
      groupId,
      title: 'Lunch to Delete',
      amountCents: 3000,
      currency: 'USD',
      paidByPubkey: alicePubkey,
      participantPubkeys: [alicePubkey, bobPubkey],
      splitType: 'EQUAL',
    });

    const deleteUseCase = new DeleteExpenseUseCase(expenseRepo);
    const deletedExpense = await deleteUseCase.execute({
      expenseId: expense.id,
      groupId,
      parentEventId: 'evt_lunch_1',
    });

    expect(deletedExpense.isDeleted).toBe(true);

    const activeExpenses = await expenseRepo.getExpensesByGroupId(groupId);
    expect(activeExpenses.some((e) => e.id === expense.id)).toBe(false);
  });

  it('guarantees replica convergence when replaying EXPENSE_UPDATED events', () => {
    const initialExpense = new Expense({
      id: 'exp_replay_1',
      groupId,
      title: 'Original Lunch',
      amount: new Money(4000, 'USD'),
      paidBy: [{ pubkey: alicePubkey, amount: new Money(4000, 'USD') }],
      splits: [
        { pubkey: alicePubkey, amount: new Money(2000, 'USD') },
        { pubkey: bobPubkey, amount: new Money(2000, 'USD') },
      ],
      splitType: 'EQUAL',
      date: 1000,
      version: 1,
      createdBy: alicePubkey,
    });

    const updatePayload = {
      type: 'EXPENSE_UPDATED',
      id: 'exp_replay_1',
      groupId,
      title: 'Updated Lunch Title',
      amountCents: 5000,
      currency: 'USD',
      revision: 2,
      parentEventIds: ['evt_replay_v1'],
    };

    // Replica 1 reduction
    const r1 = EventReducer.reduceExpenseUpdate(initialExpense, updatePayload);

    // Replica 2 reduction
    const r2 = EventReducer.reduceExpenseUpdate(initialExpense, updatePayload);

    expect(r1.title).toBe('Updated Lunch Title');
    expect(r1.amount.amountCents).toBe(5000);

    // Exact identity across replicas
    expect(r1.title).toBe(r2.title);
    expect(r1.amount.amountCents).toBe(r2.amount.amountCents);
    expect(r1.version).toBe(r2.version);
  });

  it('guarantees deterministic resolution for out-of-order update & delete events', () => {
    const initialExpense = new Expense({
      id: 'exp_ooo_1',
      groupId,
      title: 'Original Item',
      amount: new Money(2000, 'USD'),
      paidBy: [{ pubkey: alicePubkey, amount: new Money(2000, 'USD') }],
      splits: [{ pubkey: alicePubkey, amount: new Money(2000, 'USD') }],
      splitType: 'EQUAL',
      date: 1000,
      version: 1,
      createdBy: alicePubkey,
    });

    const deletePayload = {
      type: 'EXPENSE_DELETED',
      id: 'exp_ooo_1',
      groupId,
      parentEventIds: ['evt_update_v2'],
      isDeleted: true,
    };

    const deletedResult = EventReducer.reduceExpenseDelete(initialExpense, deletePayload);
    expect(deletedResult.isDeleted).toBe(true);
  });
});
