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
    const group = new Group({
      id: groupId,
      name: input.name.trim(),
      currency: input.currency || 'USD',
      members,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await this.groupRepo.saveGroup(group);

    // 1. Rotate/Initialize Group Key via sole authority syncCoordinator.rotateGroupKey (epoch 1)
    const memberPubkeys = group.members.map((m) => m.pubkey.value);
    await syncCoordinator.rotateGroupKey(group.id, memberPubkeys);

    // 3. Enqueue Immutable Group Creation Event (Kind 1500)
    const groupPayload = {
      type: 'GROUP_CREATED',
      groupId: group.id,
      name: group.name,
      currency: group.currency,
      members: group.members.map((m) => ({
        pubkey: m.pubkey.value,
        displayName: m.displayName,
        joinedAt: m.joinedAt,
      })),
      keyVersion: 1,
      parentEventIds: [],
      createdAt: group.createdAt,
    };

    await syncCoordinator.enqueueEvent(
      group.id,
      1500,
      groupPayload,
      group.members.map((m) => m.pubkey.value)
    );

    return group;
  }
}
