<script lang="ts">
  import { onMount } from 'svelte';
  import { identityService } from './infrastructure/identity/IdentityService';
  import Onboarding from './ui/routes/Onboarding.svelte';
  import Dashboard from './ui/routes/Dashboard.svelte';
  import GroupDetail from './ui/routes/GroupDetail.svelte';

  let hasIdentity = $state<boolean | null>(null);
  let selectedGroupId = $state<string | null>(null);

  async function checkIdentity() {
    const identity = await identityService.getCurrentIdentity();
    hasIdentity = Boolean(identity);
  }

  onMount(() => {
    checkIdentity();
  });
</script>

{#if hasIdentity === null}
  <div class="loading-screen">
    <div class="spinner"></div>
  </div>
{:else if !hasIdentity}
  <Onboarding onComplete={checkIdentity} />
{:else if selectedGroupId}
  <GroupDetail groupId={selectedGroupId} onBack={() => (selectedGroupId = null)} />
{:else}
  <Dashboard onSelectGroup={(id) => (selectedGroupId = id)} />
{/if}

<style>
  .loading-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    border-top-color: var(--accent-primary);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
