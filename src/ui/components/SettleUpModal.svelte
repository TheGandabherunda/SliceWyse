<script lang="ts">
  import { SettleUpUseCase } from '../../application/use-cases/SettleUpUseCase';
  import type { Member } from '../../domain/entities/Member';
  import { X, Handshake } from 'lucide-svelte';

  interface Props {
    isOpen: boolean;
    groupId: string;
    currency: string;
    members: ReadonlyArray<Member> | Member[];
    defaultPayer?: string;
    defaultPayee?: string;
    defaultAmountCents?: number;
    onClose: () => void;
    onSettled: () => void;
  }

  let {
    isOpen,
    groupId,
    currency,
    members,
    defaultPayer,
    defaultPayee,
    defaultAmountCents,
    onClose,
    onSettled,
  }: Props = $props();

  let payerPubkey = $state('');
  let payeePubkey = $state('');
  let amountStr = $state('');
  let errorMsg = $state('');
  let isLoading = $state(false);

  const settleUp = new SettleUpUseCase();

  $effect(() => {
    if (isOpen && members.length >= 2) {
      payerPubkey = defaultPayer || members[0].pubkey.value;
      payeePubkey = defaultPayee || members[1].pubkey.value;
      if (defaultAmountCents) {
        amountStr = (defaultAmountCents / 100).toFixed(2);
      }
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const amountVal = parseFloat(amountStr);
    if (isNaN(amountVal) || amountVal <= 0) {
      errorMsg = 'Please enter a valid settlement amount';
      return;
    }
    if (payerPubkey === payeePubkey) {
      errorMsg = 'Payer and recipient cannot be the same person';
      return;
    }

    try {
      isLoading = true;
      errorMsg = '';
      await settleUp.execute({
        groupId,
        payerPubkey,
        payeePubkey,
        amountCents: Math.round(amountVal * 100),
        currency,
      });

      amountStr = '';
      onSettled();
      onClose();
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to record settlement';
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
      aria-labelledby="settle-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="settle-title"><Handshake size={22} /> Record Settlement</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>
      </div>

      {#if errorMsg}
        <div class="error-banner" role="alert">{errorMsg}</div>
      {/if}

      <form onsubmit={handleSubmit} class="modal-form">
        <div class="form-group">
          <label for="settlement-payer">Who is paying?</label>
          <select id="settlement-payer" class="input-field" bind:value={payerPubkey} disabled={isLoading}>
            {#each members as member}
              <option value={member.pubkey.value}>{member.displayName}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label for="settlement-payee">Who is receiving?</label>
          <select id="settlement-payee" class="input-field" bind:value={payeePubkey} disabled={isLoading}>
            {#each members as member}
              <option value={member.pubkey.value}>{member.displayName}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label for="settlement-amount">Amount ({currency})</label>
          <input
            id="settlement-amount"
            type="number"
            step="0.01"
            min="0.01"
            class="input-field"
            placeholder="0.00"
            bind:value={amountStr}
            required
            disabled={isLoading}
          />
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Recording...' : 'Record Payment'}
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
