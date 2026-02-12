<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	let error: Error | null = $state(null);

	function handleError(e: unknown): void {
		error = e instanceof Error ? e : new Error(String(e));
		console.error('[ErrorBoundary] Component error caught:', error);
	}

	function handleRetry(): void {
		error = null;
	}
</script>

<svelte:boundary onerror={handleError}>
	{#if error}
		<div class="error-boundary">
			<div class="error-boundary-content">
				<svg class="error-boundary-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 2a10 10 0 110 20 10 10 0 0112-20zm0 14.5a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zM13 6h-2l.25 8h1.5L13 6z"/>
				</svg>
				<p class="error-boundary-text">Something went wrong.</p>
				<p class="error-boundary-detail">{error.message}</p>
				<button class="error-boundary-btn" onclick={handleRetry}>Try Again</button>
			</div>
		</div>
	{:else}
		{@render children()}
	{/if}
</svelte:boundary>

<style>
	.error-boundary {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px 16px;
		flex: 1;
	}

	.error-boundary-content {
		text-align: center;
		max-width: 320px;
	}

	.error-boundary-icon {
		color: var(--danger);
		margin-bottom: 8px;
	}

	.error-boundary-text {
		margin: 0 0 4px;
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.error-boundary-detail {
		margin: 0 0 16px;
		font-size: var(--font-sm);
		color: var(--text-muted);
		font-family: var(--font-mono);
		word-break: break-word;
	}

	.error-boundary-btn {
		padding: 8px 20px;
		border: none;
		border-radius: 4px;
		background: var(--surface-high);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background 150ms ease;
	}

	.error-boundary-btn:hover {
		background: var(--surface-highest);
	}
</style>
