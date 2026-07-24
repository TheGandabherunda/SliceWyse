import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { db, type IdentityRecord } from '../db/SliceWyseDatabase';

export interface NostrWindowExtension {
  getPublicKey(): Promise<string>;
  signEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    nostr?: NostrWindowExtension;
  }
}

export class IdentityService {
  /**
   * Generates a new Nostr keypair locally, stores it in IndexedDB, and sets it as the active identity.
   */
  async generateIdentity(displayName: string): Promise<IdentityRecord> {
    if (!displayName || displayName.trim().length === 0) {
      throw new Error('Display name is required');
    }

    const secretKeyBytes = generateSecretKey();
    const secretKeyHex = bytesToHex(secretKeyBytes);
    const pubkeyHex = getPublicKey(secretKeyBytes);

    // Deactivate previous active identities
    await db.identities.where({ isCurrent: 1 }).modify({ isCurrent: 0 });

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      secretKey: secretKeyHex,
      displayName: displayName.trim(),
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);
    return identity;
  }

  /**
   * Imports identity via nsec or 64-char hex secret key.
   */
  async importSecretKey(nsecOrHex: string, displayName: string): Promise<IdentityRecord> {
    let secretKeyHex = '';
    const trimmed = nsecOrHex.trim();

    if (trimmed.startsWith('nsec1')) {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'nsec') {
        throw new Error('Invalid nsec string');
      }
      secretKeyHex = bytesToHex(decoded.data as Uint8Array);
    } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      secretKeyHex = trimmed.toLowerCase();
    } else {
      throw new Error('Invalid secret key format. Must be an nsec1... string or 64-character hex.');
    }

    const secretKeyBytes = hexToBytes(secretKeyHex);
    const pubkeyHex = getPublicKey(secretKeyBytes);

    await db.identities.where({ isCurrent: 1 }).modify({ isCurrent: 0 });

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      secretKey: secretKeyHex,
      displayName: displayName.trim() || 'Nostr User',
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);
    return identity;
  }

  /**
   * Connects to NIP-07 browser extension (e.g. Alby, nos2x).
   */
  async connectExtension(displayName: string = 'Nostr Extension User'): Promise<IdentityRecord> {
    if (typeof window === 'undefined' || !window.nostr) {
      throw new Error('NIP-07 extension not detected in browser');
    }

    const pubkeyHex = await window.nostr.getPublicKey();
    if (!pubkeyHex || !/^[0-9a-f]{64}$/i.test(pubkeyHex)) {
      throw new Error('Invalid public key returned by extension');
    }

    await db.identities.where({ isCurrent: 1 }).modify({ isCurrent: 0 });

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      displayName: displayName.trim(),
      isExtension: true,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);
    return identity;
  }

  /**
   * Retrieves current active identity.
   */
  async getCurrentIdentity(): Promise<IdentityRecord | undefined> {
    return await db.identities.where({ isCurrent: 1 }).first();
  }

  /**
   * Updates display name for current identity and syncs across all member records in local groups.
   */
  async updateDisplayName(newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new Error('Display name cannot be empty');
    }

    const current = await this.getCurrentIdentity();
    if (!current) return;

    await db.identities.update(current.pubkey, { displayName: trimmed });
    await db.members.where({ pubkey: current.pubkey }).modify({ displayName: trimmed });
  }

  /**
   * Checks if NIP-07 extension is available in the environment.
   */
  isExtensionAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.nostr);
  }
}

export const identityService = new IdentityService();
