<script lang="ts">
  import { identityService } from '../../infrastructure/identity/IdentityService';
  import { Shield, Key, Sparkles, AlertCircle } from 'lucide-svelte';

  interface Props {
    onComplete: () => void;
  }

  let { onComplete }: Props = $props();

  let displayName = $state('');
  let importKey = $state('');
  let showImport = $state(false);
  let errorMsg = $state('');
  let isLoading = $state(false);

  const isExtensionAvailable = identityService.isExtensionAvailable();

  async function handleCreateIdentity(e: Event) {
    e.preventDefault();
    if (!displayName.trim()) {
      errorMsg = 'Please enter your name';
      return;
    }

    try {
      isLoading = true;
      errorMsg = '';
      await identityService.generateIdentity(displayName.trim());
      onComplete();
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to generate identity';
    } finally {
      isLoading = false;
    }
  }

  async function handleConnectExtension() {
    try {
      isLoading = true;
      errorMsg = '';
      await identityService.connectExtension(displayName.trim() || 'Nostr User');
      onComplete();
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to connect extension';
    } finally {
      isLoading = false;
    }
  }

  async function handleImportKey(e: Event) {
    e.preventDefault();
    if (!importKey.trim()) {
      errorMsg = 'Please enter a valid nsec or hex key';
      return;
    }

    try {
      isLoading = true;
      errorMsg = '';
      await identityService.importSecretKey(importKey.trim(), displayName.trim());
      onComplete();
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Invalid Nostr key format';
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="onboarding-container">
  <div class="glass-card onboarding-card">
    <div class="header">
      <div class="logo">
        <Sparkles class="logo-icon" size={32} />
        <h1>SliceWyse</h1>
      </div>
      <p class="subtitle">Private, decentralized split expenses powered by Nostr</p>
    </div>

    {#if errorMsg}
      <div class="error-banner" role="alert">
        <AlertCircle size={18} />
        <span>{errorMsg}</span>
      </div>
    {/if}

    {#if !showImport}
      <form onsubmit={handleCreateIdentity} class="form-flow">
        <div class="form-group">
          <label for="display-name-input">What should we call you?</label>
          <input
            id="display-name-input"
            type="text"
            class="input-field"
            placeholder="e.g. Alice, Bob"
            bind:value={displayName}
            required
            disabled={isLoading}
          />
        </div>

        <button type="submit" class="btn btn-primary full-width" disabled={isLoading}>
          {isLoading ? 'Creating Identity...' : 'Continue & Start'}
        </button>

        <div class="divider">
          <span>or connect existing Nostr identity</span>
        </div>

        {#if isExtensionAvailable}
          <button
            type="button"
            class="btn btn-secondary full-width"
            onclick={handleConnectExtension}
            disabled={isLoading}
          >
            <Shield size={18} />
            Use Nostr Extension (NIP-07)
          </button>
        {/if}

        <button
          type="button"
          class="btn btn-secondary full-width"
          onclick={() => (showImport = true)}
          disabled={isLoading}
        >
          <Key size={18} />
          Import Nostr Key (nsec)
        </button>
      </form>
    {:else}
      <form onsubmit={handleImportKey} class="form-flow">
        <div class="form-group">
          <label for="import-key-input">Nostr Secret Key (nsec1... or 64-char Hex)</label>
          <input
            id="import-key-input"
            type="password"
            class="input-field"
            placeholder="nsec1..."
            bind:value={importKey}
            required
            disabled={isLoading}
          />
        </div>

        <div class="form-group">
          <label for="import-name-input">Display Name (Optional)</label>
          <input
            id="import-name-input"
            type="text"
            class="input-field"
            placeholder="e.g. Alice"
            bind:value={displayName}
            disabled={isLoading}
          />
        </div>

        <button type="submit" class="btn btn-primary full-width" disabled={isLoading}>
          {isLoading ? 'Importing...' : 'Import Identity'}
        </button>

        <button
          type="button"
          class="btn btn-secondary full-width"
          onclick={() => (showImport = false)}
          disabled={isLoading}
        >
          Back to Welcome Screen
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .onboarding-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .onboarding-card {
    width: 100%;
    max-width: 440px;
    padding: 2.5rem 2rem;
  }

  .header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    color: var(--accent-primary);

    h1 {
      font-size: 2rem;
      font-weight: 700;
      color: var(--text-primary);
    }
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin-top: 0.5rem;
  }

  .form-flow {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    label {
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--text-secondary);
    }
  }

  .full-width {
    width: 100%;
  }

  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8rem;

    &::before, &::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--border-color);
    }

    span {
      padding: 0 0.75rem;
    }
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid var(--accent-danger);
    color: #fca5a5;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }
</style>
