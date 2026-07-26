import { type Event as NostrEvent, verifyEvent } from 'nostr-tools/pure';
import { parseAndValidateEventPayload } from '../events/EventSchemas';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';
import type { GroupKeyRecord } from '../../infrastructure/db/SliceWyseDatabase';

export interface ValidatedEvent {
  isValid: boolean;
  event: NostrEvent;
  groupId: string;
  payload?: any;
  parentEventIds: string[];
  keyVersion?: number;
  error?: string;
}

export class EventValidationPipeline {
  /**
   * Supported Nostr event kinds for SliceWyse.
   */
  private static SUPPORTED_KINDS = new Set([1059, 1500, 1501, 1502, 1503, 1504, 1505, 30078]);

  /**
   * Executes Step 1 through Step 7 of the 8-Step Validation Pipeline.
   * Treats ["k", "<keyVersion>"] tag as the canonical source for key selection.
   */
  static async validateAndDecryptEvent(
    event: NostrEvent,
    getGroupKeys: (groupId: string) => Promise<GroupKeyRecord[]>
  ): Promise<ValidatedEvent> {
    // Step 1: Event Format Check
    if (!event || typeof event !== 'object' || !event.id || !event.pubkey || !event.sig) {
      return {
        isValid: false,
        event,
        groupId: '',
        parentEventIds: [],
        error: 'Step 1 Failed: Malformed Nostr event object',
      };
    }

    // Step 2: Signature Verification
    try {
      if (!verifyEvent(event)) {
        return {
          isValid: false,
          event,
          groupId: '',
          parentEventIds: [],
          error: 'Step 2 Failed: Schnorr signature verification failed',
        };
      }
    } catch {
      return {
        isValid: false,
        event,
        groupId: '',
        parentEventIds: [],
        error: 'Step 2 Failed: Schnorr signature verification failed',
      };
    }

    // Step 3: Application Kind Check
    if (!this.SUPPORTED_KINDS.has(event.kind)) {
      return {
        isValid: false,
        event,
        groupId: '',
        parentEventIds: [],
        error: `Step 3 Failed: Unsupported event kind ${event.kind}`,
      };
    }

    // Kind 1059 Gift Wrap events are handled specially by SyncCoordinator / NIP-59 service
    if (event.kind === 1059) {
      return {
        isValid: true,
        event,
        groupId: '',
        parentEventIds: [],
      };
    }

    // Step 4: Group ID Extraction & Authorization Check
    const groupIdTag = event.tags?.find((t) => t[0] === 'd');
    const groupId = groupIdTag ? groupIdTag[1] : '';

    if (!groupId) {
      return {
        isValid: false,
        event,
        groupId: '',
        parentEventIds: [],
        error: 'Step 4 Failed: Missing group ID tag ["d", "<groupId>"]',
      };
    }

    // Step 5: Canonical Key Selection & AES-256-GCM Payload Decryption
    const keyVersionTag = event.tags?.find((t) => t[0] === 'k');
    const explicitKeyVersion = keyVersionTag ? parseInt(keyVersionTag[1], 10) : undefined;

    const groupKeys = await getGroupKeys(groupId);
    let rawDecryptedPayload: any = null;
    let usedKeyVersion: number | undefined = explicitKeyVersion;

    if (groupKeys.length > 0) {
      if (explicitKeyVersion !== undefined && !isNaN(explicitKeyVersion)) {
        // Direct canonical lookup by ["k", "<keyVersion>"] tag
        const matchingKey = groupKeys.find((k) => k.keyVersion === explicitKeyVersion);
        if (matchingKey) {
          try {
            const decryptedJson = await aesGcmCryptoService.decrypt(
              event.content,
              matchingKey.groupKeyHex
            );
            rawDecryptedPayload = JSON.parse(decryptedJson);
          } catch (err: any) {
            return {
              isValid: false,
              event,
              groupId,
              parentEventIds: [],
              error: `Step 5 Failed: Canonical key version ${explicitKeyVersion} failed decryption`,
            };
          }
        }
      } else {
        // Fallback: Legacy event without ["k", "<keyVersion>"] tag — iterate historical keys highest to lowest
        const sortedKeys = [...groupKeys].sort((a, b) => b.keyVersion - a.keyVersion);
        for (const k of sortedKeys) {
          try {
            const decryptedJson = await aesGcmCryptoService.decrypt(event.content, k.groupKeyHex);
            rawDecryptedPayload = JSON.parse(decryptedJson);
            usedKeyVersion = rawDecryptedPayload.keyVersion ?? k.keyVersion;
            break;
          } catch {
            // Continue trying next historical key
          }
        }
      }
    } else {
      // Plaintext JSON parse fallback for local dev / unencrypted events
      try {
        rawDecryptedPayload = JSON.parse(event.content);
      } catch {
        // Plaintext parse failed
      }
    }

    if (!rawDecryptedPayload) {
      return {
        isValid: false,
        event,
        groupId,
        parentEventIds: [],
        error: 'Step 5 Failed: AES-256-GCM payload decryption failed for all available keys',
      };
    }

    // Step 6: Parent Event ID Dependency Extraction
    const parentEventIds: string[] = Array.isArray(rawDecryptedPayload.parentEventIds)
      ? rawDecryptedPayload.parentEventIds
      : [];

    // Step 7: Zod Payload Schema Validation
    let validatedPayload: any = null;
    try {
      validatedPayload = parseAndValidateEventPayload(event.kind, rawDecryptedPayload);
    } catch (schemaErr: any) {
      return {
        isValid: false,
        event,
        groupId,
        parentEventIds,
        error: `Step 7 Failed: Payload schema validation failed: ${schemaErr?.message || String(schemaErr)}`,
      };
    }

    return {
      isValid: true,
      event,
      groupId,
      payload: validatedPayload,
      parentEventIds,
      keyVersion: usedKeyVersion,
    };
  }
}
