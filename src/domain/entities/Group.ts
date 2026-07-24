import type { Member } from './Member';

export interface GroupProps {
  id: string;
  name: string;
  currency: string;
  members: Member[];
  createdAt: number;
  updatedAt: number;
}

export class Group {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly members: ReadonlyArray<Member>;
  readonly createdAt: number;
  readonly updatedAt: number;

  constructor(props: GroupProps) {
    if (!props.id) throw new Error('Group ID is required');
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('Group name cannot be empty');
    }
    if (!props.currency) throw new Error('Group currency is required');

    this.id = props.id;
    this.name = props.name.trim();
    this.currency = props.currency.toUpperCase();
    this.members = Object.freeze([...props.members]);
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  hasMember(pubkeyHex: string): boolean {
    return this.members.some((m) => m.pubkey.value === pubkeyHex.toLowerCase());
  }

  getMember(pubkeyHex: string): Member | undefined {
    return this.members.find((m) => m.pubkey.value === pubkeyHex.toLowerCase());
  }
}
