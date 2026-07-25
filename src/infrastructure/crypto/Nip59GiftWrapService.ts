import * as nip59 from 'nostr-tools/nip59';
import { hexToBytes } from 'nostr-tools/utils';
import { type Event as NostrEvent } from 'nostr-tools/pure';

export interface GroupKeyEnvelope {
  protocolVersion: number;
  groupId: string;
  keyVersion: number;
  groupKey: string; // 64-char hex 32-byte key
  issuedAt: number;
}

export class Nip59GiftWrapService {
  /**
   * Constructs a NIP-59 Gift Wrap (Kind 1059) event wrapping a NIP-59 Seal (Kind 13) and Rumor (Kind 14).
   * Outer Gift Wrap uses an ephemeral keypair and randomized timestamp.
   * Sender identity is hidden inside the NIP-59 seal.
   */
  createGiftWrap(
    envelope: GroupKeyEnvelope,
    senderSecretKeyHex: string,
    recipientPubkeyHex: string
  ): NostrEvent {
    const senderSecretBytes = hexToBytes(senderSecretKeyHex);
    const jsonPayload = JSON.stringify(envelope);

    // Inner rumor event template (Kind 14)
    const rumorTemplate = {
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubkeyHex],
        ['d', `key_env:${envelope.groupId}:${envelope.keyVersion}`],
      ],
      content: jsonPayload,
    };

    // wrapEvent automatically builds rumor, creates NIP-59 seal (Kind 13), and wraps in Kind 1059 Gift Wrap
    const giftWrapEvent = nip59.wrapEvent(rumorTemplate, senderSecretBytes, recipientPubkeyHex);
    return giftWrapEvent;
  }

  /**
   * Unwraps a NIP-59 Gift Wrap (Kind 1059) event and extracts the GroupKeyEnvelope.
   * Validates inner sender identity from seal, NOT from outer ephemeral pubkey.
   */
  decryptGiftWrap(
    giftWrapEvent: NostrEvent,
    recipientSecretKeyHex: string
  ): { envelope: GroupKeyEnvelope; senderPubkey: string } | null {
    try {
      if (giftWrapEvent.kind !== 1059) {
        return null;
      }

      const recipientSecretBytes = hexToBytes(recipientSecretKeyHex);
      const unwrappedRumor = nip59.unwrapEvent(giftWrapEvent, recipientSecretBytes);

      if (!unwrappedRumor || !unwrappedRumor.pubkey) {
        return null;
      }

      const envelope = JSON.parse(unwrappedRumor.content) as GroupKeyEnvelope;
      if (!envelope.groupId || !envelope.groupKey || !envelope.keyVersion) {
        return null;
      }

      return {
        envelope,
        senderPubkey: unwrappedRumor.pubkey, // Real verified sender pubkey from NIP-59 seal
      };
    } catch {
      return null;
    }
  }
}

export const nip59GiftWrapService = new Nip59GiftWrapService();
