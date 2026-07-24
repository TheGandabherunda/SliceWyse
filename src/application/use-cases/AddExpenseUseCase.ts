import { Expense, type SplitType } from '../../domain/entities/Expense';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';

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
    return expense;
  }
}
