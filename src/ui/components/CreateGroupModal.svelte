<script lang="ts">
  import { CreateGroupUseCase } from '../../application/use-cases/CreateGroupUseCase';
  import { X, Users } from 'lucide-svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
  }

  let { isOpen, onClose, onCreated }: Props = $props();

  let groupName = $state('');
  let currency = $state('USD');
  let errorMsg = $state('');
  let isLoading = $state(false);

  const createGroup = new CreateGroupUseCase();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!groupName.trim()) {
      errorMsg = 'Group name is required';
      return;
    }

    try {
      isLoading = true;
      errorMsg = '';
      await createGroup.execute({ name: groupName.trim(), currency });
      groupName = '';
      onCreated();
      onClose();
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to create group';
    } finally {
      isLoading = false;
    }
  }
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="button"
    tabindex="0"
  >
    <div
      class="glass-card modal-content"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-labelledby="modal-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="modal-title"><Users size={22} /> Create New Group</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>
      </div>

      {#if errorMsg}
        <div class="error-banner" role="alert">{errorMsg}</div>
      {/if}

      <form onsubmit={handleSubmit} class="modal-form">
        <div class="form-group">
          <label for="group-name">Group Name</label>
          <input
            id="group-name"
            type="text"
            class="input-field"
            placeholder="e.g. Kyoto Trip, Roommates"
            bind:value={groupName}
            required
            disabled={isLoading}
          />
        </div>

        <div class="form-group">
          <label for="group-currency">Currency</label>
          <select id="group-currency" class="input-field" bind:value={currency} disabled={isLoading}>
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="JPY">JPY (¥)</option>
            <option value="CAD">CAD ($)</option>
            <option value="AUD">AUD ($)</option>
          </select>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    z-index: 1000;
  }

  .modal-content {
    width: 100%;
    max-width: 440px;
    padding: 1.75rem;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;

    h2 {
      font-size: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-primary);
    }
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    &:hover {
      color: var(--text-primary);
    }
  }

  .modal-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    label {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid var(--accent-danger);
    color: #fca5a5;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
</style>
