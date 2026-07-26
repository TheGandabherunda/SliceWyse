import { Expense } from '../../domain/entities/Expense';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface DeleteExpenseInput {
  expenseId: string;
  groupId: string;
  parentEventId: string; // The event ID being deleted
}

export class DeleteExpenseUseCase {
  constructor(private expenseRepo = new DexieExpenseRepository()) {}

  async execute(input: DeleteExpenseInput): Promise<Expense> {
    const currentExpense = await this.expenseRepo.getExpenseById(input.expenseId);
    if (!currentExpense) {
      throw new Error(`Expense with ID "${input.expenseId}" not found`);
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to delete expense');
    }

    const deletedExpense = new Expense({
      id: currentExpense.id,
      groupId: currentExpense.groupId,
      title: currentExpense.title,
      amount: currentExpense.amount,
      paidBy: [...currentExpense.paidBy],
      splits: [...currentExpense.splits],
      splitType: currentExpense.splitType,
      date: currentExpense.date,
      version: currentExpense.version + 1,
      previousVersionId: input.parentEventId,
      isDeleted: true,
      createdBy: currentExpense.createdBy,
    });

    // 1. Emit append-only EXPENSE_DELETED protocol event
    const payload = {
      type: 'EXPENSE_DELETED',
      id: currentExpense.id,
      groupId: input.groupId,
      parentEventIds: [input.parentEventId],
      isDeleted: true,
    };

    await syncCoordinator.enqueueEvent(input.groupId, 1501, payload);

    // 2. Project state into local Dexie repository (isDeleted: true)
    await this.expenseRepo.saveExpense(deletedExpense);

    return deletedExpense;
  }
}
