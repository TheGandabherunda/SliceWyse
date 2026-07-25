import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type Event as NostrEvent,
} from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { hexToBytes, bytesToHex } from 'nostr-tools/utils';

export interface GroupKeyEnvelope {
  protocolVersion: number;
  groupId: string;
  keyVersion: number;
  groupKey: string; // 64-char hex 32-byte key
  issuedAt: number;
}

export class Nip59GiftWrapService {
  /**
   * Constructs a NIP-59 Gift Wrap (Kind 1059) event containing an encrypted group key envelope.
   */
  async createGiftWrap(
    envelope: GroupKeyEnvelope,
    senderSecretKeyHex: string,
    recipientPubkeyHex: string
  ): Promise<NostrEvent> {
    const jsonPayload = JSON.stringify(envelope);
    const senderSecretBytes = hexToBytes(senderSecretKeyHex);

    // Derive NIP-44 v2 conversation key between sender identity and recipient identity
    const conversationKey = nip44.v2.utils.getConversationKey(
      senderSecretBytes,
      recipientPubkeyHex
    );
    const encryptedContent = nip44.v2.encrypt(jsonPayload, conversationKey);

    // Inner rumor event (Kind 14)
    const rumor = {
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubkeyHex],
        ['d', `key_env:${envelope.groupId}:${envelope.keyVersion}`],
      ],
      content: encryptedContent,
    };

    // Ephemeral outer key for NIP-59 Gift Wrap privacy
    const ephemeralSecretBytes = generateSecretKey();

    // Randomize created_at up to 2 days (172,800 seconds) in the past per NIP-59 spec
    const randomOffset = Math.floor(Math.random() * 172800);
    const randomizedCreatedAt = Math.floor(Date.now() / 1000) - randomOffset;

    const giftWrapEvent = finalizeEvent(
      {
        kind: 1059,
        created_at: randomizedCreatedAt,
        tags: [['p', recipientPubkeyHex]],
        content: JSON.stringify(rumor),
      },
      ephemeralSecretBytes
    );

    return giftWrapEvent;
  }

  /**
   * Decrypts a NIP-59 Gift Wrap (Kind 1059) key envelope event.
   */
  decryptGiftWrap(
    giftWrapEvent: NostrEvent,
    recipientSecretKeyHex: string,
    senderPubkeyHex: string
  ): GroupKeyEnvelope | null {
    try {
      if (
        giftWrapEvent.kind !== 1059 &&
        giftWrapEvent.kind !== 14 &&
        giftWrapEvent.kind !== 30078
      ) {
        return null;
      }

      let payloadToDecrypt = giftWrapEvent.content;

      // Handle raw or wrapped rumor content
      if (giftWrapEvent.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(giftWrapEvent.content);
          if (parsed.content) {
            payloadToDecrypt = parsed.content;
          }
        } catch {
          // Use raw content if not JSON
        }
      }

      const recipientSecretBytes = hexToBytes(recipientSecretKeyHex);
      const conversationKey = nip44.v2.utils.getConversationKey(
        recipientSecretBytes,
        senderPubkeyHex
      );
      const decryptedJson = nip44.v2.decrypt(payloadToDecrypt, conversationKey);

      const envelope = JSON.parse(decryptedJson) as GroupKeyEnvelope;
      if (!envelope.groupId || !envelope.groupKey || !envelope.keyVersion) {
        return null;
      }

      return envelope;
    } catch {
      return null;
    }
  }
}

export const nip59GiftWrapService = new Nip59GiftWrapService();
