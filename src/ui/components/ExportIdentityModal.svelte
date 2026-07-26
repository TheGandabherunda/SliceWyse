<script lang="ts">
  import { identityService } from '../../infrastructure/identity/IdentityService';
  import { X, Key, Eye, EyeOff, Copy, Check, AlertTriangle, ShieldCheck } from 'lucide-svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
  }

  let { isOpen, onClose }: Props = $props();

  let secretKeyNsec = $state<string | null>(null);
  let isRevealed = $state(false);
  let isCopied = $state(false);
  let isExtensionIdentity = $state(false);
  let isLoading = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (isOpen) {
      isRevealed = false;
      isCopied = false;
      secretKeyNsec = null;
      void checkIdentityType();
    } else {
      secretKeyNsec = null;
      isRevealed = false;
    }
  });

  async function checkIdentityType() {
    const current = await identityService.getCurrentIdentity();
    isExtensionIdentity = Boolean(current?.isExtension && !current?.secretKey);
  }

  async function handleRevealKey() {
    if (isRevealed) {
      isRevealed = false;
      return;
    }

    try {
      isLoading = true;
      const nsec = await identityService.exportSecretKeyNsec();
      if (nsec) {
        secretKeyNsec = nsec;
        isRevealed = true;
      }
    } catch {
      // Ignore errors silently for security
    } finally {
      isLoading = false;
    }
  }

  async function handleCopy() {
    if (!secretKeyNsec) {
      const nsec = await identityService.exportSecretKeyNsec();
      if (nsec) {
        secretKeyNsec = nsec;
      }
    }

    if (secretKeyNsec) {
      try {
        await navigator.clipboard.writeText(secretKeyNsec);
        isCopied = true;
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
          isCopied = false;
        }, 2000);
      } catch {
        // Clipboard access fallback
      }
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
      aria-labelledby="export-identity-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="export-identity-title"><Key size={22} /> Identity Backup</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>
      </div>

      <p class="subtitle">Your recovery key controls your identity.</p>

      {#if isExtensionIdentity}
        <div class="extension-notice">
          <ShieldCheck size={28} />
          <p>
            Your identity is managed by your browser extension (NIP-07). Secret key export is not available for extension-based accounts.
          </p>
        </div>
      {:else}
        <div class="export-body">
          <div class="reveal-action-bar">
            <button
              type="button"
              class="btn btn-secondary reveal-btn"
              onclick={handleRevealKey}
              disabled={isLoading}
            >
              {#if isRevealed}
                <EyeOff size={16} /> Hide Secret Key
              {:else}
                <Eye size={16} /> Reveal Secret Key
              {/if}
            </button>
          </div>

          <div class="secret-display-box" class:revealed={isRevealed}>
            {#if isRevealed && secretKeyNsec}
              <code class="secret-text">{secretKeyNsec}</code>
            {:else}
              <span class="masked-text">••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••</span>
            {/if}
          </div>

          <div class="copy-action-bar">
            <button
              type="button"
              class="btn btn-primary copy-btn"
              onclick={handleCopy}
            >
              {#if isCopied}
                <Check size={16} /> Copied!
              {:else}
                <Copy size={16} /> Copy Secret Key
              {/if}
            </button>
          </div>

          <div class="warning-box">
            <AlertTriangle size={20} class="warning-icon" />
            <div class="warning-content">
              <strong>Keep this key safe!</strong>
              <p>
                Anyone with this secret key can access your SliceWyse identity and encrypted groups.
                Store it somewhere safe. Never share it with anyone.
              </p>
            </div>
          </div>
        </div>
      {/if}

      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick={onClose}>Close</button>
      </div>
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
    background: rgba(0, 0, 0, 0.75);
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
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;

    h2 {
      font-size: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-primary);
    }
  }

  .subtitle {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
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

  .export-body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .reveal-action-bar {
    display: flex;
    justify-content: center;
  }

  .reveal-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .secret-display-box {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-sm);
    padding: 1rem;
    text-align: center;
    word-break: break-all;
    font-family: monospace;
    font-size: 0.85rem;
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;

    &.revealed {
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.05);
    }
  }

  .secret-text {
    color: #34d399;
    user-select: all;
  }

  .masked-text {
    color: var(--text-secondary);
    letter-spacing: 2px;
  }

  .copy-action-bar {
    display: flex;
    justify-content: center;
  }

  .copy-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .warning-box {
    display: flex;
    gap: 0.75rem;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.3);
    padding: 1rem;
    border-radius: var(--radius-sm);
    color: #fbbf24;
    font-size: 0.85rem;
    line-height: 1.4;

    p {
      margin-top: 0.25rem;
      color: rgba(255, 255, 255, 0.8);
    }
  }

  .extension-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    padding: 2rem 1rem;
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--radius-sm);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }
</style>
