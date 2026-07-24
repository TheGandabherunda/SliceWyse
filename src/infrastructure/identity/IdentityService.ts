import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { db, type IdentityRecord } from '../db/SliceWyseDatabase';
import { relayManager } from '../nostr/RelayManager';

export interface NostrWindowExtension {
  getPublicKey(): Promise<string>;
  signEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: NostrWindowExtension;
  }
}

export class IdentityService {
  private identityListeners = new Set<(identity: IdentityRecord) => void>();

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
      hasCustomDisplayName: true,
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

    const fallbackName = displayName.trim() || `${nip19.npubEncode(pubkeyHex).slice(0, 10)}...`;

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      secretKey: secretKeyHex,
      displayName: fallbackName,
      hasCustomDisplayName: Boolean(displayName.trim()),
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);

    // Background fetch Nostr Kind 0 profile metadata from relays if no custom name specified
    if (!displayName.trim()) {
      void this.refreshProfileDisplayName(pubkeyHex);
    }

    return identity;
  }

  /**
   * Connects to NIP-07 browser extension (e.g. Alby, nos2x).
   */
  async connectExtension(displayName: string = ''): Promise<IdentityRecord> {
    if (typeof window === 'undefined' || !window.nostr) {
      throw new Error('NIP-07 extension not detected in browser');
    }

    const pubkeyHex = await window.nostr.getPublicKey();
    if (!pubkeyHex || !/^[0-9a-f]{64}$/i.test(pubkeyHex)) {
      throw new Error('Invalid public key returned by extension');
    }

    await db.identities.where({ isCurrent: 1 }).modify({ isCurrent: 0 });

    const fallbackName = displayName.trim() || `${nip19.npubEncode(pubkeyHex).slice(0, 10)}...`;

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      displayName: fallbackName,
      hasCustomDisplayName: Boolean(displayName.trim()),
      isExtension: true,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);

    if (!displayName.trim()) {
      void this.refreshProfileDisplayName(pubkeyHex);
    }

    return identity;
  }

  /**
   * Fetches NIP-01 Kind 0 profile metadata from Nostr relays.
   */
  async fetchProfileMetadata(pubkeyHex: string): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let subClose: (() => void) | null = null;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (subClose) subClose();
          resolve(null);
        }
      }, 8000);

      try {
        subClose = relayManager.subscribe(
          [{ kinds: [0], authors: [pubkeyHex], limit: 1 }],
          (event) => {
            if (resolved) return;
            try {
              const profile = JSON.parse(event.content);
              const name =
                profile.display_name || profile.name || profile.displayName || profile.username;
              if (name && typeof name === 'string' && name.trim()) {
                resolved = true;
                clearTimeout(timeout);
                if (subClose) subClose();
                resolve(name.trim());
              }
            } catch {
              // ignore invalid JSON
            }
          }
        );
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Signs a Nostr event using local secretKey or NIP-07 extension.
   */
  async signEvent(eventTemplate: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<any> {
    const current = await this.getCurrentIdentity();
    if (!current) {
      throw new Error('No active identity available to sign event');
    }

    if (current.secretKey) {
      const secretKeyBytes = hexToBytes(current.secretKey);
      return finalizeEvent(eventTemplate, secretKeyBytes);
    } else if (current.isExtension && typeof window !== 'undefined' && window.nostr) {
      const eventToSign = {
        pubkey: current.pubkey,
        created_at: eventTemplate.created_at,
        kind: eventTemplate.kind,
        tags: eventTemplate.tags,
        content: eventTemplate.content,
      };
      return await window.nostr.signEvent(eventToSign);
    } else {
      throw new Error('Signing failed: no secret key or extension available');
    }
  }

  /**
   * Retrieves current active identity.
   */
  async getCurrentIdentity(): Promise<IdentityRecord | undefined> {
    const current = await db.identities.where({ isCurrent: 1 }).first();
    if (current && !this.hasCustomDisplayName(current) && this.isGenericName(current.displayName)) {
      void this.refreshProfileDisplayName(current.pubkey);
    }
    return current;
  }

  /**
   * Refreshes a fallback name from Kind 0 metadata without ever replacing a user-supplied name.
   */
  private async refreshProfileDisplayName(pubkey: string): Promise<void> {
    const profileName = await this.fetchProfileMetadata(pubkey);
    if (!profileName) return;

    const identity = await db.identities.get(pubkey);
    if (!identity || this.hasCustomDisplayName(identity)) return;

    await this.setDisplayNameForPubkey(pubkey, profileName, false);
  }

  private hasCustomDisplayName(identity: IdentityRecord): boolean {
    // Older records did not track this flag. Preserve any non-fallback name they already contain.
    return identity.hasCustomDisplayName ?? !this.isGenericName(identity.displayName);
  }

  private isGenericName(name?: string): boolean {
    if (!name || !name.trim()) return true;
    const trimmed = name.trim().toLowerCase();
    return (
      trimmed === 'nostr user' ||
      trimmed === 'nostr extension user' ||
      trimmed === 'user' ||
      trimmed.startsWith('npub1')
    );
  }

  /**
   * Updates display name for current identity and syncs across all member records in local groups.
   */
  async updateDisplayName(newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new Error('Display name cannot be empty');
    }

    const current = await db.identities.where({ isCurrent: 1 }).first();
    if (!current) return;

    await this.setDisplayNameForPubkey(current.pubkey, trimmed, true);
  }

  /** Lets the UI refresh when an asynchronous Kind 0 lookup changes the active identity. */
  onIdentityChange(listener: (identity: IdentityRecord) => void): () => void {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  private async setDisplayNameForPubkey(
    pubkey: string,
    displayName: string,
    hasCustomDisplayName: boolean
  ): Promise<void> {
    const identity = await db.identities.get(pubkey);
    if (!identity) return;

    await db.identities.update(pubkey, { displayName, hasCustomDisplayName });

    // Self-heal & update all member records across all groups in IndexedDB
    const allMembers = await db.members.toArray();
    for (const member of allMembers) {
      if (member.id !== undefined && member.pubkey.toLowerCase() === pubkey.toLowerCase()) {
        await db.members.update(member.id, { displayName });
      }
    }

    const updated = await db.identities.get(pubkey);
    if (updated?.isCurrent) {
      for (const listener of this.identityListeners) listener(updated);
    }
  }

  /**
   * Checks if NIP-07 extension is available in the environment.
   */
  isExtensionAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.nostr);
  }
}

export const identityService = new IdentityService();
