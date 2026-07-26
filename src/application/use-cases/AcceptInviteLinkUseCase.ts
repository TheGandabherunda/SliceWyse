import { identityService } from '../../infrastructure/identity/IdentityService';
import { syncCoordinator } from '../services/SyncCoordinator';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';
import { db } from '../../infrastructure/db/SliceWyseDatabase';

export interface AcceptInviteLinkInput {
  groupId: string;
  invKeyHex: string;
  encryptedEventContent?: string;
  rawInvitationPayload?: any; // For direct offline acceptance or test fixtures
}

export interface AcceptInviteLinkResult {
  groupId: string;
  inviterPubkey: string;
  keyVersion: number;
  joinRequestId: string;
  syncRequestId: string;
}

export class AcceptInviteLinkUseCase {
  async execute(input: AcceptInviteLinkInput): Promise<AcceptInviteLinkResult> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to accept invitation');
    }

    let payload: any = input.rawInvitationPayload;

    if (!payload && input.encryptedEventContent) {
      try {
        let textToDecrypt = input.encryptedEventContent;
        if (textToDecrypt.trim().startsWith('{')) {
          const parsedContainer = JSON.parse(textToDecrypt);
          if (parsedContainer.encryptedPayload) {
            textToDecrypt = parsedContainer.encryptedPayload;
          }
        }

        const decryptedJson = await aesGcmCryptoService.decrypt(textToDecrypt, input.invKeyHex);
        payload = JSON.parse(decryptedJson);
      } catch {
        throw new Error('Failed to decrypt invitation envelope: Invalid invitation key');
      }
    }

    if (!payload || !payload.groupId || !payload.groupKeyHex || payload.keyVersion === undefined) {
      throw new Error('Invalid invitation payload structure');
    }

    if (payload.groupId !== input.groupId) {
      throw new Error(`Group ID mismatch: expected "${input.groupId}", got "${payload.groupId}"`);
    }

    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      throw new Error('Invitation link has expired');
    }

    // 1. Store cryptographic group key under declared keyVersion ONLY (Zero projection writes!)
    const existingKey = await db.group_keys
      .where('[groupId+keyVersion]')
      .equals([payload.groupId, payload.keyVersion])
      .first();

    if (!existingKey) {
      await db.group_keys.add({
        groupId: payload.groupId,
        keyVersion: payload.keyVersion,
        groupKeyHex: payload.groupKeyHex,
        createdAt: payload.createdAt ?? Date.now(),
      });
    }

    const recipients = Array.from(new Set([payload.inviterPubkey])).filter(Boolean);

    // 2. Publish operational signal JOIN_REQUEST (Kind 1504) via publishSignalEvent()
    const joinPayload = {
      type: 'JOIN_REQUEST',
      groupId: payload.groupId,
      joiningMember: {
        pubkey: currentIdentity.pubkey,
        displayName: currentIdentity.displayName,
        joinedAt: Date.now(),
      },
      invitationKeyVersion: payload.keyVersion,
      requestedAt: Date.now(),
    };

    const joinRequestId = await syncCoordinator.publishSignalEvent({
      groupId: payload.groupId,
      eventKind: 1504,
      unencryptedPayload: joinPayload,
      parentEventIds: [],
      recipientPubkeys: recipients,
      keyVersion: payload.keyVersion,
    });

    // 3. Publish operational signal SYNC_REQUEST (Kind 1505) via publishSignalEvent()
    const syncPayload = {
      type: 'SYNC_REQUEST',
      groupId: payload.groupId,
      sinceKeyVersion: payload.keyVersion,
      knownEventIds: [],
      requestedAt: Date.now(),
    };

    const syncRequestId = await syncCoordinator.publishSignalEvent({
      groupId: payload.groupId,
      eventKind: 1505,
      unencryptedPayload: syncPayload,
      parentEventIds: [],
      recipientPubkeys: recipients,
      keyVersion: payload.keyVersion,
    });

    return {
      groupId: payload.groupId,
      inviterPubkey: payload.inviterPubkey,
      keyVersion: payload.keyVersion,
      joinRequestId,
      syncRequestId,
    };
  }
}
