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
  /**
   * Generates a new Nostr keypair locally, stores it in IndexedDB, and sets it as active identity.
   */
  async generateIdentity(displayName: string): Promise<IdentityRecord> {
    if (!displayName || displayName.trim().length === 0) {
      throw new Error('Display name is required');
    }

    const secretKeyBytes = generateSecretKey();
    const secretKeyHex = bytesToHex(secretKeyBytes);
    const pubkeyHex = getPublicKey(secretKeyBytes);

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
   * Imports identity via nsec or 64-char hex secret key. Awaits profile hydration.
   */
  async importSecretKey(nsecOrHex: string, displayNameInput: string = ''): Promise<IdentityRecord> {
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

    let finalName = displayNameInput.trim();

    // Fast-timeout (2.5s) profile hydration if no name provided
    if (!finalName) {
      const fetchedName = await this.hydrateProfile(pubkeyHex, 2500);
      if (fetchedName) {
        finalName = fetchedName;
      } else {
        finalName = `${nip19.npubEncode(pubkeyHex).slice(0, 10)}...`;
      }
    }

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      secretKey: secretKeyHex,
      displayName: finalName,
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);

    // Merge user NIP-65 relays
    relayManager.fetchAndMergeNip65Relays(pubkeyHex);

    return identity;
  }

  /**
   * Connects to NIP-07 browser extension (e.g. Alby, nos2x). Awaits profile hydration.
   */
  async connectExtension(displayNameInput: string = ''): Promise<IdentityRecord> {
    if (typeof window === 'undefined' || !window.nostr) {
      throw new Error('NIP-07 extension not detected in browser');
    }

    const pubkeyHex = await window.nostr.getPublicKey();
    if (!pubkeyHex || !/^[0-9a-f]{64}$/i.test(pubkeyHex)) {
      throw new Error('Invalid public key returned by extension');
    }

    await db.identities.where({ isCurrent: 1 }).modify({ isCurrent: 0 });

    let finalName = displayNameInput.trim();

    if (!finalName) {
      const fetchedName = await this.hydrateProfile(pubkeyHex, 2500);
      if (fetchedName) {
        finalName = fetchedName;
      } else {
        finalName = `${nip19.npubEncode(pubkeyHex).slice(0, 10)}...`;
      }
    }

    const identity: IdentityRecord = {
      pubkey: pubkeyHex,
      displayName: finalName,
      isExtension: true,
      isCurrent: 1,
      createdAt: Date.now(),
    };

    await db.identities.put(identity);

    relayManager.fetchAndMergeNip65Relays(pubkeyHex);

    return identity;
  }

  /**
   * Hydrates NIP-01 Kind 0 profile metadata from metadata relays.
   */
  async hydrateProfile(pubkeyHex: string, timeoutMs: number = 3000): Promise<string | null> {
    try {
      const metadataRelays = relayManager.getMetadataRelays();
      const events = await relayManager.queryEvents(
        [{ kinds: [0], authors: [pubkeyHex], limit: 1 }],
        metadataRelays
      );

      if (events.length === 0) return null;

      const profile = JSON.parse(events[0].content);
      const resolvedName =
        profile.display_name || profile.name || profile.username || profile.displayName;

      if (resolvedName && typeof resolvedName === 'string' && resolvedName.trim()) {
        return resolvedName.trim();
      }
      return null;
    } catch {
      return null;
    }
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

    const allMembers = await db.members.toArray();
    for (const member of allMembers) {
      if (member.id !== undefined && member.pubkey.toLowerCase() === current.pubkey.toLowerCase()) {
        await db.members.update(member.id, { displayName: trimmed });
      }
    }

    const updated = await this.getCurrentIdentity();
    this.notifyIdentityChange(updated ?? null);
  }

  private identityListeners: Array<(identity: IdentityRecord | null) => void> = [];

  onIdentityChange(callback: (identity: IdentityRecord | null) => void): () => void {
    this.identityListeners.push(callback);
    return () => {
      this.identityListeners = this.identityListeners.filter((cb) => cb !== callback);
    };
  }

  private notifyIdentityChange(identity: IdentityRecord | null): void {
    for (const listener of this.identityListeners) {
      try {
        listener(identity);
      } catch {
        // Ignore listener exceptions
      }
    }
  }

  isExtensionAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.nostr);
  }
}

export const identityService = new IdentityService();
