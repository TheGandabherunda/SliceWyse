import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import { CreateGroupUseCase } from '../../src/application/use-cases/CreateGroupUseCase';
import { AddMemberUseCase } from '../../src/application/use-cases/AddMemberUseCase';
import { AddExpenseUseCase } from '../../src/application/use-cases/AddExpenseUseCase';
import { SettleUpUseCase } from '../../src/application/use-cases/SettleUpUseCase';
import { DebtSimplifier } from '../../src/domain/services/DebtSimplifier';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../src/infrastructure/repositories/DexieExpenseRepository';
import { DexieSettlementRepository } from '../../src/infrastructure/repositories/DexieSettlementRepository';

describe('Application Use Cases Integration Tests', () => {
  const createGroup = new CreateGroupUseCase();
  const addMember = new AddMemberUseCase();
  const addExpense = new AddExpenseUseCase();
  const settleUp = new SettleUpUseCase();

  const groupRepo = new DexieGroupRepository();
  const expenseRepo = new DexieExpenseRepository();
  const settlementRepo = new DexieSettlementRepository();

  const bobPubkey = '9182cd2222222222222222222222222222222222222222222222222222222222';

  beforeEach(async () => {
    await db.identities.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.expenses.clear();
    await db.settlements.clear();

    await identityService.generateIdentity('Alice');
  });

  it('should create group, add member, add expense, and simplify debt', async () => {
    // 1. Create Group
    const group = await createGroup.execute({ name: 'Roadtrip', currency: 'USD' });
    const alicePubkey = group.members[0].pubkey.value;

    // 2. Add Bob to Group
    await addMember.execute({
      groupId: group.id,
      pubkey: bobPubkey,
      displayName: 'Bob',
    });

    // 3. Alice pays $100 for Alice & Bob
    await addExpense.execute({
      groupId: group.id,
      title: 'Gas',
      amountCents: 10000,
      currency: 'USD',
      paidByPubkey: alicePubkey,
      participantPubkeys: [alicePubkey, bobPubkey],
      splitType: 'EQUAL',
    });

    // 4. Verify balances
    const expenses = await expenseRepo.getExpensesByGroupId(group.id);
    const settlements = await settlementRepo.getSettlementsByGroupId(group.id);
    const updatedGroup = await groupRepo.getGroupById(group.id);

    const memberPubkeys = updatedGroup!.members.map((m) => m.pubkey.value);
    const netBalances = DebtSimplifier.calculateNetBalances(memberPubkeys, expenses, settlements);

    expect(netBalances.get(alicePubkey)?.amountCents).toBe(5000); // Alice owed $50
    expect(netBalances.get(bobPubkey)?.amountCents).toBe(-5000); // Bob owes $50

    // 5. Bob settles up $50
    await settleUp.execute({
      groupId: group.id,
      payerPubkey: bobPubkey,
      payeePubkey: alicePubkey,
      amountCents: 5000,
      currency: 'USD',
    });

    const updatedSettlements = await settlementRepo.getSettlementsByGroupId(group.id);
    const finalBalances = DebtSimplifier.calculateNetBalances(
      memberPubkeys,
      expenses,
      updatedSettlements
    );

    expect(finalBalances.get(alicePubkey)?.amountCents).toBe(0);
    expect(finalBalances.get(bobPubkey)?.amountCents).toBe(0);
  });
});
