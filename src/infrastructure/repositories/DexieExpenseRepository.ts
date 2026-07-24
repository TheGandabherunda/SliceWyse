import { db, type ExpenseRecord } from '../db/SliceWyseDatabase';
import { Expense } from '../../domain/entities/Expense';
import { Money } from '../../domain/value-objects/Money';

export class DexieExpenseRepository {
  async saveExpense(expense: Expense): Promise<void> {
    const record: ExpenseRecord = {
      id: expense.id,
      groupId: expense.groupId,
      title: expense.title,
      amountCents: expense.amount.amountCents,
      currency: expense.amount.currency,
      paidByJson: JSON.stringify(
        expense.paidBy.map((p) => ({ pubkey: p.pubkey, amountCents: p.amount.amountCents }))
      ),
      splitsJson: JSON.stringify(
        expense.splits.map((s) => ({ pubkey: s.pubkey, amountCents: s.amount.amountCents }))
      ),
      splitType: expense.splitType,
      date: expense.date,
      version: expense.version,
      previousVersionId: expense.previousVersionId,
      isDeleted: expense.isDeleted,
      createdBy: expense.createdBy,
      syncStatus: 'PENDING',
    };

    await db.expenses.put(record);
  }

  async getExpensesByGroupId(groupId: string): Promise<Expense[]> {
    const records = await db.expenses
      .where({ groupId })
      .filter((e) => !e.isDeleted)
      .toArray();

    return records.map((record) => {
      const paidByRaw = JSON.parse(record.paidByJson) as Array<{
        pubkey: string;
        amountCents: number;
      }>;
      const splitsRaw = JSON.parse(record.splitsJson) as Array<{
        pubkey: string;
        amountCents: number;
      }>;

      return new Expense({
        id: record.id,
        groupId: record.groupId,
        title: record.title,
        amount: new Money(record.amountCents, record.currency),
        paidBy: paidByRaw.map((p) => ({
          pubkey: p.pubkey,
          amount: new Money(p.amountCents, record.currency),
        })),
        splits: splitsRaw.map((s) => ({
          pubkey: s.pubkey,
          amount: new Money(s.amountCents, record.currency),
        })),
        splitType: record.splitType,
        date: record.date,
        version: record.version,
        previousVersionId: record.previousVersionId,
        isDeleted: record.isDeleted,
        createdBy: record.createdBy,
      });
    });
  }
}
