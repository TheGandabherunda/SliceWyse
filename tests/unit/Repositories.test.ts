import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../src/infrastructure/repositories/DexieExpenseRepository';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { Expense } from '../../src/domain/entities/Expense';
import { Money } from '../../src/domain/value-objects/Money';

describe('Dexie Repositories Integration Tests', () => {
  const groupRepo = new DexieGroupRepository();
  const expenseRepo = new DexieExpenseRepository();

  const alicePubkey = '8234ab1111111111111111111111111111111111111111111111111111111111';
  const bobPubkey = '9182cd2222222222222222222222222222222222222222222222222222222222';

  beforeEach(async () => {
    await db.groups.clear();
    await db.members.clear();
    await db.expenses.clear();
    await db.settlements.clear();
  });

  it('should save and retrieve groups with members', async () => {
    const group = new Group({
      id: 'grp_test1',
      name: 'Kyoto Trip',
      currency: 'JPY',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 100 }),
        new Member({ pubkey: new Pubkey(bobPubkey), displayName: 'Bob', joinedAt: 101 }),
      ],
      createdAt: 100,
      updatedAt: 100,
    });

    await groupRepo.saveGroup(group);

    const loaded = await groupRepo.getGroupById('grp_test1');
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Kyoto Trip');
    expect(loaded?.members).toHaveLength(2);
    expect(loaded?.hasMember(alicePubkey)).toBe(true);
  });

  it('should save and query expenses by group ID', async () => {
    const expense = new Expense({
      id: 'exp_test1',
      groupId: 'grp_test1',
      title: 'Ramen Dinner',
      amount: new Money(3000, 'JPY'),
      paidBy: [{ pubkey: alicePubkey, amount: new Money(3000, 'JPY') }],
      splits: [
        { pubkey: alicePubkey, amount: new Money(1500, 'JPY') },
        { pubkey: bobPubkey, amount: new Money(1500, 'JPY') },
      ],
      splitType: 'EQUAL',
      date: 150,
      createdBy: alicePubkey,
    });

    await expenseRepo.saveExpense(expense);

    const expenses = await expenseRepo.getExpensesByGroupId('grp_test1');
    expect(expenses).toHaveLength(1);
    expect(expenses[0].title).toBe('Ramen Dinner');
    expect(expenses[0].amount.amountCents).toBe(3000);
  });
});
