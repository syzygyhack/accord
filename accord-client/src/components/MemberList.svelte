<script lang="ts">
	import { memberState, getMember, getMembersByRole, type Member } from '$lib/state/members.svelte';
	import { channelUIState, openDM } from '$lib/state/channels.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { nickColor } from '$lib/irc/format';
	import { themeState } from '$lib/state/theme.svelte';
	import { getRoleColor } from '$lib/state/serverConfig.svelte';
	import { formatMessage } from '$lib/irc/parser';
	import { DEFAULT_ROLES, MODE_ORDER } from '$lib/constants';
	import type { IRCConnection } from '$lib/irc/connection';
	import UserProfilePopout from './UserProfilePopout.svelte';
	import Avatar from './Avatar.svelte';
	import { handleMenuKeydown, focusFirst } from '$lib/utils/a11y';

	/** Estimated height per member row (px) — used for virtual scroll spacers. */
	const ROW_HEIGHT = 28;
	/** Overscan rows above/below the visible window. */
	const OVERSCAN = 10;

	/** Delay in ms before showing hover card. */
	const HOVER_DELAY = 400;

	interface RoleGroup {
		key: string;
		name: string;
		members: Member[];
		collapsed: boolean;
	}

	interface Props {
		/** Callback to insert @nick into message input. */
		onmention?: (nick: string) => void;
		/** IRC connection for mod actions (kick/ban/mute). */
		connection?: IRCConnection | null;
	}

	let { onmention, connection = null }: Props = $props();

	/** Track collapsed state per group key. */
	let collapsedGroups: Record<string, boolean> = $state({});

	/** Context menu state. */
	let contextMenu: { nick: string; x: number; y: number } | null = $state(null);

	/** Profile popout state. */
	let profilePopout: { nick: string; account: string; x: number; y: number } | null = $state(null);

	/** Hover card state. */
	let hoverCard: { member: Member; x: number; y: number } | null = $state(null);
	let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

	/** Whether the current user has op (@) or higher in the active channel. */
	let isOp = $derived.by(() => {
		const channel = channelUIState.activeChannel;
		if (!channel || !userState.nick) return false;
		const member = getMember(channel, userState.nick);
		if (!member || !member.highestMode) return false;
		return ['~', '&', '@'].includes(member.highestMode);
	});

	/**
	* Build role groups from member state. Groups members by highest mode,
	* then splits no-mode members into Online/Offline.
	*/
	let roleGroups = $derived.by((): RoleGroup[] => {
		const channel = channelUIState.activeChannel;
		if (!channel) return [];

		const byRole = getMembersByRole(channel);
		const groups: RoleGroup[] = [];

		// Add mode-based groups in order
		for (const mode of MODE_ORDER) {
			const members = byRole.get(mode);
			if (members && members.length > 0) {
				const role = DEFAULT_ROLES[mode];
				groups.push({
					key: mode,
					name: role?.name ?? mode,
					members,
					collapsed: collapsedGroups[mode] ?? false,
				});
			}
		}

		// Split no-mode members into Online and Offline
		const noMode = byRole.get('') ?? [];
		const online = noMode.filter((m) => m.presence !== 'offline');
		const offline = noMode.filter((m) => m.presence === 'offline');

		if (online.length > 0) {
			groups.push({
				key: 'online',
				name: 'Online',
				members: online,
				collapsed: collapsedGroups['online'] ?? false,
			});
		}

		if (offline.length > 0) {
			groups.push({
				key: 'offline',
				name: 'Offline',
				members: offline,
				collapsed: collapsedGroups['offline'] ?? false,
			});
		}

		return groups;
	});

	/** Total member count for the header. */
	let totalMembers = $derived.by((): number => {
		const channel = channelUIState.activeChannel;
		if (!channel) return 0;
		const map = memberState.channels.get(channel.toLowerCase());
		return map ? map.size : 0;
	});

	function toggleGroup(key: string): void {
		collapsedGroups[key] = !collapsedGroups[key];
	}

	/** Get presence dot character and CSS class for a member. */
	function presenceInfo(member: Member): { dot: string; className: string } {
		switch (member.presence) {
			case 'online':
				return { dot: '\u25CF', className: 'presence-online' };    // filled circle
			case 'idle':
				return { dot: '\u25D1', className: 'presence-idle' };      // half circle
			case 'dnd':
				return { dot: '\u25CF', className: 'presence-dnd' };       // filled circle
			case 'offline':
				return { dot: '\u25CB', className: 'presence-offline' };   // empty circle
		}
	}

	/** Get nick color: role color if available, otherwise hash-based. */
	function getMemberColor(member: Member): string {
		if (member.highestMode) {
			const color = getRoleColor(member.highestMode);
			if (color) return color;
		}
		return nickColor(member.account, themeState.current);
	}

	// --- Context menu ---

	/** Open context menu on right-click. */
	function handleContextMenu(event: MouseEvent, nick: string): void {
		event.preventDefault();
		dismissHoverCard();
		contextMenu = { nick, x: event.clientX, y: event.clientY };
	}

	/** Open context menu via keyboard (Enter/Space on focused member). */
	function handleMemberKeydown(event: KeyboardEvent, nick: string): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			dismissHoverCard();
			const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
			contextMenu = { nick, x: rect.left + rect.width / 2, y: rect.bottom };
		}
	}

	/** Close context menu. */
	function closeContextMenu(): void {
		contextMenu = null;
	}

	/** "Send Message" from context menu: open/focus DM conversation. */
	function handleSendMessage(): void {
		if (!contextMenu) return;
		openDM(contextMenu.nick);
		closeContextMenu();
	}

	/** "Mention" from context menu: insert @nick into message input. */
	function handleMention(): void {
		if (!contextMenu) return;
		onmention?.(contextMenu.nick);
		closeContextMenu();
	}

	/** "View Profile" from context menu: open full profile popout. */
	function handleViewProfile(): void {
		if (!contextMenu) return;
		const channel = channelUIState.activeChannel;
		if (!channel) { closeContextMenu(); return; }
		const member = getMember(channel, contextMenu.nick);
		profilePopout = {
			nick: contextMenu.nick,
			account: member?.account ?? contextMenu.nick,
			x: contextMenu.x,
			y: contextMenu.y,
		};
		closeContextMenu();
	}

	/** "Kick" from context menu. */
	function handleKick(): void {
		if (!contextMenu || !connection) return;
		const channel = channelUIState.activeChannel;
		if (!channel) { closeContextMenu(); return; }
		connection.send(formatMessage('KICK', channel, contextMenu.nick));
		closeContextMenu();
	}

	/** "Ban" from context menu. */
	function handleBan(): void {
		if (!contextMenu || !connection) return;
		const channel = channelUIState.activeChannel;
		if (!channel) { closeContextMenu(); return; }
		connection.send(formatMessage('MODE', channel, '+b', `${contextMenu.nick}!*@*`));
		closeContextMenu();
	}

	/** "Mute" from context menu. */
	function handleMute(): void {
		if (!contextMenu || !connection) return;
		const channel = channelUIState.activeChannel;
		if (!channel) { closeContextMenu(); return; }
		connection.send(formatMessage('MODE', channel, '+q', `${contextMenu.nick}!*@*`));
		closeContextMenu();
	}

	/** Close context menu when clicking outside. */
	function handleWindowClick(): void {
		if (contextMenu) {
			closeContextMenu();
		}
	}

	// --- Profile popout ---

	/** Open profile popout on left-click of a member. */
	function handleMemberClick(event: MouseEvent, member: Member): void {
		// Don't open popout if this was a right-click (context menu handles that)
		if (event.button !== 0) return;
		event.stopPropagation();
		closeContextMenu();
		dismissHoverCard();
		profilePopout = {
			nick: member.nick,
			account: member.account,
			x: event.clientX,
			y: event.clientY,
		};
	}

	/** Close profile popout. */
	function closeProfilePopout(): void {
		profilePopout = null;
	}

	// --- Hover card ---

	function clearHoverTimeout(): void {
		if (hoverTimeout !== null) {
			clearTimeout(hoverTimeout);
			hoverTimeout = null;
		}
	}

	/** Dismiss hover card and cancel pending timeout. */
	function dismissHoverCard(): void {
		clearHoverTimeout();
		hoverCard = null;
	}

	/** Show hover card after a delay. */
	function handleMemberMouseEnter(event: MouseEvent, member: Member): void {
		// Don't show hover card if context menu or profile popout is open
		if (contextMenu || profilePopout) return;
		clearHoverTimeout();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		hoverTimeout = setTimeout(() => {
			hoverCard = { member, x: rect.left, y: rect.top };
		}, HOVER_DELAY);
	}

	/** Hide hover card on mouse leave. */
	function handleMemberMouseLeave(): void {
		dismissHoverCard();
	}

	/** Get presence label for hover card. */
	function presenceLabel(member: Member): string {
		switch (member.presence) {
			case 'online': return 'Online';
			case 'idle': return member.awayReason ?? 'Idle';
			case 'dnd': return 'Do Not Disturb';
			case 'offline': return 'Offline';
		}
	}

	/** Get role name for hover card display. */
	function roleName(member: Member): string | null {
		if (!member.highestMode) return null;
		return DEFAULT_ROLES[member.highestMode]?.name ?? null;
	}

	// --- Virtual scroll ---

	let scrollEl: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let scrollHeight = $state(600);

	// Measure actual container height once mounted so the first render
	// doesn't rely on the 600px default.
	$effect(() => {
		if (scrollEl) {
			scrollHeight = scrollEl.clientHeight;
		}
	});

	function handleScroll(e: Event): void {
		const el = e.currentTarget as HTMLElement;
		scrollTop = el.scrollTop;
		scrollHeight = el.clientHeight;
	}

	/**
	 * Compute the visible slice of a member array based on current scroll
	 * position and the group's vertical offset within the scroll container.
	 * Returns { startIndex, endIndex, topSpacer, bottomSpacer } for the group.
	 */
	function getVisibleSlice(
		members: Member[],
		groupOffsetPx: number,
	): { start: number; end: number; topPx: number; bottomPx: number } {
		const total = members.length;
		if (total === 0) return { start: 0, end: 0, topPx: 0, bottomPx: 0 };

		const viewTop = scrollTop;
		const viewBottom = scrollTop + scrollHeight;

		// Calculate which rows are visible relative to the group offset
		const firstVisible = Math.floor((viewTop - groupOffsetPx) / ROW_HEIGHT) - OVERSCAN;
		const lastVisible = Math.ceil((viewBottom - groupOffsetPx) / ROW_HEIGHT) + OVERSCAN;

		const start = Math.max(0, firstVisible);
		const end = Math.min(total, lastVisible);

		return {
			start,
			end,
			topPx: start * ROW_HEIGHT,
			bottomPx: Math.max(0, (total - end) * ROW_HEIGHT),
		};
	}

	/**
	 * Cumulative group offsets: each group header is ~30px, each expanded
	 * member row is ROW_HEIGHT. Pre-compute to pass to getVisibleSlice.
	 */
	let groupOffsets = $derived.by((): number[] => {
		const offsets: number[] = [];
		let y = 0; // Start after the member-header element
		for (const group of roleGroups) {
			offsets.push(y);
			y += 30; // Role header height
			if (!group.collapsed) {
				y += group.members.length * ROW_HEIGHT;
			}
		}
		return offsets;
	});
</script>

<svelte:window onclick={handleWindowClick} />

<aside class="member-list" aria-label="Members">
	<div class="member-header">
		<span class="member-header-text">Members — {totalMembers}</span>
	</div>

	<div class="member-scroll" bind:this={scrollEl} onscroll={handleScroll}>
		{#if roleGroups.length === 0}
			<div class="empty-state">
				<span class="empty-state-text">It's quiet... nobody else is online</span>
			</div>
		{/if}
		{#each roleGroups as group, groupIdx (group.key)}
			{@const slice = !group.collapsed ? getVisibleSlice(group.members, groupOffsets[groupIdx] ?? 0) : { start: 0, end: 0, topPx: 0, bottomPx: 0 }}
			<div class="role-group">
				<button
					class="role-header"
					onclick={() => toggleGroup(group.key)}
					aria-expanded={!group.collapsed}
					aria-label="{group.name} — {group.members.length}"
				>
					<svg
						class="chevron"
						class:collapsed={group.collapsed}
						width="10"
						height="10"
						viewBox="0 0 10 10"
					>
						<path d="M2 3l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
					</svg>
					<span class="role-name">{group.name}</span>
					<span class="role-count"> — {group.members.length}</span>
				</button>

				{#if !group.collapsed}
					<div class="role-members" role="list" aria-label="{group.name} members">
						{#if slice.topPx > 0}
							<div style="height: {slice.topPx}px;" aria-hidden="true"></div>
						{/if}
						{#each group.members.slice(slice.start, slice.end) as member (member.nick)}
							{@const presence = presenceInfo(member)}
							{@const color = getMemberColor(member)}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<div
								class="member-row"
								role="listitem"
								tabindex="0"
								onclick={(e) => handleMemberClick(e, member)}
								oncontextmenu={(e) => handleContextMenu(e, member.nick)}
								onkeydown={(e) => handleMemberKeydown(e, member.nick)}
								onmouseenter={(e) => handleMemberMouseEnter(e, member)}
								onmouseleave={handleMemberMouseLeave}
							>
								<div class="member-avatar-wrapper">
									<Avatar account={member.account} nick={member.nick} channel={channelUIState.activeChannel ?? ''} size="sm" />
									<span class="member-presence-indicator {presence.className}"></span>
								</div>
								<span class="sr-only">{presence.className}</span>
								<span class="member-nick" style="color: {color}">{member.nick}</span>
							</div>
						{/each}
						{#if slice.bottomPx > 0}
							<div style="height: {slice.bottomPx}px;" aria-hidden="true"></div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</aside>

<!-- Context menu -->
{#if contextMenu}
	<div
		class="context-menu"
		role="menu"
		tabindex="-1"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => handleMenuKeydown(e, e.currentTarget as HTMLElement, closeContextMenu)}
		use:focusFirst
	>
		<button class="context-item" role="menuitem" onclick={handleSendMessage}>Send Message</button>
		<button class="context-item" role="menuitem" onclick={handleMention}>Mention</button>
		<div class="context-separator"></div>
		{#if isOp && connection}
			<button class="context-item context-item--danger" role="menuitem" onclick={handleKick}>Kick</button>
			<button class="context-item context-item--danger" role="menuitem" onclick={handleBan}>Ban</button>
			<button class="context-item context-item--danger" role="menuitem" onclick={handleMute}>Mute</button>
			<div class="context-separator"></div>
		{/if}
		<button class="context-item" role="menuitem" onclick={handleViewProfile}>View Profile</button>
	</div>
{/if}

<!-- Hover card -->
{#if hoverCard}
	{@const hMember = hoverCard.member}
	{@const hColor = getMemberColor(hMember)}
	{@const hPresence = presenceInfo(hMember)}
	{@const hRole = roleName(hMember)}
	<div
		class="hover-card"
		role="tooltip"
		style="left: {hoverCard.x - 220}px; top: {hoverCard.y}px;"
	>
		<div class="hover-card-header">
			<span class="hover-card-nick" style="color: {hColor}">{hMember.nick}</span>
			{#if hMember.account && hMember.account !== hMember.nick}
				<span class="hover-card-account">@{hMember.account}</span>
			{/if}
		</div>
		{#if hRole}
			<div class="hover-card-role">{hRole}</div>
		{/if}
		<div class="hover-card-status">
			<span class="presence-dot {hPresence.className}">{hPresence.dot}</span>
			<span class="hover-card-status-text">{presenceLabel(hMember)}</span>
		</div>
	</div>
{/if}

<!-- User profile popout -->
{#if profilePopout}
	<UserProfilePopout
		nick={profilePopout.nick}
		account={profilePopout.account}
		position={{ x: profilePopout.x, y: profilePopout.y }}
		onclose={closeProfilePopout}
	/>
{/if}

<style>
	.member-list {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.member-header {
		display: flex;
		align-items: center;
		padding: 12px 16px 8px;
		flex-shrink: 0;
	}

	.member-header-text {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.member-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px 8px;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px 16px;
	}

	.empty-state-text {
		font-size: var(--font-sm);
		color: var(--text-muted);
		font-style: italic;
		text-align: center;
	}

	/* Role group */
	.role-group {
		margin-bottom: 4px;
	}

	.role-header {
		display: flex;
		align-items: center;
		gap: 2px;
		width: 100%;
		padding: 6px 4px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-secondary);
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		font-family: var(--font-primary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		transition: color var(--duration-channel);
	}

	.role-header:hover {
		color: var(--text-primary);
	}

	.chevron {
		flex-shrink: 0;
		transition: transform var(--duration-channel);
	}

	.chevron.collapsed {
		transform: rotate(-90deg);
	}

	.role-name {
		white-space: nowrap;
	}

	.role-count {
		white-space: nowrap;
		color: var(--text-muted);
	}

	.role-members {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	/* Member row */
	.member-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		transition:
			background var(--duration-channel);
	}

	.member-row:hover {
		background: var(--surface-high);
	}

	/* Member avatar with presence indicator */
	.member-avatar-wrapper {
		position: relative;
		flex-shrink: 0;
		width: 24px;
		height: 24px;
	}

	.member-presence-indicator {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 2px solid var(--surface-base);
	}

	.member-presence-indicator.presence-online {
		background: var(--status-online);
	}

	.member-presence-indicator.presence-idle {
		background: var(--status-idle);
	}

	.member-presence-indicator.presence-dnd {
		background: var(--status-dnd);
	}

	.member-presence-indicator.presence-offline {
		background: var(--status-offline);
	}

	/* Presence dots (used in hover card) */
	.presence-dot {
		flex-shrink: 0;
		font-size: var(--font-xs);
		line-height: 1;
		width: 12px;
		text-align: center;
	}

	.presence-online {
		color: var(--status-online);
	}

	.presence-idle {
		color: var(--status-idle);
	}

	.presence-dnd {
		color: var(--status-dnd);
	}

	.presence-offline {
		color: var(--status-offline);
	}

	/* Nick */
	.member-nick {
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex: 1;
	}

	/* Context menu */
	.context-menu {
		position: fixed;
		z-index: 1200;
		min-width: 160px;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		padding: 4px 0;
	}

	.context-item {
		display: block;
		width: 100%;
		padding: 8px 12px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-primary);
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		text-align: left;
		transition:
			background var(--duration-channel),
			color var(--duration-channel);
	}

	.context-item:hover {
		background: var(--accent-bg);
		color: var(--accent-primary);
	}

	.context-item--danger:hover {
		background: rgba(237, 66, 69, 0.1);
		color: var(--danger);
	}

	.context-separator {
		height: 1px;
		margin: 4px 8px;
		background: var(--surface-highest);
	}

	/* Hover card */
	.hover-card {
		position: fixed;
		z-index: 1100;
		width: 200px;
		padding: 10px 12px;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		pointer-events: none;
	}

	.hover-card-header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 6px;
	}

	.hover-card-nick {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
	}

	.hover-card-account {
		font-size: var(--font-xs);
		color: var(--text-secondary);
	}

	.hover-card-role {
		font-size: var(--font-xs);
		color: var(--text-secondary);
		margin-bottom: 4px;
	}

	.hover-card-status {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.hover-card-status-text {
		font-size: var(--font-xs);
		color: var(--text-secondary);
	}
</style>
