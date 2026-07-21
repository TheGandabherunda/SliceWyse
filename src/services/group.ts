import { IPFSAccessController } from '@orbitdb/core';
import { getOrbitDB, getLocalUser } from './db';
import { encryptData, decryptData } from './encryption';

export interface GroupConfig {
  name: string;
  currency: string;
}

export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'RMB', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
];

export class GroupService {
  private db: any;
  private cryptoKey: CryptoKey;

  constructor(db: any, cryptoKey: CryptoKey) {
    this.db = db;
    this.cryptoKey = cryptoKey;
  }

  static async createGroup(name: string, currencyCode: string, cryptoKey: CryptoKey): Promise<GroupService> {
    const orbitdb = getOrbitDB();
    const user = getLocalUser();
    
    // Create an eventlog for the group. We use a random UUID for the DB name to avoid collisions.
    const dbName = `slicewyse-group-${crypto.randomUUID()}`;
    const db = await orbitdb.open(dbName, {
      type: 'events',
      AccessController: IPFSAccessController({ write: ['*'] }) // Public read, write by anyone with the address (encryption protects it)
    });

    const service = new GroupService(db, cryptoKey);
    
    // Append the initial configuration event
    await service.appendEvent({
      type: 'GROUP_CREATED',
      payload: { name, currency: currencyCode },
      createdBy: user.id,
      timestamp: Date.now()
    });

    return service;
  }

  static async joinGroup(address: string, cryptoKey: CryptoKey): Promise<GroupService> {
    const orbitdb = getOrbitDB();
    const db = await orbitdb.open(address, { type: 'events' });
    return new GroupService(db, cryptoKey);
  }

  async appendEvent(eventData: any) {
    const encrypted = await encryptData(eventData, this.cryptoKey);
    await this.db.add(encrypted);
  }

  async getAllEvents(): Promise<any[]> {
    const events = await this.db.iterator({ limit: -1 }).collect();
    const decryptedEvents = [];
    
    for (const event of events) {
      try {
        const decrypted = await decryptData(event.payload.value.ciphertext, event.payload.value.iv, this.cryptoKey);
        decryptedEvents.push(decrypted);
      } catch (err) {
        console.error('Failed to decrypt an event', err);
      }
    }
    
    return decryptedEvents;
  }
  
  get address() {
    return this.db.address.toString();
  }
}
