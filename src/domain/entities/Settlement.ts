import { Money } from '../value-objects/Money';

export interface SettlementProps {
  id: string;
  groupId: string;
  payer: string;
  payee: string;
  amount: Money;
  date: number;
  createdBy: string;
}

export class Settlement {
  readonly id: string;
  readonly groupId: string;
  readonly payer: string;
  readonly payee: string;
  readonly amount: Money;
  readonly date: number;
  readonly createdBy: string;

  constructor(props: SettlementProps) {
    if (!props.id) throw new Error('Settlement ID is required');
    if (!props.groupId) throw new Error('Settlement Group ID is required');
    if (!props.payer) throw new Error('Settlement payer is required');
    if (!props.payee) throw new Error('Settlement payee is required');
    if (props.payer === props.payee) {
      throw new Error('Payer and payee cannot be the same person');
    }
    if (props.amount.amountCents <= 0) {
      throw new Error('Settlement amount must be greater than zero');
    }

    this.id = props.id;
    this.groupId = props.groupId;
    this.payer = props.payer;
    this.payee = props.payee;
    this.amount = props.amount;
    this.date = props.date;
    this.createdBy = props.createdBy;
  }
}
