import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';

export interface AddMemberInput {
  groupId: string;
  pubkey: string;
  displayName: string;
}

export class AddMemberUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: AddMemberInput): Promise<void> {
    const group = await this.groupRepo.getGroupById(input.groupId);
    if (!group) {
      throw new Error(`Group with ID "${input.groupId}" not found`);
    }

    const pubkey = new Pubkey(input.pubkey);
    if (group.hasMember(pubkey.value)) {
      throw new Error('Member already belongs to this group');
    }

    const newMember = new Member({
      pubkey,
      displayName: input.displayName.trim() || pubkey.toShortString(),
      joinedAt: Date.now(),
    });

    const updatedMembers = [...group.members, newMember];
    const updatedGroup = new Group({
      id: group.id,
      name: group.name,
      currency: group.currency,
      members: updatedMembers,
      createdAt: group.createdAt,
      updatedAt: Date.now(),
    });

    await this.groupRepo.saveGroup(updatedGroup);
  }
}
