import { Money } from '../value-objects/Money';

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE';

export interface PayerShare {
  pubkey: string;
  amount: Money;
}

export interface SplitShare {
  pubkey: string;
  amount: Money;
}

export interface ExpenseProps {
  id: string;
  groupId: string;
  title: string;
  amount: Money;
  paidBy: PayerShare[];
  splits: SplitShare[];
  splitType: SplitType;
  date: number;
  version?: number;
  previousVersionId?: string | null;
  isDeleted?: boolean;
  createdBy: string;
}

export class Expense {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly amount: Money;
  readonly paidBy: ReadonlyArray<PayerShare>;
  readonly splits: ReadonlyArray<SplitShare>;
  readonly splitType: SplitType;
  readonly date: number;
  readonly version: number;
  readonly previousVersionId: string | null;
  readonly isDeleted: boolean;
  readonly createdBy: string;

  constructor(props: ExpenseProps) {
    if (!props.id) throw new Error('Expense ID is required');
    if (!props.groupId) throw new Error('Expense Group ID is required');
    if (!props.title || props.title.trim().length === 0) {
      throw new Error('Expense title cannot be empty');
    }
    if (props.amount.amountCents <= 0) {
      throw new Error('Expense amount must be greater than zero');
    }
    if (props.paidBy.length === 0) {
      throw new Error('Expense must have at least one payer');
    }
    if (props.splits.length === 0) {
      throw new Error('Expense must have at least one split participant');
    }

    // Validate that sum of paidBy equals total amount
    const totalPaidCents = props.paidBy.reduce((sum, p) => sum + p.amount.amountCents, 0);
    if (totalPaidCents !== props.amount.amountCents) {
      throw new Error(
        `Total paid amount (${totalPaidCents}) does not match expense total amount (${props.amount.amountCents})`
      );
    }

    // Validate that sum of splits equals total amount
    const totalSplitCents = props.splits.reduce((sum, s) => sum + s.amount.amountCents, 0);
    if (totalSplitCents !== props.amount.amountCents) {
      throw new Error(
        `Total split allocation (${totalSplitCents}) does not match expense total amount (${props.amount.amountCents})`
      );
    }

    this.id = props.id;
    this.groupId = props.groupId;
    this.title = props.title.trim();
    this.amount = props.amount;
    this.paidBy = Object.freeze([...props.paidBy]);
    this.splits = Object.freeze([...props.splits]);
    this.splitType = props.splitType;
    this.date = props.date;
    this.version = props.version ?? 1;
    this.previousVersionId = props.previousVersionId ?? null;
    this.isDeleted = props.isDeleted ?? false;
    this.createdBy = props.createdBy;
  }
}
