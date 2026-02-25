<script lang="ts">
	import { connectionState } from '$lib/state/connection.svelte';

	let isReconnecting = $derived(connectionState.status === 'reconnecting');
	let isOffline = $derived(!connectionState.isOnline);
	let visible = $derived(isReconnecting || isOffline);
	let attempt = $derived(connectionState.reconnectAttempt);
</script>

{#if visible}
	<div class="connection-banner" role="alert" aria-live="assertive">
		<span class="banner-dot"></span>
		<span class="banner-text">
			{#if isOffline}
				You're offline. Waiting for network...
			{:else}
				Connection lost. Reconnecting...
				{#if attempt > 0}
					<span class="banner-attempt">Attempt {attempt}</span>
				{/if}
			{/if}
		</span>
	</div>
{/if}

<style>
	.connection-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 6px 16px;
		background: var(--warning, #e6a817);
		color: var(--surface-lowest, #1a1a1a);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		animation: banner-pulse 2s ease-in-out infinite;
		flex-shrink: 0;
		z-index: 10;
	}

	.banner-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--surface-lowest, #1a1a1a);
		opacity: 0.7;
		animation: dot-blink 1.4s ease-in-out infinite;
	}

	.banner-text {
		line-height: 1;
	}

	.banner-attempt {
		opacity: 0.7;
		margin-left: 4px;
	}

	@keyframes banner-pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.85;
		}
	}

	@keyframes dot-blink {
		0%, 100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}
</style>
