<script lang="ts">
	import { userState } from '$lib/state/user.svelte';

	interface Props {
		onsettingsclick: () => void;
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

		<button
			class="action-btn settings-btn"
			onclick={onsettingsclick}
			aria-label="User Settings"
			title="User Settings"
		>
			<svg width="16" height="16" viewBox="0 0 24 24">
				<path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.14 7.14 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.39 1.08.73 1.69.98l.38 2.65c.05.24.26.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.49.49 0 0 0-.12-.64l-2.11-1.65z" fill="currentColor" />
			</svg>
		</button>
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
