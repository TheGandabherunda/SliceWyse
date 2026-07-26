<script lang="ts">
  import { onMount } from 'svelte';
  import { AcceptInviteLinkUseCase } from '../../application/use-cases/AcceptInviteLinkUseCase';
  import { relayManager } from '../../infrastructure/nostr/RelayManager';
  import { Users, Check, AlertCircle, ArrowRight } from 'lucide-svelte';

  interface Props {
    groupId: string;
    invKeyHex: string;
    onJoined: (groupId: string) => void;
    onCancel: () => void;
  }

  let { groupId, invKeyHex, onJoined, onCancel }: Props = $props();

  let groupName = $state('Loading invitation...');
  let currency = $state('');
  let inviterPubkey = $state('');
  let expiresAt = $state<number | undefined>();
  let encryptedContent = $state('');
  let isLoading = $state(true);
  let isAccepting = $state(false);
  let errorMsg = $state('');

  const acceptInviteLink = new AcceptInviteLinkUseCase();

  onMount(() => {
    void fetchInvitationEvent();
  });

  async function fetchInvitationEvent() {
    try {
      isLoading = true;
      errorMsg = '';

      // Query Kind 30078 event for the group from Nostr relays
      const events = await relayManager.queryEvents([
        { kinds: [30078], '#d': [groupId], limit: 1 },
      ]);

      if (events.length === 0) {
        throw new Error(`Invitation event for group "${groupId}" not found on relays.`);
      }

      const inviteEvent = events[0];
      encryptedContent = inviteEvent.content;

      // Decrypt payload to pre-display group name & details to user before accepting
      const aesService = (await import('../../infrastructure/crypto/AesGcmCryptoService')).aesGcmCryptoService;
      const decryptedJson = await aesService.decrypt(encryptedContent, invKeyHex);
      const payload = JSON.parse(decryptedJson);

      groupName = payload.groupName || 'Unnamed Group';
      currency = payload.currency || 'USD';
      inviterPubkey = payload.inviterPubkey || inviteEvent.pubkey;
      expiresAt = payload.expiresAt;

      if (expiresAt && expiresAt < Date.now()) {
        throw new Error('This invitation link has expired.');
      }
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to load group invitation.';
    } finally {
      isLoading = false;
    }
  }

  async function handleAccept() {
    try {
      isAccepting = true;
      errorMsg = '';

      const joinedGroup = await acceptInviteLink.execute({
        groupId,
        invKeyHex,
        encryptedEventContent: encryptedContent,
      });

      onJoined(joinedGroup.id);
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : 'Failed to accept invitation.';
    } finally {
      isAccepting = false;
    }
  }
</script>

<div class="modal-backdrop">
  <div class="glass-card modal-content" role="dialog" aria-labelledby="join-modal-title">
    <div class="modal-header">
      <h2 id="join-modal-title"><Users size={22} /> Group Invitation</h2>
    </div>

    <div class="modal-body">
      {#if isLoading}
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Decrypting Kind 30078 group invitation...</span>
        </div>
      {:else if errorMsg}
        <div class="error-box">
          <AlertCircle size={24} />
          <p>{errorMsg}</p>
          <button class="btn btn-secondary" onclick={onCancel}>Close</button>
        </div>
      {:else}
        <div class="invitation-details">
          <h3>{groupName}</h3>
          <p class="meta-info">Currency: <strong>{currency}</strong></p>
          {#if inviterPubkey}
            <p class="meta-info">Invited by: <code>{inviterPubkey.slice(0, 8)}...{inviterPubkey.slice(-6)}</code></p>
          {/if}

          <div class="action-buttons">
            <button class="btn btn-secondary" onclick={onCancel} disabled={isAccepting}>
              Cancel
            </button>
            <button class="btn btn-primary" onclick={handleAccept} disabled={isAccepting}>
              {#if isAccepting}
                <div class="btn-spinner"></div> Joining...
              {:else}
                Join Group <ArrowRight size={16} />
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    width: 100%;
    max-width: 480px;
    padding: 2rem;
    border-radius: 16px;
    box-shadow: var(--shadow-xl);
  }

  .modal-header h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.35rem;
    font-weight: 700;
    margin-bottom: 1.25rem;
  }

  .loading-state {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 0;
    justify-content: center;
    color: var(--text-secondary);
  }

  .spinner, .btn-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .invitation-details h3 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .meta-info {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin-bottom: 0.35rem;

    code {
      background: var(--bg-tertiary);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }
  }

  .action-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.75rem;
  }

  .error-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem 0;
    text-align: center;
    color: #ef4444;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
