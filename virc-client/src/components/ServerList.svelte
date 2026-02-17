<script lang="ts">
	import { serverState, setActiveServer, removeServer, reorderServers, type ServerInfo } from '$lib/state/servers.svelte';
	import { channelUIState } from '$lib/state/channels.svelte';
	import { notificationState, getUnreadCount, getMentionCount, markAllRead } from '$lib/state/notifications.svelte';

	interface Props {
		onserversettings?: () => void;
	}

	let { onserversettings }: Props = $props();

	/**
	 * Aggregate a per-channel count across all channels for a server.
	 * Currently all channels belong to the single connected server, so
	 * we sum across everything. When multi-server lands, this will filter
	 * by server-owned channels.
	 */
	function aggregateAcrossChannels(_serverId: string, fn: (ch: string) => number): number {
		// Touch reactive state
		void notificationState.channels;
		let total = 0;
		for (const cat of channelUIState.categories) {
			for (const ch of cat.channels) {
				total += fn(ch);
			}
		}
		for (const dm of channelUIState.dmConversations) {
			total += fn(dm.nick);
		}
		return total;
	}

	function getServerUnread(serverId: string): number {
		return aggregateAcrossChannels(serverId, getUnreadCount);
	}

	function getServerMentions(serverId: string): number {
		return aggregateAcrossChannels(serverId, getMentionCount);
	}

	/**
	 * Generate a 2-letter abbreviation from a server name.
	 * Takes the first letter of the first two words, or the first two letters
	 * if only one word.
	 */
	function abbreviation(name: string): string {
		const words = name.trim().split(/\s+/);
		if (words.length >= 2) {
			return (words[0][0] + words[1][0]).toUpperCase();
		}
		return name.slice(0, 2).toUpperCase();
	}

	/**
	 * Deterministic background color from a string.
	 * Produces a muted hue suitable for dark backgrounds.
	 */
	function hashedColor(name: string): string {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		const hue = Math.abs(hash) % 360;
		return `hsl(${hue}, 50%, 40%)`;
	}

	function handleServerClick(id: string): void {
		setActiveServer(id);
	}

	// --- Context menu ---

	let contextMenu: { serverId: string; x: number; y: number } | null = $state(null);

	function handleContextMenu(e: MouseEvent, serverId: string): void {
		e.preventDefault();
		contextMenu = { serverId, x: e.clientX, y: e.clientY };
	}

	function closeContextMenu(): void {
		contextMenu = null;
	}

	function handleMarkAsRead(): void {
		if (!contextMenu) return;
		markAllRead();
		closeContextMenu();
	}

	function handleCopyInviteLink(): void {
		if (!contextMenu) return;
		const server = serverState.servers.find((s) => s.id === contextMenu!.serverId);
		if (server) {
			navigator.clipboard.writeText(server.url).catch(() => {
				// Clipboard write failed — silently ignore
			});
		}
		closeContextMenu();
	}

	function handleDisconnect(): void {
		// Placeholder — actual disconnect logic lives in the IRC connection layer.
		// For now just close the menu; the disconnect action will be wired when
		// multi-server connection management is implemented.
		closeContextMenu();
	}

	function handleRemove(): void {
		if (!contextMenu) return;
		removeServer(contextMenu.serverId);
		closeContextMenu();
	}

	function handleServerSettings(): void {
		closeContextMenu();
		onserversettings?.();
	}

	// --- Drag to reorder ---

	let dragIndex: number | null = $state(null);
	let dragOverIndex: number | null = $state(null);

	function handleDragStart(e: DragEvent, index: number): void {
		dragIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleDragOver(e: DragEvent, index: number): void {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		dragOverIndex = index;
	}

	function handleDragLeave(): void {
		dragOverIndex = null;
	}

	function handleDrop(e: DragEvent, toIndex: number): void {
		e.preventDefault();
		if (dragIndex !== null && dragIndex !== toIndex) {
			reorderServers(dragIndex, toIndex);
		}
		dragIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd(): void {
		dragIndex = null;
		dragOverIndex = null;
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav class="server-list" aria-label="Servers" onclick={closeContextMenu}>
	<div class="server-items">
		{#each serverState.servers as server, index (server.id)}
			{@const isActive = serverState.activeServerId === server.id}
			{@const unread = getServerUnread(server.id)}
			{@const mentions = getServerMentions(server.id)}
			<div
				class="server-item"
				class:active={isActive}
				class:drag-over={dragOverIndex === index && dragIndex !== index}
				draggable="true"
				ondragstart={(e) => handleDragStart(e, index)}
				ondragover={(e) => handleDragOver(e, index)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, index)}
				ondragend={handleDragEnd}
			>
				<!-- Left-edge indicators -->
				<div class="indicator" class:active={isActive} class:unread={!isActive && unread > 0}></div>

				<button
					class="server-icon"
					class:active={isActive}
					onclick={() => handleServerClick(server.id)}
					oncontextmenu={(e) => handleContextMenu(e, server.id)}
					title={server.name}
					aria-label={server.name}
					aria-current={isActive ? 'true' : undefined}
				>
					{#if server.icon}
						<img src={server.icon} alt="" class="server-img" />
					{:else}
						<span
							class="server-abbrev"
							style="background-color: {hashedColor(server.name)}"
						>{abbreviation(server.name)}</span>
					{/if}
				</button>

				<!-- Mention badge -->
				{#if mentions > 0}
					<div class="mention-badge" aria-label="{mentions} mentions">
						{mentions > 99 ? '99+' : mentions}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Add server button -->
	<div class="server-item add-server">
		<button
			class="server-icon add-btn"
			title="Add Server"
			aria-label="Add Server"
		>
			<span class="add-icon">+</span>
		</button>
	</div>
</nav>

<!-- Server context menu -->
{#if contextMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="context-menu-overlay" onclick={closeContextMenu} oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="context-menu"
			style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => { if (e.key === 'Escape') closeContextMenu(); }}
			role="menu"
		>
			<button class="context-item" role="menuitem" onclick={handleServerSettings}>Server Settings</button>
			<button class="context-item" role="menuitem" onclick={handleMarkAsRead}>Mark as Read</button>
			<button class="context-item" role="menuitem" onclick={handleCopyInviteLink}>Copy Invite Link</button>
			<div class="context-separator"></div>
			<button class="context-item" role="menuitem" onclick={handleDisconnect}>Disconnect</button>
			<button class="context-item danger" role="menuitem" onclick={handleRemove}>Remove</button>
		</div>
	</div>
{/if}

<style>
	.server-list {
		width: 56px;
		min-width: 56px;
		height: 100%;
		background: var(--surface-lowest);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 8px 0;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: none;
	}

	.server-list::-webkit-scrollbar {
		display: none;
	}

	.server-items {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		flex: 1;
	}

	.server-item {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 48px;
	}

	/* Left-edge indicator pill */
	.indicator {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 2px;
		height: 0;
		background: var(--interactive-active);
		border-radius: 0 2px 2px 0;
		transition: height var(--duration-channel) ease;
	}

	.indicator.active {
		height: 40px;
	}

	.indicator.unread {
		height: 8px;
		border-radius: 50%;
		width: 8px;
		left: -1px;
	}

	/* Server icon button */
	.server-icon {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: none;
		padding: 0;
		cursor: pointer;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-high);
		transition: border-radius var(--duration-channel) ease,
			background var(--duration-channel) ease;
	}

	.server-icon:hover {
		border-radius: 30%;
	}

	.server-icon.active {
		border-radius: 30%;
	}

	/* Hover indicator: show shorter pill on hover when not active and not unread */
	.server-item:not(.active):hover > .indicator:not(.unread) {
		height: 20px;
	}

	.server-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.server-abbrev {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-inverse);
		line-height: 1;
		user-select: none;
	}

	/* Mention badge (bottom-right of icon) */
	.mention-badge {
		position: absolute;
		bottom: 0;
		right: 2px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background: var(--danger);
		color: var(--text-inverse);
		font-size: 10px;
		font-weight: var(--weight-bold);
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		pointer-events: none;
		box-shadow: 0 0 0 2px var(--surface-lowest);
	}

	/* Add server button */
	.add-server {
		margin-top: auto;
		padding-bottom: 4px;
	}

	.add-btn {
		background: var(--surface-high);
		color: var(--status-online);
		transition: border-radius var(--duration-channel) ease,
			background var(--duration-channel) ease,
			color var(--duration-channel) ease;
	}

	.add-btn:hover {
		background: var(--status-online);
		color: var(--text-inverse);
		border-radius: 30%;
	}

	.add-icon {
		font-size: var(--font-lg);
		font-weight: var(--weight-normal);
		line-height: 1;
	}

	/* Drag-and-drop visual feedback */
	.server-item.drag-over {
		border-top: 2px solid var(--accent-primary);
	}

	/* Context menu overlay + menu */
	.context-menu-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
	}

	.context-menu {
		position: fixed;
		min-width: 180px;
		background: var(--surface-highest);
		border-radius: 6px;
		padding: 4px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		z-index: 1001;
	}

	.context-item {
		display: block;
		width: 100%;
		padding: 6px 8px;
		background: none;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		color: var(--text-primary);
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		text-align: left;
		transition: background 80ms;
	}

	.context-item:hover {
		background: var(--accent-bg);
		color: var(--accent-primary);
	}

	.context-item.danger {
		color: var(--danger);
	}

	.context-item.danger:hover {
		background: var(--danger);
		color: var(--text-inverse);
	}

	.context-separator {
		height: 1px;
		background: var(--surface-high);
		margin: 4px 0;
	}
</style>
