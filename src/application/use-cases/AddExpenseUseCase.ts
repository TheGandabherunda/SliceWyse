import { Expense, type SplitType } from '../../domain/entities/Expense';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface AddExpenseInput {
  groupId: string;
  title: string;
  amountCents: number;
  currency: string;
  paidByPubkey: string;
  participantPubkeys: string[];
  splitType: SplitType;
  exactSplits?: Record<string, number>; // pubkey -> amountCents if EXACT
}

export class AddExpenseUseCase {
  constructor(private expenseRepo = new DexieExpenseRepository()) {}

  async execute(input: AddExpenseInput): Promise<Expense> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to create expense');
    }

    const totalMoney = new Money(input.amountCents, input.currency);
    const paidBy = [{ pubkey: input.paidByPubkey, amount: totalMoney }];

    let splits: Array<{ pubkey: string; amount: Money }> = [];

    if (input.splitType === 'EQUAL') {
      const splitMoneys = totalMoney.splitEqually(input.participantPubkeys.length);
      splits = input.participantPubkeys.map((pubkey, i) => ({
        pubkey,
        amount: splitMoneys[i],
      }));
    } else if (input.splitType === 'EXACT') {
      if (!input.exactSplits) {
        throw new Error('Exact split allocations must be provided for EXACT split type');
      }
      splits = input.participantPubkeys.map((pubkey) => ({
        pubkey,
        amount: new Money(input.exactSplits?.[pubkey] ?? 0, input.currency),
      }));
    }

    const expense = new Expense({
      id: `exp_${crypto.randomUUID().slice(0, 8)}`,
      groupId: input.groupId,
      title: input.title,
      amount: totalMoney,
      paidBy,
      splits,
      splitType: input.splitType,
      date: Date.now(),
      createdBy: currentIdentity.pubkey,
    });

    await this.expenseRepo.saveExpense(expense);

    // Enqueue encrypted expense event for Nostr relay sync
    const expensePayload = {
      v: expense.version,
      type: 'EXPENSE_CREATED',
      groupId: expense.groupId,
      expenseId: expense.id,
      title: expense.title,
      amountCents: expense.amount.amountCents,
      currency: expense.amount.currency,
      paidBy: expense.paidBy.map((p) => ({ pubkey: p.pubkey, amountCents: p.amount.amountCents })),
      splits: expense.splits.map((s) => ({ pubkey: s.pubkey, amountCents: s.amount.amountCents })),
      splitType: expense.splitType,
      date: expense.date,
      previousVersionId: expense.previousVersionId,
      createdBy: expense.createdBy,
    };

    await syncCoordinator.enqueueEvent(
      expense.groupId,
      30079,
      JSON.stringify(expensePayload),
      input.participantPubkeys
    );

    return expense;
  }
}
