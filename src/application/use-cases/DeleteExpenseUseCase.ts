import { Expense } from '../../domain/entities/Expense';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface DeleteExpenseInput {
  expenseId: string;
  groupId: string;
  parentEventId?: string; // The event ID being deleted
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

    const parentEventId =
      input.parentEventId || currentExpense.previousVersionId || currentExpense.id;

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
      previousVersionId: parentEventId,
      isDeleted: true,
      createdBy: currentExpense.createdBy,
    });

    // 1. Emit append-only EXPENSE_DELETED protocol event
    const payload = {
      type: 'EXPENSE_DELETED',
      id: currentExpense.id,
      groupId: input.groupId,
      parentEventIds: [parentEventId],
      isDeleted: true,
    };

    // 1. Submit append-only EXPENSE_DELETED event via Unified Pipeline (ADR-005)
    await syncCoordinator.submitLocalEvent({
      groupId: input.groupId,
      eventKind: 1501,
      unencryptedPayload: payload,
      parentEventIds: [parentEventId],
    });

    // 2. Return canonical deleted Expense projection populated by EventReducer
    const deleted = await this.expenseRepo.getExpenseById(input.expenseId);
    if (!deleted) {
      throw new Error(`Failed to retrieve deleted expense projection for ${input.expenseId}`);
    }

    return deleted;
  }
}
