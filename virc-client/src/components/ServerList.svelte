<script lang="ts">
	import { serverState, setActiveServer, type ServerInfo } from '$lib/state/servers.svelte';

	function getInitials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0])
			.join('')
			.toUpperCase();
	}
</script>

<nav class="server-list" aria-label="Servers">
	{#each serverState.servers as server (server.id)}
		<div class="server-slot">
			<div
				class="indicator"
				class:active={serverState.activeServerId === server.id}
			></div>
			<button
				class="server-icon"
				class:active={serverState.activeServerId === server.id}
				onclick={() => setActiveServer(server.id)}
				title={server.name}
				aria-label={server.name}
			>
				{#if server.icon}
					<img src={server.icon} alt={server.name} />
				{:else}
					<span class="initials">{getInitials(server.name)}</span>
				{/if}
			</button>
		</div>
	{/each}

	<div class="separator"></div>

	<div class="server-slot">
		<button
			class="server-icon add-server"
			title="Add Server"
			aria-label="Add Server"
			disabled
		>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
	</div>
</nav>

<style>
	.server-list {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 56px;
		min-width: 56px;
		max-width: 56px;
		height: 100%;
		background: var(--surface-lowest);
		padding: 8px 0;
		gap: 4px;
		overflow-y: auto;
	}

	.server-slot {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0 4px;
	}

	.indicator {
		position: absolute;
		left: 0;
		width: 4px;
		height: 0;
		background: var(--text-primary);
		border-radius: 0 4px 4px 0;
		transition: height var(--duration-channel);
	}

	.indicator.active {
		height: 32px;
	}

	.server-icon {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface-base);
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		font-family: var(--font-primary);
		transition:
			border-radius var(--duration-channel),
			background var(--duration-channel),
			color var(--duration-channel);
		overflow: hidden;
	}

	.server-icon:hover {
		border-radius: 12px;
		background: var(--accent-primary);
		color: var(--text-inverse);
	}

	.server-icon.active {
		border-radius: 12px;
		background: var(--accent-primary);
		color: var(--text-inverse);
	}

	.server-icon img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.initials {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		line-height: 1;
	}

	.separator {
		width: 24px;
		height: 2px;
		background: var(--surface-high);
		border-radius: 1px;
		margin: 4px 0;
	}

	.add-server {
		background: var(--surface-base);
		color: var(--success);
	}

	.add-server:hover:not(:disabled) {
		background: var(--success);
		color: var(--text-inverse);
	}

	.add-server:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
