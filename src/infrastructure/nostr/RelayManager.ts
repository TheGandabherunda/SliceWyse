import { SimplePool, type Event as NostrEvent, type Filter } from 'nostr-tools';

export const BOOTSTRAP_SYNC_RELAYS = [
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://nostr.oxtr.dev',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];

export const BOOTSTRAP_METADATA_RELAYS = [
  'wss://purplepag.es',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
];

export interface RelayStatus {
  url: string;
  connected: boolean;
  isHealthy: boolean;
  lastError?: string;
}

export class RelayManager {
  private pool: SimplePool;
  private syncRelays: Set<string>;
  private metadataRelays: Set<string>;
  private memberRelayCache: Map<string, { read: string[]; write: string[] }>;
  private relayHealth: Map<string, { isHealthy: boolean; lastError?: string }>;

  constructor() {
    this.pool = new SimplePool();
    this.syncRelays = new Set(BOOTSTRAP_SYNC_RELAYS);
    this.metadataRelays = new Set(BOOTSTRAP_METADATA_RELAYS);
    this.memberRelayCache = new Map();
    this.relayHealth = new Map();
  }

  /**
   * Publishes a signed Nostr event to configured sync relays and validates NIP-20 OK responses.
   * Returns list of relay URLs that explicitly returned OK: true.
   */
  async publishEvent(event: NostrEvent, customRelays?: string[]): Promise<string[]> {
    const targetRelays = customRelays ?? Array.from(this.syncRelays);
    const pubResults = this.pool.publish(targetRelays, event);
    const acceptedRelays: string[] = [];

    await Promise.allSettled(
      pubResults.map(async (promise, idx) => {
        const relayUrl = targetRelays[idx];
        try {
          const res = await promise;
          // NIP-20 OK validation check
          if (
            res === '' ||
            res === 'success' ||
            res === event.id ||
            (typeof res === 'string' &&
              !res.toLowerCase().includes('failed') &&
              !res.toLowerCase().includes('error') &&
              !res.toLowerCase().includes('timeout') &&
              !res.toLowerCase().includes('blocked') &&
              !res.toLowerCase().includes('pow'))
          ) {
            acceptedRelays.push(relayUrl);
            this.relayHealth.set(relayUrl, { isHealthy: true });
            console.log(`SYNC relay accepted ${relayUrl}`);
          } else {
            this.relayHealth.set(relayUrl, { isHealthy: false, lastError: String(res) });
            console.log(`SYNC relay rejected ${relayUrl} ${String(res)}`);
          }
        } catch (err: any) {
          const reason = err instanceof Error ? err.message : String(err);
          this.relayHealth.set(relayUrl, { isHealthy: false, lastError: reason });
          console.log(`SYNC relay rejected ${relayUrl} ${reason}`);
        }
      })
    );

    return acceptedRelays;
  }

  /**
   * Queries historical events matching a list of Nostr filters across target relays until EOSE.
   */
  async queryEvents(filters: Filter[], customRelays?: string[]): Promise<NostrEvent[]> {
    const targetRelays = customRelays ?? Array.from(this.syncRelays);
    console.log(`SYNC requesting history ${JSON.stringify(filters)}`);

    try {
      const events: NostrEvent[] = [];
      for (const filter of filters) {
        const fetched = await this.pool.querySync(targetRelays, filter as any);
        for (const evt of fetched) {
          console.log(`SYNC received ${evt.id} ${evt.kind}`);
          events.push(evt);
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  /**
   * Subscribes to realtime Nostr relay events.
   */
  subscribe(
    filters: Filter[],
    onEvent: (event: NostrEvent) => void,
    customRelays?: string[]
  ): () => void {
    const targetRelays = customRelays ?? Array.from(this.syncRelays);
    const sub = this.pool.subscribeMany(targetRelays, filters as any, {
      onevent(event) {
        console.log(`SYNC received ${event.id} ${event.kind}`);
        onEvent(event);
      },
    });

    return () => {
      sub.close();
    };
  }

  /**
   * Fetches NIP-65 Relay List Metadata (Kind 10002) for a user pubkey and merges into sync/metadata relay pools.
   */
  async fetchAndMergeNip65Relays(pubkeyHex: string): Promise<void> {
    try {
      const events = await this.pool.querySync(Array.from(this.metadataRelays), {
        kinds: [10002],
        authors: [pubkeyHex],
        limit: 1,
      });

      if (events.length === 0) return;

      const readRelays: string[] = [];
      const writeRelays: string[] = [];

      for (const tag of events[0].tags) {
        if (tag[0] === 'r' && tag[1]) {
          const url = tag[1];
          const type = tag[2];
          if (!type || type === 'read') readRelays.push(url);
          if (!type || type === 'write') writeRelays.push(url);
        }
      }

      this.memberRelayCache.set(pubkeyHex, { read: readRelays, write: writeRelays });

      for (const w of writeRelays) this.syncRelays.add(w);
      for (const r of readRelays) this.metadataRelays.add(r);
    } catch {
      // Keep bootstrap relays if NIP-65 fetch fails
    }
  }

  getRelayStatuses(): RelayStatus[] {
    return Array.from(this.syncRelays).map((url) => ({
      url,
      connected: true,
      isHealthy: this.relayHealth.get(url)?.isHealthy ?? true,
      lastError: this.relayHealth.get(url)?.lastError,
    }));
  }

  getMetadataRelays(): string[] {
    return Array.from(this.metadataRelays);
  }

  getSyncRelays(): string[] {
    return Array.from(this.syncRelays);
  }
}

export const relayManager = new RelayManager();
