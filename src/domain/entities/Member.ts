import type { Pubkey } from '../value-objects/Pubkey';

export interface MemberProps {
  pubkey: Pubkey;
  displayName: string;
  joinedAt: number;
}

export class Member {
  readonly pubkey: Pubkey;
  readonly displayName: string;
  readonly joinedAt: number;

  constructor(props: MemberProps) {
    if (!props.displayName || props.displayName.trim().length === 0) {
      throw new Error('Member display name cannot be empty');
    }
    this.pubkey = props.pubkey;
    this.displayName = props.displayName.trim();
    this.joinedAt = props.joinedAt;
  }
}
