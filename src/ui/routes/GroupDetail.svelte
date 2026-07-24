<script lang="ts">
  import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
  import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
  import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';
  import { DebtSimplifier, type DirectTransfer } from '../../domain/services/DebtSimplifier';
  import { syncCoordinator } from '../../application/services/SyncCoordinator';
  import { identityService } from '../../infrastructure/identity/IdentityService';
  import type { Group } from '../../domain/entities/Group';
  import type { Expense } from '../../domain/entities/Expense';
  import type { Settlement } from '../../domain/entities/Settlement';
  import { Money } from '../../domain/value-objects/Money';

  import SyncStatusBadge from '../components/SyncStatusBadge.svelte';
  import AddExpenseModal from '../components/AddExpenseModal.svelte';
  import AddMemberModal from '../components/AddMemberModal.svelte';
  import SettleUpModal from '../components/SettleUpModal.svelte';

  import { ArrowLeft, Plus, UserPlus, Handshake, Receipt, ArrowRight } from 'lucide-svelte';

  interface Props {
    groupId: string;
    onBack: () => void;
  }

  let { groupId, onBack }: Props = $props();

  let group = $state<Group | null>(null);
  let expenses = $state<Expense[]>([]);
  let settlements = $state<Settlement[]>([]);
  let netBalances = $state<Map<string, Money>>(new Map());
  let simplifiedTransfers = $state<DirectTransfer[]>([]);

  let isAddExpenseOpen = $state(false);
  let isAddMemberOpen = $state(false);
  let isSettleUpOpen = $state(false);

  let settleDefaultPayer = $state<string | undefined>();
  let settleDefaultPayee = $state<string | undefined>();
  let settleDefaultAmountCents = $state<number | undefined>();

  const groupRepo = new DexieGroupRepository();
  const expenseRepo = new DexieExpenseRepository();
  const settlementRepo = new DexieSettlementRepository();

  async function loadData() {
    group = await groupRepo.getGroupById(groupId);
    if (!group) return;

    expenses = await expenseRepo.getExpensesByGroupId(groupId);
    settlements = await settlementRepo.getSettlementsByGroupId(groupId);

    const memberPubkeys = group.members.map((m) => m.pubkey.value);
    netBalances = DebtSimplifier.calculateNetBalances(
      memberPubkeys,
      expenses,
      settlements,
      group.currency
    );

    simplifiedTransfers = DebtSimplifier.simplifyDebts(netBalances, group.currency);

    const currentIdentity = await identityService.getCurrentIdentity();
    if (currentIdentity) {
      syncCoordinator.subscribeUserEvents(currentIdentity.pubkey, () => {
        loadData();
      });
    }
  }

  $effect(() => {
    void loadData();
    return identityService.onIdentityChange(() => {
      void loadData();
    });
  });

  function getMemberName(pubkeyHex: string): string {
    const member = group?.getMember(pubkeyHex);
    return member ? member.displayName : `${pubkeyHex.slice(0, 6)}...`;
  }

  function handleQuickSettle(transfer: DirectTransfer) {
    settleDefaultPayer = transfer.from;
    settleDefaultPayee = transfer.to;
    settleDefaultAmountCents = transfer.amount.amountCents;
    isSettleUpOpen = true;
  }
</script>

{#if group}
  <div class="group-detail-container">
    <header class="top-nav">
      <button class="icon-btn" onclick={onBack} aria-label="Back to dashboard">
        <ArrowLeft size={22} />
      </button>
      <div class="header-info">
        <h1>{group.name}</h1>
        <span class="member-count">{group.members.length} members ({group.currency})</span>
      </div>
      <div class="header-actions">
        <SyncStatusBadge />
        <button class="btn btn-secondary btn-sm" onclick={() => (isAddMemberOpen = true)}>
          <UserPlus size={16} /> Add Member
        </button>
      </div>
    </header>

    <div class="detail-grid">
      <!-- Left Column: Balances & Simplified Debts -->
      <section class="sidebar-section">
        <div class="glass-card balance-card">
          <h2>Member Balances</h2>
          <div class="balance-list">
            {#each group.members as member}
              {@const balance = netBalances.get(member.pubkey.value) ?? Money.zero(group.currency)}
              <div class="balance-row">
                <span class="member-name">{member.displayName}</span>
                <span
                  class="balance-amount"
                  class:positive={balance.isPositive()}
                  class:negative={balance.isNegative()}
                >
                  {balance.isPositive() ? '+' : ''}{balance.format()}
                </span>
              </div>
            {/each}
          </div>
        </div>

        <div class="glass-card debts-card">
          <div class="section-header">
            <h2>Suggested Settlements</h2>
            <button class="btn btn-secondary btn-xs" onclick={() => (isSettleUpOpen = true)}>
              <Handshake size={14} /> Custom Settle Up
            </button>
          </div>

          {#if simplifiedTransfers.length === 0}
            <p class="empty-state">All group debts are completely settled up!</p>
          {:else}
            <div class="transfer-list">
              {#each simplifiedTransfers as transfer}
                <div class="transfer-row">
                  <div class="transfer-info">
                    <span class="payer">{getMemberName(transfer.from)}</span>
                    <ArrowRight size={14} class="arrow" />
                    <span class="payee">{getMemberName(transfer.to)}</span>
                  </div>
                  <div class="transfer-action">
                    <span class="amount">{transfer.amount.format()}</span>
                    <button
                      class="btn btn-primary btn-xs"
                      onclick={() => handleQuickSettle(transfer)}
                    >
                      Settle
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>

      <!-- Right Column: Expense History -->
      <section class="main-feed">
        <div class="feed-header">
          <h2>Expense History</h2>
          <button class="btn btn-primary" onclick={() => (isAddExpenseOpen = true)}>
            <Plus size={18} /> Add Expense
          </button>
        </div>

        {#if expenses.length === 0 && settlements.length === 0}
          <div class="glass-card empty-feed">
            <Receipt size={48} class="empty-icon" />
            <p>No expenses recorded yet. Click "Add Expense" to get started!</p>
          </div>
        {:else}
          <div class="timeline">
            {#each expenses as expense}
              <div class="glass-card timeline-card">
                <div class="card-main">
                  <div class="card-header">
                    <h3>{expense.title}</h3>
                    <span class="card-date">{new Date(expense.date).toLocaleDateString()}</span>
                  </div>
                  <div class="card-body">
                    <span class="paid-by">
                      Paid by <strong>{getMemberName(expense.paidBy[0]?.pubkey)}</strong>
                    </span>
                    <span class="expense-total">{expense.amount.format()}</span>
                  </div>
                </div>
              </div>
            {/each}

            {#each settlements as settlement}
              <div class="glass-card timeline-card settlement-card">
                <div class="card-main">
                  <div class="card-header">
                    <h3>
                      <Handshake size={16} /> Settlement
                    </h3>
                    <span class="card-date">{new Date(settlement.date).toLocaleDateString()}</span>
                  </div>
                  <div class="card-body">
                    <span class="settle-text">
                      <strong>{getMemberName(settlement.payer)}</strong> paid{' '}
                      <strong>{getMemberName(settlement.payee)}</strong>
                    </span>
                    <span class="settle-amount">{settlement.amount.format()}</span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>

    <!-- Modals -->
    <AddExpenseModal
      isOpen={isAddExpenseOpen}
      {groupId}
      currency={group.currency}
      members={group.members}
      onClose={() => (isAddExpenseOpen = false)}
      onAdded={loadData}
    />

    <AddMemberModal
      isOpen={isAddMemberOpen}
      {groupId}
      onClose={() => (isAddMemberOpen = false)}
      onAdded={loadData}
    />

    <SettleUpModal
      isOpen={isSettleUpOpen}
      {groupId}
      currency={group.currency}
      members={group.members}
      defaultPayer={settleDefaultPayer}
      defaultPayee={settleDefaultPayee}
      defaultAmountCents={settleDefaultAmountCents}
      onClose={() => {
        isSettleUpOpen = false;
        settleDefaultPayer = undefined;
        settleDefaultPayee = undefined;
        settleDefaultAmountCents = undefined;
      }}
      onSettled={loadData}
    />
  </div>
{/if}

<style>
  .group-detail-container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .top-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .header-info {
    flex: 1;

    h1 {
      font-size: 1.75rem;
      font-weight: 700;
    }

    .member-count {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: var(--radius-sm);

    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1.5rem;

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .balance-card, .debts-card {
    padding: 1.25rem;

    h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;

    h2 {
      margin-bottom: 0;
    }
  }

  .balance-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .balance-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  .balance-amount {
    font-weight: 600;
    color: var(--text-secondary);

    &.positive {
      color: var(--accent-primary);
    }

    &.negative {
      color: var(--accent-danger);
    }
  }

  .empty-state {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1rem 0;
  }

  .transfer-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .transfer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: rgba(17, 24, 39, 0.6);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }

  .transfer-info {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .transfer-action {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .amount {
    font-weight: 600;
    font-size: 0.85rem;
  }

  .btn-xs {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
  }

  .main-feed {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .feed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    h2 {
      font-size: 1.25rem;
      font-weight: 600;
    }
  }

  .empty-feed {
    text-align: center;
    padding: 3rem 1.5rem;
    color: var(--text-secondary);
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .timeline-card {
    padding: 1rem 1.25rem;

    &.settlement-card {
      border-left: 3px solid var(--accent-secondary);
    }
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;

    h3 {
      font-size: 1.05rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
  }

  .card-date {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .card-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }

  .expense-total {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .settle-amount {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--accent-secondary);
  }
</style>
