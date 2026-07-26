<script lang="ts">
  import { onMount } from 'svelte';
  import { Wifi, WifiOff, RefreshCw } from 'lucide-svelte';
  import { syncCoordinator } from '../../application/services/SyncCoordinator';
  import { identityService } from '../../infrastructure/identity/IdentityService';

  let isOnline = $state(navigator.onLine);
  let isSyncing = $state(syncCoordinator.isHistorySyncing());

  function updateOnlineStatus() {
    isOnline = navigator.onLine;
  }

  onMount(() => {
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    let unsubscribeSync: (() => void) | undefined;

    identityService.getCurrentIdentity().then((identity) => {
      if (identity) {
        syncCoordinator
          .subscribeUserEvents(identity.pubkey, () => {
            isSyncing = syncCoordinator.isHistorySyncing();
          })
          .then((unsub) => {
            unsubscribeSync = unsub;
          });
      }
    });

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      unsubscribeSync?.();
    };
  });
</script>

<div class="sync-badge" class:online={isOnline} class:offline={!isOnline}>
  {#if !isOnline}
    <WifiOff size={14} />
    <span>Offline Mode</span>
  {:else if isSyncing}
    <RefreshCw size={14} class="spinning" />
    <span>Syncing...</span>
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
