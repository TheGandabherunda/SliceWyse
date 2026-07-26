import { Expense, type SplitType, type SplitShare } from '../../domain/entities/Expense';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface UpdateExpenseInput {
  expenseId: string;
  groupId: string;
  title?: string;
  amountCents?: number;
  currency?: string;
  paidByPubkey?: string;
  participantPubkeys?: string[];
  splitType?: SplitType;
  exactSplits?: Record<string, number>;
  parentEventId: string; // The event ID being edited
}

export class UpdateExpenseUseCase {
  constructor(private expenseRepo = new DexieExpenseRepository()) {}

  async execute(input: UpdateExpenseInput): Promise<Expense> {
    const currentExpense = await this.expenseRepo.getExpenseById(input.expenseId);
    if (!currentExpense) {
      throw new Error(`Expense with ID "${input.expenseId}" not found`);
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to update expense');
    }

    const currency = input.currency || currentExpense.amount.currency;
    const amountCents = input.amountCents ?? currentExpense.amount.amountCents;
    const totalMoney = new Money(amountCents, currency);

    const paidByPubkey =
      input.paidByPubkey || currentExpense.paidBy[0]?.pubkey || currentIdentity.pubkey;
    const paidBy = [{ pubkey: paidByPubkey, amount: totalMoney }];

    let splits = currentExpense.splits.map((s: SplitShare) => ({
      pubkey: s.pubkey,
      amount: new Money(s.amount.amountCents, currency),
    }));

    const splitType = input.splitType || currentExpense.splitType;
    const participantPubkeys =
      input.participantPubkeys || currentExpense.splits.map((s) => s.pubkey);

    if (splitType === 'EQUAL') {
      const splitMoneys = totalMoney.splitEqually(participantPubkeys.length);
      splits = participantPubkeys.map((pubkey, i) => ({
        pubkey,
        amount: splitMoneys[i],
      }));
    } else if (input.participantPubkeys && splitType === 'EXACT') {
      if (!input.exactSplits) {
        throw new Error('Exact split allocations must be provided for EXACT split type');
      }
      splits = input.participantPubkeys.map((pubkey) => ({
        pubkey,
        amount: new Money(input.exactSplits?.[pubkey] ?? 0, currency),
      }));
    }

    const updatedExpense = new Expense({
      id: currentExpense.id,
      groupId: currentExpense.groupId,
      title: input.title ?? currentExpense.title,
      amount: totalMoney,
      paidBy,
      splits,
      splitType,
      date: currentExpense.date,
      version: currentExpense.version + 1,
      previousVersionId: input.parentEventId,
      createdBy: currentExpense.createdBy,
    });

    // 1. Emit append-only EXPENSE_UPDATED protocol event
    const payload = {
      type: 'EXPENSE_UPDATED',
      id: currentExpense.id,
      groupId: input.groupId,
      title: updatedExpense.title,
      amountCents: updatedExpense.amount.amountCents,
      currency: updatedExpense.amount.currency,
      paidBy: updatedExpense.paidBy.map((p) => ({
        pubkey: p.pubkey,
        amountCents: p.amount.amountCents,
      })),
      splits: updatedExpense.splits.map((s) => ({
        pubkey: s.pubkey,
        amountCents: s.amount.amountCents,
      })),
      splitType: updatedExpense.splitType,
      revision: updatedExpense.version,
      parentEventIds: [input.parentEventId],
    };

    // 1. Submit append-only EXPENSE_UPDATED event via Unified Pipeline (ADR-005)
    await syncCoordinator.submitLocalEvent({
      groupId: input.groupId,
      eventKind: 1501,
      unencryptedPayload: payload,
      parentEventIds: [input.parentEventId],
    });

    // 2. Return canonical updated Expense projection populated by EventReducer
    const updated = await this.expenseRepo.getExpenseById(input.expenseId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated expense projection for ${input.expenseId}`);
    }

    return updated;
  }
}
