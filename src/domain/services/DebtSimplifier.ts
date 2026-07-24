import type { Expense } from '../entities/Expense';
import type { Settlement } from '../entities/Settlement';
import { Money } from '../value-objects/Money';

export interface UserBalance {
  pubkey: string;
  netBalance: Money;
}

export interface DirectTransfer {
  from: string;
  to: string;
  amount: Money;
}

export class DebtSimplifier {
  /**
   * Calculates net balances for all participating members in a group.
   */
  static calculateNetBalances(
    memberPubkeys: string[],
    expenses: Expense[],
    settlements: Settlement[],
    currency: string = 'USD'
  ): Map<string, Money> {
    const balances = new Map<string, number>();

    for (const pubkey of memberPubkeys) {
      balances.set(pubkey, 0);
    }

    // Process valid (non-deleted) expenses
    for (const expense of expenses) {
      if (expense.isDeleted) continue;

      // Add payer contributions (+)
      for (const payer of expense.paidBy) {
        const current = balances.get(payer.pubkey) ?? 0;
        balances.set(payer.pubkey, current + payer.amount.amountCents);
      }

      // Deduct participant shares (-)
      for (const split of expense.splits) {
        const current = balances.get(split.pubkey) ?? 0;
        balances.set(split.pubkey, current - split.amount.amountCents);
      }
    }

    // Process settlements
    for (const settlement of settlements) {
      // Payer paid money out -> balance increases towards zero (+)
      const payerCurrent = balances.get(settlement.payer) ?? 0;
      balances.set(settlement.payer, payerCurrent + settlement.amount.amountCents);

      // Payee received money -> balance decreases towards zero (-)
      const payeeCurrent = balances.get(settlement.payee) ?? 0;
      balances.set(settlement.payee, payeeCurrent - settlement.amount.amountCents);
    }

    const resultMap = new Map<string, Money>();
    for (const [pubkey, cents] of balances.entries()) {
      resultMap.set(pubkey, new Money(cents, currency));
    }
    return resultMap;
  }

  /**
   * Simplifies the debt graph into the minimal set of direct transfers.
   */
  static simplifyDebts(
    netBalances: Map<string, Money>,
    currency: string = 'USD'
  ): DirectTransfer[] {
    const debtors: { pubkey: string; debt: number }[] = [];
    const creditors: { pubkey: string; credit: number }[] = [];

    let totalSum = 0;
    for (const [pubkey, money] of netBalances.entries()) {
      totalSum += money.amountCents;
      if (money.amountCents < 0) {
        debtors.push({ pubkey, debt: Math.abs(money.amountCents) });
      } else if (money.amountCents > 0) {
        creditors.push({ pubkey, credit: money.amountCents });
      }
    }

    if (totalSum !== 0) {
      throw new Error(`Net balances do not sum to zero (sum=${totalSum}). Invariant broken.`);
    }

    // Sort to optimize greedy reduction
    debtors.sort((a, b) => b.debt - a.debt);
    creditors.sort((a, b) => b.credit - a.credit);

    const transfers: DirectTransfer[] = [];
    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];

      const settlementCents = Math.min(debtor.debt, creditor.credit);

      if (settlementCents > 0) {
        transfers.push({
          from: debtor.pubkey,
          to: creditor.pubkey,
          amount: new Money(settlementCents, currency),
        });
      }

      debtor.debt -= settlementCents;
      creditor.credit -= settlementCents;

      if (debtor.debt === 0) i++;
      if (creditor.credit === 0) j++;
    }

    return transfers;
  }
}
