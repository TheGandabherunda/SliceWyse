<script lang="ts">
  import { CreateInviteLinkUseCase } from '../../application/use-cases/CreateInviteLinkUseCase';
  import { X, Link, Copy, Check, Sparkles, Clock } from 'lucide-svelte';

  interface Props {
    isOpen: boolean;
    groupId: string;
    onClose: () => void;
  }

  let { isOpen, groupId, onClose }: Props = $props();

  let inviteUrl = $state('');
  let isLoading = $state(false);
  let isCopied = $state(false);
  let errorMsg = $state('');
  let expirationOption = $state<'never' | '24h' | '7d'>('never');

  const createInviteLink = new CreateInviteLinkUseCase();

  async function generateLink() {
    try {
      isLoading = true;
      errorMsg = '';
      isCopied = false;

      let expiresAt: number | undefined;
      const now = Date.now();
      if (expirationOption === '24h') {
        expiresAt = now + 24 * 60 * 60 * 1000;
      } else if (expirationOption === '7d') {
        expiresAt = now + 7 * 24 * 60 * 60 * 1000;
      }

      const result = await createInviteLink.execute({ groupId, expiresAt });
      inviteUrl = result.inviteUrl;
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to generate invitation link';
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (isOpen && groupId) {
      void generateLink();
    }
  });

  async function copyToClipboard() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      isCopied = true;
      setTimeout(() => {
        isCopied = false;
      }, 2500);
    } catch {
      errorMsg = 'Failed to copy to clipboard';
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
      aria-labelledby="invite-modal-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="invite-modal-title"><Link size={22} /> Invite Member to Group</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>
      </div>

      <div class="modal-body">
        <p class="invite-description">
          Generate a secure, encrypted invitation link. Anyone with this link can accept the invitation and request to join the group.
        </p>

        <div class="form-group">
          <label for="expiration-select">
            <Clock size={16} /> Link Expiration
          </label>
          <select
            id="expiration-select"
            bind:value={expirationOption}
            onchange={generateLink}
            disabled={isLoading}
            class="input-field"
          >
            <option value="never">Never Expire</option>
            <option value="24h">Expires in 24 Hours</option>
            <option value="7d">Expires in 7 Days</option>
          </select>
        </div>

        {#if errorMsg}
          <div class="error-banner">{errorMsg}</div>
        {/if}

        {#if isLoading}
          <div class="loading-state">
            <div class="spinner"></div>
            <span>Generating secure NIP-30078 invitation...</span>
          </div>
        {:else if inviteUrl}
          <div class="link-box">
            <input type="text" readonly value={inviteUrl} class="input-field link-input" />
            <button class="btn btn-primary copy-btn" onclick={copyToClipboard}>
              {#if isCopied}
                <Check size={16} /> Copied!
              {:else}
                <Copy size={16} /> Copy Link
              {/if}
            </button>
          </div>
          <p class="security-note">
            <Sparkles size={14} /> Ephemeral bearer key is embedded in the link fragment. The group key remains encrypted inside the Kind 30078 payload.
          </p>
        {/if}
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
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    width: 100%;
    max-width: 520px;
    padding: 1.75rem;
    border-radius: 16px;
    box-shadow: var(--shadow-xl);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;

    h2 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 700;
    }
  }

  .invite-description {
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
    margin-bottom: 1.25rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.25rem;

    label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-secondary);
    }
  }

  .input-field {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.9rem;
  }

  .link-box {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .link-input {
    font-family: monospace;
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-btn {
    white-space: nowrap;
  }

  .security-note {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .error-banner {
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .loading-state {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1.5rem;
    justify-content: center;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
