<script lang="ts">
	import { goto } from '$app/navigation';
	import { clearCredentials, clearToken } from '$lib/api/auth';

	interface Props {
		visible: boolean;
	}

	let { visible }: Props = $props();

	function handleLogin(): void {
		clearCredentials();
		clearToken();
		goto('/login');
	}
</script>

{#if visible}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="auth-overlay">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="auth-dialog">
			<div class="auth-icon">
				<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor">
					<path d="M20 2a18 18 0 110 36A18 18 0 0120 2zm0 25.2a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4zM21.8 9h-3.6l.5 14h2.6l.5-14z"/>
				</svg>
			</div>
			<h3 class="auth-title">Session Expired</h3>
			<p class="auth-text">Session expired. Please log in again.</p>
			<button class="auth-btn" onclick={handleLogin}>Log In</button>
		</div>
	</div>
{/if}

<style>
	.auth-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.auth-dialog {
		background: var(--surface-low);
		border-radius: 8px;
		padding: 32px;
		max-width: 360px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		text-align: center;
	}

	.auth-icon {
		color: var(--warning);
		margin-bottom: 12px;
	}

	.auth-title {
		margin: 0 0 8px;
		font-size: var(--font-lg);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.auth-text {
		margin: 0 0 24px;
		font-size: var(--font-base);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.auth-btn {
		padding: 10px 32px;
		border: none;
		border-radius: 4px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		font-family: var(--font-primary);
		font-size: var(--font-base);
		font-weight: var(--weight-semibold);
		cursor: pointer;
		transition: background 150ms ease;
	}

	.auth-btn:hover {
		background: var(--accent-secondary);
	}
</style>
