<script lang="ts">
  import { AddExpenseUseCase } from '../../application/use-cases/AddExpenseUseCase';
  import type { Member } from '../../domain/entities/Member';
  import type { SplitType } from '../../domain/entities/Expense';
  import { X, Receipt } from 'lucide-svelte';

  interface Props {
    isOpen: boolean;
    groupId: string;
    currency: string;
    members: ReadonlyArray<Member> | Member[];
    onClose: () => void;
    onAdded: () => void;
  }

  let { isOpen, groupId, currency, members, onClose, onAdded }: Props = $props();

  let title = $state('');
  let amountStr = $state('');
  let paidByPubkey = $state('');
  let splitType = $state<SplitType>('EQUAL');
  let selectedParticipantPubkeys = $state<string[]>([]);
  let exactAmounts = $state<Record<string, string>>({});
  let errorMsg = $state('');
  let isLoading = $state(false);

  const addExpense = new AddExpenseUseCase();

  $effect(() => {
    if (members.length > 0) {
      if (!paidByPubkey) paidByPubkey = members[0].pubkey.value;
      if (selectedParticipantPubkeys.length === 0) {
        selectedParticipantPubkeys = members.map((m) => m.pubkey.value);
      }
    }
  });

  function toggleParticipant(pubkey: string) {
    if (selectedParticipantPubkeys.includes(pubkey)) {
      selectedParticipantPubkeys = selectedParticipantPubkeys.filter((p) => p !== pubkey);
    } else {
      selectedParticipantPubkeys = [...selectedParticipantPubkeys, pubkey];
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const amountVal = parseFloat(amountStr);
    if (isNaN(amountVal) || amountVal <= 0) {
      errorMsg = 'Please enter a valid expense amount';
      return;
    }
    if (!title.trim()) {
      errorMsg = 'Expense title is required';
      return;
    }
    if (selectedParticipantPubkeys.length === 0) {
      errorMsg = 'Select at least one participant';
      return;
    }

    const amountCents = Math.round(amountVal * 100);
    const exactSplitsCents: Record<string, number> = {};

    if (splitType === 'EXACT') {
      let sumExact = 0;
      for (const p of selectedParticipantPubkeys) {
        const val = parseFloat(exactAmounts[p] || '0');
        const cents = Math.round(val * 100);
        exactSplitsCents[p] = cents;
        sumExact += cents;
      }
      if (sumExact !== amountCents) {
        errorMsg = `Exact splits total (${(sumExact / 100).toFixed(2)}) must equal expense total (${amountVal.toFixed(2)})`;
        return;
      }
    }

    try {
      isLoading = true;
      errorMsg = '';
      await addExpense.execute({
        groupId,
        title: title.trim(),
        amountCents,
        currency,
        paidByPubkey,
        participantPubkeys: selectedParticipantPubkeys,
        splitType,
        exactSplits: splitType === 'EXACT' ? exactSplitsCents : undefined,
      });

      title = '';
      amountStr = '';
      onAdded();
      onClose();
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to add expense';
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
      aria-labelledby="add-expense-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="add-expense-title"><Receipt size={22} /> Add Expense</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>
      </div>

      {#if errorMsg}
        <div class="error-banner" role="alert">{errorMsg}</div>
      {/if}

      <form onsubmit={handleSubmit} class="modal-form">
        <div class="form-group">
          <label for="expense-title">Title</label>
          <input
            id="expense-title"
            type="text"
            class="input-field"
            placeholder="e.g. Dinner, Shinkansen"
            bind:value={title}
            required
            disabled={isLoading}
          />
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label for="expense-amount">Amount ({currency})</label>
            <input
              id="expense-amount"
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

          <div class="form-group flex-1">
            <label for="paid-by">Paid By</label>
            <select id="paid-by" class="input-field" bind:value={paidByPubkey} disabled={isLoading}>
              {#each members as member}
                <option value={member.pubkey.value}>{member.displayName}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label for="split-type">Split Method</label>
          <select id="split-type" class="input-field" bind:value={splitType} disabled={isLoading}>
            <option value="EQUAL">Split Equally</option>
            <option value="EXACT">Exact Amounts</option>
          </select>
        </div>

        <div class="form-group">
          <span class="section-label">Participants</span>
          <div class="participants-list">
            {#each members as member}
              <div class="participant-item">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedParticipantPubkeys.includes(member.pubkey.value)}
                    onchange={() => toggleParticipant(member.pubkey.value)}
                    disabled={isLoading}
                  />
                  <span>{member.displayName}</span>
                </label>

                {#if splitType === 'EXACT' && selectedParticipantPubkeys.includes(member.pubkey.value)}
                  <input
                    type="number"
                    step="0.01"
                    class="input-field exact-input"
                    placeholder="0.00"
                    bind:value={exactAmounts[member.pubkey.value]}
                    disabled={isLoading}
                  />
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Expense'}
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
    max-width: 480px;
    padding: 1.75rem;
    max-height: 90vh;
    overflow-y: auto;
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

  .form-row {
    display: flex;
    gap: 1rem;
  }

  .flex-1 {
    flex: 1;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    label, .section-label {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }
  }

  .participants-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: rgba(17, 24, 39, 0.6);
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }

  .participant-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--text-primary);
  }

  .exact-input {
    width: 100px;
    padding: 0.35rem 0.5rem;
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
