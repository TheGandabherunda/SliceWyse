<script lang="ts">
  import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
  import { identityService } from '../../infrastructure/identity/IdentityService';
  import type { Group } from '../../domain/entities/Group';
  import type { IdentityRecord } from '../../infrastructure/db/SliceWyseDatabase';
  import EditProfileModal from '../components/EditProfileModal.svelte';
  import SyncStatusBadge from '../components/SyncStatusBadge.svelte';
  import CreateGroupModal from '../components/CreateGroupModal.svelte';
  import { Plus, Users, Sparkles, UserCheck, Edit2 } from 'lucide-svelte';

  interface Props {
    onSelectGroup: (groupId: string) => void;
  }

  let { onSelectGroup }: Props = $props();

  let groups = $state<Group[]>([]);
  let currentIdentity = $state<IdentityRecord | null>(null);
  let isCreateModalOpen = $state(false);
  let isEditProfileOpen = $state(false);

  const groupRepo = new DexieGroupRepository();

  async function loadData() {
    currentIdentity = (await identityService.getCurrentIdentity()) ?? null;
    groups = await groupRepo.getAllGroups();
  }

  $effect(() => {
    loadData();
  });
</script>

<div class="dashboard-container">
  <header class="dashboard-header glass-card">
    <div class="brand">
      <Sparkles class="brand-icon" size={28} />
      <h1>SliceWyse</h1>
    </div>

    <div class="header-right">
      <SyncStatusBadge />
      {#if currentIdentity}
        <button
          type="button"
          class="user-badge clickable"
          onclick={() => (isEditProfileOpen = true)}
          title="Click to change your display name"
        >
          <UserCheck size={18} />
          <span class="user-name">{currentIdentity.displayName}</span>
          <Edit2 size={12} class="edit-icon" />
        </button>
      {/if}
    </div>
  </header>

  <main class="dashboard-main">
    <div class="section-title-bar">
      <h2>Your Groups</h2>
      <button class="btn btn-primary" onclick={() => (isCreateModalOpen = true)}>
        <Plus size={18} /> Create Group
      </button>
    </div>

    {#if groups.length === 0}
      <div class="glass-card empty-groups">
        <Users size={48} class="empty-icon" />
        <h3>No groups yet</h3>
        <p>Create a group to start tracking split expenses with friends.</p>
        <button class="btn btn-primary margin-top" onclick={() => (isCreateModalOpen = true)}>
          <Plus size={18} /> Create Your First Group
        </button>
      </div>
    {:else}
      <div class="groups-grid">
        {#each groups as group}
          <div
            class="glass-card group-card"
            onclick={() => onSelectGroup(group.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && onSelectGroup(group.id)}
          >
            <div class="group-card-header">
              <h3>{group.name}</h3>
              <span class="currency-tag">{group.currency}</span>
            </div>
            <div class="group-card-footer">
              <span class="members-info">
                <Users size={16} /> {group.members.length} members
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>

  <CreateGroupModal
    isOpen={isCreateModalOpen}
    onClose={() => (isCreateModalOpen = false)}
    onCreated={loadData}
  />

  {#if currentIdentity}
    <EditProfileModal
      isOpen={isEditProfileOpen}
      currentName={currentIdentity.displayName}
      onClose={() => (isEditProfileOpen = false)}
      onUpdated={loadData}
    />
  {/if}
</div>

<style>
  .dashboard-container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .dashboard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    margin-bottom: 2rem;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--accent-primary);

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .user-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.8rem;
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: var(--accent-primary);
    border-radius: 20px;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;

    &.clickable {
      cursor: pointer;
      transition: all var(--transition-fast);

      &:hover {
        background: rgba(16, 185, 129, 0.25);
        border-color: var(--accent-primary);
      }
    }
  }

  .section-title-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;

    h2 {
      font-size: 1.5rem;
      font-weight: 600;
    }
  }

  .empty-groups {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);

    h3 {
      font-size: 1.25rem;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }
  }

  .margin-top {
    margin-top: 1.5rem;
  }

  .groups-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.25rem;
  }

  .group-card {
    padding: 1.5rem;
    cursor: pointer;
    transition: transform var(--transition-fast), border-color var(--transition-fast);

    &:hover {
      transform: translateY(-2px);
      border-color: var(--accent-primary);
    }
  }

  .group-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;

    h3 {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--text-primary);
    }
  }

  .currency-tag {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }

  .group-card-footer {
    display: flex;
    align-items: center;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .members-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
</style>
