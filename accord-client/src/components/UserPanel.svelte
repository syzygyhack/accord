<script lang="ts">
	import { userState } from '$lib/state/user.svelte';

	interface Props {
		onsettingsclick?: () => void;
	}

	let { onsettingsclick }: Props = $props();

	let initial = $derived((userState.nick ?? '?')[0].toUpperCase());
</script>

<div class="user-panel">
	<div class="user-row">
		<div class="user-info">
			<div class="user-avatar">
				<span class="avatar-letter">{initial}</span>
				<span class="status-dot"></span>
			</div>
			<div class="user-names">
				<span class="user-nick">{userState.nick ?? 'Unknown'}</span>
				{#if userState.account && userState.account !== userState.nick}
					<span class="user-account">{userState.account}</span>
				{/if}
			</div>
		</div>

		{#if onsettingsclick}
			<button
				class="action-btn"
				onclick={onsettingsclick}
				aria-label="User Settings"
				title="User Settings"
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor" />
				</svg>
			</button>
		{/if}
	</div>
</div>

<style>
	.user-panel {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		padding: 8px 10px;
		background: var(--surface-lowest);
		border-top: 1px solid var(--surface-highest);
	}

	.user-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.user-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.user-avatar {
		position: relative;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
	}

	.avatar-letter {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--accent-primary);
		color: var(--text-inverse, #fff);
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		line-height: 1;
	}

	.status-dot {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--status-online);
		border: 2px solid var(--surface-lowest);
	}

	.user-names {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.user-nick {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
	}

	.user-account {
		font-size: var(--font-xs);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.action-btn:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}
</style>
