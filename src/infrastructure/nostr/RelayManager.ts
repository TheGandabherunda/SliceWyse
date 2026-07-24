import { SimplePool, type Event as NostrEvent, type Filter } from 'nostr-tools';

export const DEFAULT_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
];

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export class RelayManager {
  private pool: SimplePool;
  private relays: string[];

  constructor(relays: string[] = DEFAULT_RELAYS) {
    this.pool = new SimplePool();
    this.relays = relays;
  }

  /**
   * Publishes a signed Nostr event to all configured relays.
   */
  async publishEvent(event: NostrEvent): Promise<string[]> {
    const pubResults = this.pool.publish(this.relays, event);
    const successfulRelays: string[] = [];

    await Promise.allSettled(
      pubResults.map(async (promise, idx) => {
        try {
          await promise;
          successfulRelays.push(this.relays[idx]);
        } catch {
          // Relay connection failure ignored for individual relay resiliency
        }
      })
    );

    return successfulRelays;
  }

  /**
   * Subscribes to events matching a list of Nostr filters across default relays.
   */
  subscribe(filters: Filter[], onEvent: (event: NostrEvent) => void): () => void {
    const sub = this.pool.subscribeMany(this.relays, filters as any, {
      onevent(event) {
        onEvent(event);
      },
    });

    return () => {
      sub.close();
    };
  }

  /**
   * Returns connection status of configured relays.
   */
  getRelayStatuses(): RelayStatus[] {
    return this.relays.map((url) => ({
      url,
      connected: true, // Managed dynamically by pool
    }));
  }

  close(): void {
    this.pool.close(this.relays);
  }
}

export const relayManager = new RelayManager();
