<script lang="ts">
  import { onMount } from 'svelte';
  import { Wifi, WifiOff, RefreshCw } from 'lucide-svelte';
  import { syncCoordinator, type RecoveryState } from '../../application/services/SyncCoordinator';

  let isOnline = $state(navigator.onLine);
  let recoveryState = $state<RecoveryState>(syncCoordinator.getRecoveryState());

  function updateOnlineStatus() {
    isOnline = navigator.onLine;
  }

  onMount(() => {
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    const unsubscribe = syncCoordinator.subscribe(() => {
      recoveryState = syncCoordinator.getRecoveryState();
    });

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      unsubscribe();
    };
  });
</script>

<div class="sync-badge" class:online={isOnline} class:offline={!isOnline}>
  {#if !isOnline}
    <WifiOff size={14} />
    <span>Offline Mode</span>
  {:else if recoveryState === 'RECOVERING_IDENTITY'}
    <RefreshCw size={14} class="spinning" />
    <span>Recovering Profile...</span>
  {:else if recoveryState === 'RECOVERING_GROUP_KEYS'}
    <RefreshCw size={14} class="spinning" />
    <span>Syncing Group Keys...</span>
  {:else if recoveryState === 'RECOVERING_EVENTS'}
    <RefreshCw size={14} class="spinning" />
    <span>Syncing Events...</span>
  {:else}
    <Wifi size={14} />
    <span>Relays Connected</span>
  {/if}
</div>

<style>
  .sync-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 500;
    transition: all var(--transition-fast);

    &.online {
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }

    &.offline {
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.25);
    }
  }

  :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
