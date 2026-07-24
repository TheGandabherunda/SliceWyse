import { Group } from '../entities/Group';
import { Member } from '../entities/Member';
import { Expense, type SplitType } from '../entities/Expense';
import { Settlement } from '../entities/Settlement';
import { Money } from '../value-objects/Money';
import { Pubkey } from '../value-objects/Pubkey';

export interface DecryptedGroupPayload {
  groupId: string;
  name: string;
  currency: string;
  members: Array<{ pubkey: string; displayName: string; joinedAt: number }>;
  createdAt: number;
}

export interface DecryptedExpensePayload {
  v: number;
  type: 'EXPENSE_CREATED';
  groupId: string;
  expenseId: string;
  title: string;
  amountCents: number;
  currency: string;
  paidBy: Array<{ pubkey: string; amountCents: number }>;
  splits: Array<{ pubkey: string; amountCents: number }>;
  splitType: SplitType;
  date: number;
  previousVersionId?: string | null;
  createdBy: string;
}

export interface DecryptedSettlementPayload {
  v: number;
  type: 'SETTLEMENT_CREATED';
  groupId: string;
  settlementId: string;
  payer: string;
  payee: string;
  amountCents: number;
  currency: string;
  date: number;
  createdBy: string;
}

export class EventReducer {
  /**
   * Reconstructs Group entity from decrypted Kind 30078 event payload.
   */
  static reduceGroup(payload: DecryptedGroupPayload): Group {
    const members = payload.members.map(
      (m) =>
        new Member({
          pubkey: new Pubkey(m.pubkey),
          displayName: m.displayName,
          joinedAt: m.joinedAt,
        })
    );

    return new Group({
      id: payload.groupId,
      name: payload.name,
      currency: payload.currency,
      members,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    });
  }

  /**
   * Reconstructs Expense entity from decrypted Kind 30079 event payload.
   */
  static reduceExpense(payload: DecryptedExpensePayload): Expense {
    return new Expense({
      id: payload.expenseId,
      groupId: payload.groupId,
      title: payload.title,
      amount: new Money(payload.amountCents, payload.currency),
      paidBy: payload.paidBy.map((p) => ({
        pubkey: p.pubkey,
        amount: new Money(p.amountCents, payload.currency),
      })),
      splits: payload.splits.map((s) => ({
        pubkey: s.pubkey,
        amount: new Money(s.amountCents, payload.currency),
      })),
      splitType: payload.splitType,
      date: payload.date,
      version: payload.v,
      previousVersionId: payload.previousVersionId,
      createdBy: payload.createdBy,
    });
  }

  /**
   * Reconstructs Settlement entity from decrypted Kind 30080 event payload.
   */
  static reduceSettlement(payload: DecryptedSettlementPayload): Settlement {
    return new Settlement({
      id: payload.settlementId,
      groupId: payload.groupId,
      payer: payload.payer,
      payee: payload.payee,
      amount: new Money(payload.amountCents, payload.currency),
      date: payload.date,
      createdBy: payload.createdBy,
    });
  }
}
