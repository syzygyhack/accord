<script lang="ts">
	/**
	 * Displays connection error banner or splash/loading screen.
	 * Rendered inside the message area when there's no active channel content.
	 */
	interface Props {
		error: string | null;
		connecting: boolean;
		onlogout: () => void;
	}

	let { error, connecting, onlogout }: Props = $props();
</script>

{#if error}
	<div class="error-banner">
		<span>Connection error: {error}</span>
		<button class="error-logout-btn" onclick={onlogout}>Log Out</button>
	</div>
{:else if connecting}
	<div class="splash-screen">
		<div class="splash-spinner"></div>
		<span class="splash-text">Connecting to server...</span>
		<button class="splash-logout-btn" onclick={onlogout}>Log Out</button>
	</div>
{/if}

<style>
	.error-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 8px 16px;
		background: var(--danger);
		color: var(--text-inverse);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
	}

	.error-logout-btn {
		padding: 4px 12px;
		background: rgba(255, 255, 255, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.4);
		border-radius: 4px;
		color: var(--text-inverse);
		font-size: var(--font-sm);
		cursor: pointer;
	}

	.error-logout-btn:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	.splash-screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
	}

	.splash-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--surface-high);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: splash-spin 0.8s linear infinite;
	}

	.splash-text {
		color: var(--text-secondary);
		font-size: var(--font-base);
	}

	.splash-logout-btn {
		margin-top: 8px;
		padding: 6px 16px;
		background: none;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		color: var(--text-secondary);
		font-size: var(--font-sm);
		cursor: pointer;
		transition: color var(--duration-channel), border-color var(--duration-channel);
	}

	.splash-logout-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	@keyframes splash-spin {
		to { transform: rotate(360deg); }
	}
</style>
