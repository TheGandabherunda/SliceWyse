import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../infrastructure/crypto/Nip59GiftWrapService';
import { db } from '../../infrastructure/db/SliceWyseDatabase';

export interface CreateGroupInput {
  name: string;
  currency: string;
  memberPubkeys?: Array<{ pubkey: string; displayName?: string }>;
}

export class CreateGroupUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: CreateGroupInput): Promise<Group> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Group name is required');
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to create group');
    }

    const creatorMember = new Member({
      pubkey: new Pubkey(currentIdentity.pubkey),
      displayName: currentIdentity.displayName,
      joinedAt: Date.now(),
    });

    const members: Member[] = [creatorMember];

    if (input.memberPubkeys && input.memberPubkeys.length > 0) {
      for (const m of input.memberPubkeys) {
        if (m.pubkey && m.pubkey.trim().length > 0 && m.pubkey !== currentIdentity.pubkey) {
          const validatedPubkey = new Pubkey(m.pubkey.trim());
          members.push(
            new Member({
              pubkey: validatedPubkey,
              displayName: m.displayName?.trim() || `Member ${validatedPubkey.value.slice(0, 8)}`,
              joinedAt: Date.now(),
            })
          );
        }
      }
    }

    const groupId = `grp_${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // 1. Initialize Group Key (epoch 1) before encryption & signing
    const memberPubkeys = members.map((m) => m.pubkey.value);
    await syncCoordinator.rotateGroupKey(groupId, memberPubkeys);

    // 2. Construct GROUP_CREATED Event Payload
    const groupPayload = {
      type: 'GROUP_CREATED',
      groupId,
      name: input.name.trim(),
      currency: input.currency || 'USD',
      members: members.map((m) => ({
        pubkey: m.pubkey.value,
        displayName: m.displayName,
        joinedAt: m.joinedAt,
      })),
      keyVersion: 1,
      parentEventIds: [],
      createdAt: now,
    };

    // 3. Submit Local Event via Unified Pipeline (ADR-005)
    // Validates -> Signs -> db.events -> EventReducer.reduceGroup() -> db.groups/db.members -> db.sync_queue
    await syncCoordinator.submitLocalEvent({
      groupId,
      eventKind: 1500,
      unencryptedPayload: groupPayload,
      parentEventIds: [],
      recipientPubkeys: memberPubkeys,
    });

    // 4. Return canonical Group projection populated by EventReducer
    const createdGroup = await this.groupRepo.getGroupById(groupId);
    if (!createdGroup) {
      throw new Error(`Failed to initialize group projection for ${groupId}`);
    }

    return createdGroup;
  }
}
