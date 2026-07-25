import Dexie, { type EntityTable } from 'dexie';

export interface IdentityRecord {
  pubkey: string; // 64-char hex
  secretKey?: string; // Hex secret key if locally generated/imported
  displayName: string;
  isExtension: boolean; // true if NIP-07 extension
  isCurrent: number; // 1 for true, 0 for false (IndexedDB key constraint)
  createdAt: number;
}

export interface GroupRecord {
  id: string;
  name: string;
  currency: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemberRecord {
  id?: number; // Auto-incremented primary key for compound search index
  groupId: string;
  pubkey: string;
  displayName: string;
  joinedAt: number;
}

export interface ExpenseRecord {
  id: string;
  groupId: string;
  title: string;
  amountCents: number;
  currency: string;
  paidByJson: string; // JSON array of {pubkey, amountCents}
  splitsJson: string; // JSON array of {pubkey, amountCents}
  splitType: 'EQUAL' | 'EXACT' | 'PERCENTAGE';
  date: number;
  revision: number;
  parentEventIdsJson: string; // JSON array of parent event IDs (DAG)
  isDeleted: boolean;
  hasConflict?: boolean;
  createdBy: string;
  syncStatus: 'QUEUED' | 'PUBLISHING' | 'ACCEPTED_BY_ONE_RELAY' | 'REPLICATED' | 'RETRY_REQUIRED';
}

export interface SettlementRecord {
  id: string;
  groupId: string;
  payer: string;
  payee: string;
  amountCents: number;
  currency: string;
  date: number;
  parentEventIdsJson: string;
  createdBy: string;
  syncStatus: 'QUEUED' | 'PUBLISHING' | 'ACCEPTED_BY_ONE_RELAY' | 'REPLICATED' | 'RETRY_REQUIRED';
}

export interface GroupKeyRecord {
  id?: number;
  groupId: string;
  keyVersion: number;
  groupKeyHex: string; // 64-char hex representation of 32-byte AES key
  createdAt: number;
}

export interface SyncQueueRecord {
  id?: number;
  eventId: string;
  groupId: string;
  eventKind: number;
  payloadJson: string;
  signedNostrEventJson?: string; // Serialized pre-signed Nostr event (e.g. Kind 1059 Gift Wrap)
  recipientsJson?: string;
  status: 'QUEUED' | 'PUBLISHING' | 'ACCEPTED_BY_ONE_RELAY' | 'REPLICATED' | 'RETRY_REQUIRED';
  acceptedRelaysJson?: string;
  attempts: number;
  lastAttemptAt: number;
}

export interface EventRecord {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  groupId: string;
  parentEventIdsJson: string;
  rawEvent: string;
}

export class SliceWyseDatabase extends Dexie {
  identities!: EntityTable<IdentityRecord, 'pubkey'>;
  groups!: EntityTable<GroupRecord, 'id'>;
  members!: EntityTable<MemberRecord, 'id'>;
  expenses!: EntityTable<ExpenseRecord, 'id'>;
  settlements!: EntityTable<SettlementRecord, 'id'>;
  group_keys!: EntityTable<GroupKeyRecord, 'id'>;
  events!: EntityTable<EventRecord, 'id'>;
  sync_queue!: EntityTable<SyncQueueRecord, 'id'>;

  constructor() {
    super('SliceWyseDB');
    this.version(2).stores({
      identities: 'pubkey, isCurrent',
      groups: 'id, updatedAt',
      members: '++id, groupId, pubkey, [groupId+pubkey]',
      expenses: 'id, groupId, date, isDeleted, syncStatus',
      settlements: 'id, groupId, date, syncStatus',
      group_keys: '++id, groupId, keyVersion, [groupId+keyVersion]',
      events: 'id, kind, pubkey, groupId',
      sync_queue: '++id, eventId, groupId, status, attempts',
    });
  }
}

export const db = new SliceWyseDatabase();
