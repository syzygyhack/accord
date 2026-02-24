<script lang="ts">
	import {
		channelUIState,
		channelState,
		setActiveChannel,
		toggleCategory,
		reorderChannels,
		removeDMConversation,
		type ChannelCategory,
	} from '$lib/state/channels.svelte';
	import { getActiveServer } from '$lib/state/servers.svelte';
	import { getMember } from '$lib/state/members.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { voiceState, type VoiceParticipant } from '$lib/state/voice.svelte';
	import {
		getUnreadCount,
		getMentionCount,
		isMuted,
		getNotificationLevel,
		setNotificationLevel,
		type NotificationLevel,
	} from '$lib/state/notifications.svelte';
	import VoicePanel from './VoicePanel.svelte';
	import UserPanel from './UserPanel.svelte';
	import { handleMenuKeydown, focusFirst } from '$lib/utils/a11y';
	import type { Room } from 'livekit-client';

	interface Props {
		onvoicechannelclick?: (channel: string) => void;
		voiceRoom?: Room | null;
		onsettingsclick?: () => void;
		onserversettingsclick?: () => void;
		onadminpanelclick?: () => void;
		oncreatechannel?: (channel: string) => void;
		onvoiceexpand?: () => void;
		onvoicedisconnect?: () => void;
		isAdmin?: boolean;
	}

	let { onvoicechannelclick, voiceRoom = null, onsettingsclick, onserversettingsclick, onadminpanelclick, oncreatechannel, onvoiceexpand, onvoicedisconnect, isAdmin = false }: Props = $props();

	/** Dropdown state for server name header. */
	let serverDropdownOpen = $state(false);

	function toggleServerDropdown(): void {
		serverDropdownOpen = !serverDropdownOpen;
	}

	function closeServerDropdown(): void {
		serverDropdownOpen = false;
	}

	function handleServerSettings(): void {
		serverDropdownOpen = false;
		onserversettingsclick?.();
	}

	function handleAdminPanel(): void {
		serverDropdownOpen = false;
		onadminpanelclick?.();
	}

	/**
	 * Whether the current user has op (@) or higher in any visible channel.
	 * Checks all categorized channels (not just the active one) so ops
	 * retain create/reorder affordances even when viewing a DM.
	 */
	let isOp = $derived.by(() => {
		const nick = userState.nick;
		if (!nick) return false;
		for (const cat of channelUIState.categories) {
			for (const ch of cat.channels) {
				const member = getMember(ch, nick);
				if (member?.highestMode && ['~', '&', '@'].includes(member.highestMode)) {
					return true;
				}
			}
		}
		return false;
	});

	/** State for the create/join channel dialog. */
	let showCreateChannel = $state(false);
	let newChannelName = $state('');

	function handleCreateChannelClick(e: MouseEvent): void {
		e.stopPropagation();
		showCreateChannel = true;
		newChannelName = '#';
	}

	function closeCreateChannel(): void {
		showCreateChannel = false;
		newChannelName = '';
	}

	/** Validate an IRC channel name: starts with # or &, 2-50 chars, no spaces/commas/control chars. */
	function isValidChannelName(name: string): boolean {
		return /^[#&][^\s,\x00-\x1f]{1,49}$/.test(name);
	}

	function handleCreateChannelSubmit(): void {
		const name = newChannelName.trim();
		if (!name) return;
		// Ensure channel starts with #
		const channel = name.startsWith('#') || name.startsWith('&') ? name : `#${name}`;
		if (!isValidChannelName(channel)) return;
		oncreatechannel?.(channel);
		closeCreateChannel();
	}

	/** Collapsed state for the "Other" category. */
	let otherCollapsed = $state(false);

	/** Context menu state for notification level picker. */
	let contextMenu = $state<{ channel: string; x: number; y: number } | null>(null);

	const notificationOptions: { level: NotificationLevel; label: string }[] = [
		{ level: 'all', label: 'All messages' },
		{ level: 'mentions', label: 'Mentions only' },
		{ level: 'nothing', label: 'Nothing' },
		{ level: 'mute', label: 'Mute' },
	];

	function handleContextMenu(e: MouseEvent, channel: string): void {
		e.preventDefault();
		contextMenu = { channel, x: e.clientX, y: e.clientY };
	}

	function handleNotificationLevelSelect(level: NotificationLevel): void {
		if (contextMenu) {
			setNotificationLevel(contextMenu.channel, level);
			contextMenu = null;
		}
	}

	function closeContextMenu(): void {
		contextMenu = null;
	}

	/**
	 * Whether to show the unread badge for a channel.
	 * Muted channels suppress unread indicators unless there are @mentions.
	 */
	function shouldShowUnread(channel: string, unreadCount: number, mentionCount: number): boolean {
		if (unreadCount === 0) return false;
		if (isMuted(channel)) return mentionCount > 0;
		return true;
	}

	/**
	* Channels in channelState that don't appear in any accord.json category.
	* These are shown in the "Other" group at the bottom.
	*/
	let otherChannels = $derived.by((): string[] => {
		const categorized = new Set<string>();
		for (const cat of channelUIState.categories) {
			for (const ch of cat.channels) {
				categorized.add(ch.toLowerCase());
			}
		}
		const result: string[] = [];
		for (const name of channelState.channels.keys()) {
			if ((name.startsWith('#') || name.startsWith('&')) && !categorized.has(name)) {
				result.push(name);
			}
		}
		return result.sort();
	});

	function handleChannelClick(name: string, isVoice: boolean): void {
		if (isVoice) {
			onvoicechannelclick?.(name);
		} else {
			setActiveChannel(name);
		}
	}

	function handleCategoryClick(cat: ChannelCategory): void {
		toggleCategory(cat.name);
	}

	// --- Drag to reorder channels (ops only) ---

	let dragCategoryName: string | null = $state(null);
	let dragChannelIndex: number | null = $state(null);
	let dragOverChannelIndex: number | null = $state(null);

	function handleChannelDragStart(e: DragEvent, categoryName: string, index: number): void {
		if (!isOp) return;
		dragCategoryName = categoryName;
		dragChannelIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleChannelDragOver(e: DragEvent, categoryName: string, index: number): void {
		if (!isOp || dragCategoryName !== categoryName) return;
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		dragOverChannelIndex = index;
	}

	function handleChannelDragLeave(): void {
		dragOverChannelIndex = null;
	}

	function handleChannelDrop(e: DragEvent, categoryName: string, toIndex: number): void {
		e.preventDefault();
		if (dragCategoryName === categoryName && dragChannelIndex !== null && dragChannelIndex !== toIndex) {
			reorderChannels(categoryName, dragChannelIndex, toIndex);
		}
		dragCategoryName = null;
		dragChannelIndex = null;
		dragOverChannelIndex = null;
	}

	function handleChannelDragEnd(): void {
		dragCategoryName = null;
		dragChannelIndex = null;
		dragOverChannelIndex = null;
	}

	/** Keyboard alternative for channel reorder: Alt+Arrow moves channel within category. */
	function handleChannelKeydown(e: KeyboardEvent, categoryName: string, index: number, maxIndex: number): void {
		if (!isOp || !e.altKey) return;
		if (e.key === 'ArrowUp' && index > 0) {
			e.preventDefault();
			reorderChannels(categoryName, index, index - 1);
		} else if (e.key === 'ArrowDown' && index < maxIndex) {
			e.preventDefault();
			reorderChannels(categoryName, index, index + 1);
		}
	}

	/**
	 * Get voice participants for a channel as an array.
	 * Only returns LiveKit participants — users actively connected to the
	 * voice room. IRC channel membership is not used as a fallback because
	 * it would show every user who JOINed the IRC channel, not just those
	 * actually in a voice call.
	 */
	function getVoiceParticipants(channel: string): VoiceParticipant[] {
		if (voiceState.currentRoom === channel) {
			return Array.from(voiceState.participants.values());
		}
		return [];
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="channel-sidebar" aria-label="Channels" onclick={closeContextMenu}>
	<div class="server-header">
		<button class="server-header-btn" onclick={toggleServerDropdown} aria-expanded={serverDropdownOpen} aria-label="Server menu">
			<span class="server-name">{getActiveServer()?.name ?? 'accord'}</span>
			<svg class="server-chevron" class:open={serverDropdownOpen} width="12" height="12" viewBox="0 0 12 12">
				<path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
			</svg>
		</button>
		{#if serverDropdownOpen}
			<div class="server-dropdown" role="menu">
				<button class="server-dropdown-item" role="menuitem" onclick={handleServerSettings}>
					<svg width="14" height="14" viewBox="0 0 24 24">
						<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="2" fill="none" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="2" fill="none" />
					</svg>
					Server Settings
				</button>
				{#if isAdmin}
					<button class="server-dropdown-item" role="menuitem" onclick={handleAdminPanel}>
						<svg width="14" height="14" viewBox="0 0 24 24">
							<path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="2" fill="none" />
							<path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="2" fill="none" />
							<path d="M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" fill="none" />
						</svg>
						Admin Panel
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="channel-list">
		{#if channelUIState.dmConversations.length > 0}
			<div class="category">
				<button class="category-header" aria-label="Direct Messages">
					<svg class="chevron" width="10" height="10" viewBox="0 0 10 10">
						<path d="M2 3l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
					</svg>
					<span class="category-name">Direct Messages</span>
				</button>
				<div class="category-channels">
					{#each channelUIState.dmConversations as dm (dm.nick)}
						{@const dmUnread = getUnreadCount(dm.nick)}
						{@const dmMentions = getMentionCount(dm.nick)}
						<div class="dm-row">
							<button
								class="channel-item dm-item"
								class:active={channelUIState.activeChannel === dm.nick}
								class:has-unread={dmUnread > 0}
								class:has-mentions={dmMentions > 0}
								onclick={() => handleChannelClick(dm.nick, false)}
							>
								<span class="channel-icon dm-icon">@</span>
								<div class="dm-content">
									<span class="channel-name">{dm.nick}</span>
									{#if dm.lastMessage}
										<span class="dm-preview">{dm.lastMessage}</span>
									{/if}
								</div>
								{#if dmUnread > 0}
									<span class="unread-badge" class:mention-badge={dmMentions > 0}>
										{dmMentions > 0 ? dmMentions : dmUnread}
									</span>
								{/if}
							</button>
							<button
								class="dm-close-btn"
								onclick={(e) => { e.stopPropagation(); removeDMConversation(dm.nick); }}
								aria-label="Close conversation with {dm.nick}"
								title="Close DM"
							>
								<svg width="14" height="14" viewBox="0 0 16 16">
									<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#each channelUIState.categories as cat (cat.name)}
			<div class="category">
				<div class="category-header-row">
					<button
						class="category-header"
						onclick={() => handleCategoryClick(cat)}
						aria-expanded={!cat.collapsed}
						aria-label="{cat.name} category"
					>
						<svg
							class="chevron"
							class:collapsed={cat.collapsed}
							width="10"
							height="10"
							viewBox="0 0 10 10"
						>
							<path d="M2 3l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
						</svg>
						<span class="category-name">{cat.name}</span>
					</button>
					{#if isOp && !cat.voice}
						<button
							class="create-channel-btn"
							onclick={handleCreateChannelClick}
							aria-label="Create channel"
							title="Create channel"
						>
							<svg width="14" height="14" viewBox="0 0 16 16">
								<path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
							</svg>
						</button>
					{/if}
				</div>

				{#if !cat.collapsed}
					<div class="category-channels">
						{#each cat.channels as ch, chIdx (ch)}
							{@const chUnread = getUnreadCount(ch)}
							{@const chMentions = getMentionCount(ch)}
							{@const chMuted = isMuted(ch)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="channel-drag-wrapper"
								class:drag-over={dragCategoryName === cat.name && dragOverChannelIndex === chIdx && dragChannelIndex !== chIdx}
								draggable={isOp ? 'true' : 'false'}
								ondragstart={(e) => handleChannelDragStart(e, cat.name, chIdx)}
								ondragover={(e) => handleChannelDragOver(e, cat.name, chIdx)}
								ondragleave={handleChannelDragLeave}
								ondrop={(e) => handleChannelDrop(e, cat.name, chIdx)}
								ondragend={handleChannelDragEnd}
							>
							<button
								class="channel-item"
								class:active={!cat.voice && channelUIState.activeChannel === ch}
								class:voice-connected={cat.voice && voiceState.currentRoom === ch}
								class:has-unread={shouldShowUnread(ch, chUnread, chMentions)}
								class:has-mentions={chMentions > 0}
								class:is-muted={chMuted}
								onclick={() => handleChannelClick(ch, !!cat.voice)}
								oncontextmenu={(e) => handleContextMenu(e, ch)}
								onkeydown={(e) => handleChannelKeydown(e, cat.name, chIdx, cat.channels.length - 1)}
							>
								{#if cat.voice}
									<svg class="channel-icon voice-icon" width="14" height="14" viewBox="0 0 16 16">
										<path
											d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
											fill="currentColor"
										/>
									</svg>
								{:else if cat.isReadonly}
									<svg class="channel-icon pin-icon" width="14" height="14" viewBox="0 0 24 24" aria-label="Read-only channel">
										<path d="M19.5 10l-1.4-1.4L13 13.8V4h-2v9.8L5.9 8.6 4.5 10 12 17.5z" fill="currentColor" transform="rotate(45 12 12)" />
										<line x1="5" y1="19" x2="19" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
									</svg>
								{:else}
									<span class="channel-icon hash-icon">#</span>
								{/if}
								<span class="channel-name">{ch.replace(/^#/, '')}</span>
								{#if shouldShowUnread(ch, chUnread, chMentions)}
									<span class="unread-badge" class:mention-badge={chMentions > 0}>
										{chMentions > 0 ? chMentions : chUnread}
									</span>
								{/if}
							</button>

							{#if cat.voice}
								{@const participants = getVoiceParticipants(ch)}
								{#if participants.length > 0}
									<div class="voice-participants">
										{#each participants as p (p.nick)}
											<div class="voice-participant" class:speaking={p.isSpeaking}>
												<span class="participant-speaking-dot" class:active={p.isSpeaking}></span>
												<span class="participant-nick">{p.nick}</span>
												{#if p.isDeafened}
													<span class="participant-muted" aria-label="Deafened" title="Deafened">
														<svg width="12" height="12" viewBox="0 0 24 24">
															<path d="M3 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a9 9 0 0 0-18 0z" fill="currentColor" opacity="0.5" />
															<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
														</svg>
													</span>
												{:else if p.isMuted}
													<span class="participant-muted" aria-label="Muted" title="Muted">
														<svg width="12" height="12" viewBox="0 0 24 24">
															<path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" fill="currentColor" opacity="0.5" />
															<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
														</svg>
													</span>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}

		{#if otherChannels.length > 0}
			<div class="category">
				<button
					class="category-header"
					onclick={() => (otherCollapsed = !otherCollapsed)}
					aria-expanded={!otherCollapsed}
					aria-label="Other category"
				>
					<svg
						class="chevron"
						class:collapsed={otherCollapsed}
						width="10"
						height="10"
						viewBox="0 0 10 10"
					>
						<path d="M2 3l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
					</svg>
					<span class="category-name">Other</span>
				</button>

				{#if !otherCollapsed}
					<div class="category-channels">
						{#each otherChannels as ch (ch)}
							{@const chUnread = getUnreadCount(ch)}
							{@const chMentions = getMentionCount(ch)}
							{@const chMuted = isMuted(ch)}
							<button
								class="channel-item"
								class:active={channelUIState.activeChannel === ch}
								class:has-unread={shouldShowUnread(ch, chUnread, chMentions)}
								class:has-mentions={chMentions > 0}
								class:is-muted={chMuted}
								onclick={() => handleChannelClick(ch, false)}
								oncontextmenu={(e) => handleContextMenu(e, ch)}
							>
								<span class="channel-icon hash-icon">#</span>
								<span class="channel-name">{ch.replace(/^#/, '')}</span>
								{#if shouldShowUnread(ch, chUnread, chMentions)}
									<span class="unread-badge" class:mention-badge={chMentions > 0}>
										{chMentions > 0 ? chMentions : chUnread}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if voiceState.isConnected}
		<VoicePanel {voiceRoom} onexpand={onvoiceexpand} ondisconnect={onvoicedisconnect} />
	{/if}

	<UserPanel onsettingsclick={() => onsettingsclick?.()} />
</aside>

{#if contextMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="context-menu-overlay" onclick={closeContextMenu} oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="context-menu"
			style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => handleMenuKeydown(e, e.currentTarget as HTMLElement, closeContextMenu)}
			role="menu"
			tabindex="-1"
			use:focusFirst
		>
			<div class="context-menu-header" id="notif-menu-label">Notifications</div>
			{#each notificationOptions as opt (opt.level)}
				<button
					class="context-menu-item"
					class:active={getNotificationLevel(contextMenu.channel) === opt.level}
					onclick={() => handleNotificationLevelSelect(opt.level)}
					role="menuitem"
				>
					<span class="context-menu-check">
						{#if getNotificationLevel(contextMenu.channel) === opt.level}
							<svg width="12" height="12" viewBox="0 0 16 16">
								<path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{/if}
					</span>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if serverDropdownOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="server-dropdown-overlay" onclick={closeServerDropdown}></div>
{/if}

{#if showCreateChannel}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="create-channel-overlay" onclick={closeCreateChannel}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="create-channel-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Create or join channel" tabindex="-1">
			<div class="create-channel-title">Join / Create Channel</div>
			<form onsubmit={(e) => { e.preventDefault(); handleCreateChannelSubmit(); }}>
				<label for="create-channel-name" class="sr-only">Channel name</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="create-channel-name"
					class="create-channel-input"
					type="text"
					bind:value={newChannelName}
					placeholder="#channel-name"
					autofocus
				/>
				<div class="create-channel-actions">
					<button type="button" class="create-channel-cancel" onclick={closeCreateChannel}>Cancel</button>
					<button type="submit" class="create-channel-submit" disabled={!newChannelName.trim()}>Join</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.channel-sidebar {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
		height: 100%;
		background: var(--surface-low);
		overflow: hidden;
	}

	.server-header {
		position: relative;
		display: flex;
		align-items: center;
		height: 48px;
		border-bottom: 1px solid var(--surface-lowest);
		flex-shrink: 0;
	}

	.server-header-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		height: 100%;
		padding: 0 16px;
		background: none;
		border: none;
		cursor: pointer;
		font-family: var(--font-primary);
		transition: background var(--duration-channel);
	}

	.server-header-btn:hover {
		background: var(--surface-high);
	}

	.server-name {
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		text-align: left;
	}

	.server-chevron {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform var(--duration-channel);
	}

	.server-chevron.open {
		transform: rotate(180deg);
	}

	.server-dropdown {
		position: absolute;
		top: 100%;
		left: 8px;
		right: 8px;
		background: var(--surface-highest);
		border-radius: 6px;
		padding: 4px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		z-index: 100;
	}

	.server-dropdown-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
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

	.server-dropdown-item:hover {
		background: var(--accent-bg);
		color: var(--text-primary);
	}

	.server-dropdown-overlay {
		position: fixed;
		inset: 0;
		z-index: 99;
	}

	.channel-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
	}

	.category {
		margin-bottom: 2px;
	}

	.category-header-row {
		display: flex;
		align-items: center;
	}

	.create-channel-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		margin-right: 4px;
		padding: 0;
		background: none;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		color: var(--text-muted);
		opacity: 0;
		flex-shrink: 0;
		transition: opacity 80ms, color 80ms, background 80ms;
	}

	.category-header-row:hover .create-channel-btn {
		opacity: 1;
	}

	.create-channel-btn:hover {
		opacity: 1;
		color: var(--text-primary);
		background: var(--surface-high);
	}

	.category-header {
		display: flex;
		align-items: center;
		gap: 2px;
		width: 100%;
		padding: 6px 8px 6px 4px;
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

	.category-header:hover {
		color: var(--text-primary);
	}

	.chevron {
		flex-shrink: 0;
		transition: transform var(--duration-channel);
	}

	.chevron.collapsed {
		transform: rotate(-90deg);
	}

	.category-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.category-channels {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.channel-drag-wrapper {
		/* Transparent wrapper for drag events; no visual impact by default */
		position: relative;
	}

	.channel-drag-wrapper.drag-over {
		border-top: 2px solid var(--accent-primary);
	}

	.channel-drag-wrapper[draggable='true'] {
		cursor: grab;
	}

	.channel-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: calc(100% - 16px);
		margin: 0 8px;
		padding: 6px 8px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-secondary);
		font-size: var(--font-base);
		font-family: var(--font-primary);
		text-align: left;
		transition:
			background var(--duration-channel),
			color var(--duration-channel);
	}

	.channel-item:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	.channel-item.active {
		background: var(--accent-bg);
		color: var(--text-primary);
		font-weight: var(--weight-medium);
	}

	.channel-item.voice-connected {
		background: var(--success-bg);
		color: var(--success, #3ba55d);
		font-weight: var(--weight-medium);
	}

	/* Muted channels: italic, dimmed text */
	.channel-item.is-muted {
		color: var(--text-muted);
		font-style: italic;
	}

	.channel-item.is-muted:hover {
		color: var(--text-secondary);
	}

	.channel-icon {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: var(--font-md);
		font-weight: var(--weight-medium);
		line-height: 1;
	}

	.channel-icon.voice-icon {
		color: var(--text-muted);
	}

	.dm-icon {
		font-size: var(--font-sm);
		font-weight: var(--weight-bold);
	}

	.dm-row {
		display: flex;
		align-items: center;
		position: relative;
	}

	.dm-row .channel-item {
		flex: 1;
		min-width: 0;
	}

	.dm-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		margin-right: 8px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-muted);
		opacity: 0;
		flex-shrink: 0;
		transition: opacity 80ms, color 80ms, background 80ms;
	}

	.dm-row:hover .dm-close-btn {
		opacity: 1;
	}

	.dm-close-btn:hover {
		opacity: 1;
		color: var(--text-primary);
		background: var(--surface-highest);
	}

	.dm-item {
		align-items: flex-start;
	}

	.dm-content {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 1px;
	}

	.dm-preview {
		font-size: var(--font-xs);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: var(--weight-normal, 400);
		line-height: 1.3;
	}

	.channel-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
		flex: 1;
		min-width: 0;
	}

	.channel-item.has-unread {
		color: var(--text-primary);
		font-weight: var(--weight-semibold);
	}

	.channel-item.has-mentions {
		color: var(--accent-primary);
	}

	.unread-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		background: var(--text-muted);
		color: var(--surface-low);
		border-radius: 9px;
		font-size: var(--font-xs);
		font-weight: var(--weight-bold);
		line-height: 1;
		flex-shrink: 0;
	}

	.unread-badge.mention-badge {
		background: var(--accent-primary);
		color: var(--text-inverse);
	}

	/* Voice participant list */
	.voice-participants {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 0 4px 28px;
	}

	.voice-participant {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		border-radius: 3px;
		transition: background var(--duration-channel);
	}

	.voice-participant.speaking {
		background: rgba(35, 165, 89, 0.1);
	}

	.participant-speaking-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
		flex-shrink: 0;
		transition: background var(--duration-channel);
	}

	.participant-speaking-dot.active {
		background: var(--status-online);
		animation: speaking-pulse 1.2s ease-in-out infinite;
	}

	@keyframes speaking-pulse {
		0%, 100% {
			box-shadow: 0 0 0 0 rgba(35, 165, 89, 0.4);
		}
		50% {
			box-shadow: 0 0 0 4px rgba(35, 165, 89, 0);
		}
	}

	.participant-nick {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.voice-participant.speaking .participant-nick {
		color: var(--text-primary);
	}

	.participant-muted {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	/* Context menu for notification level */
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

	.context-menu-header {
		padding: 6px 8px;
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.context-menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
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

	.context-menu-item:hover {
		background: var(--accent-bg);
		color: var(--text-primary);
	}

	.context-menu-item.active {
		color: var(--accent-primary);
	}

	.context-menu-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		flex-shrink: 0;
		color: var(--accent-primary);
	}

	/* Create channel dialog */
	.create-channel-overlay {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
	}

	.create-channel-dialog {
		background: var(--surface-high);
		border-radius: 8px;
		padding: 20px;
		width: 320px;
		max-width: 90vw;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.create-channel-title {
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		margin-bottom: 12px;
	}

	.create-channel-input {
		width: 100%;
		padding: 8px 10px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		color: var(--text-primary);
		outline: none;
		box-sizing: border-box;
	}

	.create-channel-input:focus {
		border-color: var(--accent-primary);
	}

	.create-channel-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}

	.create-channel-cancel {
		padding: 6px 14px;
		border: none;
		border-radius: 4px;
		background: var(--surface-highest);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.create-channel-cancel:hover {
		background: var(--surface-low);
	}

	.create-channel-submit {
		padding: 6px 14px;
		border: none;
		border-radius: 4px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.create-channel-submit:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.create-channel-submit:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
