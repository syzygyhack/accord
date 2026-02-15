<script lang="ts">
	import {
		channelUIState,
		channelState,
		setActiveChannel,
		toggleCategory,
		type ChannelCategory,
	} from '$lib/state/channels.svelte';
	import { getActiveServer } from '$lib/state/servers.svelte';
	import { voiceState, type VoiceParticipant } from '$lib/state/voice.svelte';
	import { getUnreadCount, getMentionCount } from '$lib/state/notifications.svelte';
	import VoicePanel from './VoicePanel.svelte';
	import UserPanel from './UserPanel.svelte';
	import type { Room } from 'livekit-client';

	interface Props {
		onVoiceChannelClick?: (channel: string) => void;
		voiceRoom?: Room | null;
		onSettingsClick?: () => void;
		onVoiceExpand?: () => void;
	}

	let { onVoiceChannelClick, voiceRoom = null, onSettingsClick, onVoiceExpand }: Props = $props();

	/** Collapsed state for the "Other" category. */
	let otherCollapsed = $state(false);

	/**
	* Channels in channelState that don't appear in any virc.json category.
	* These are shown in the "Other" group at the bottom.
	*/
	let otherChannels = $derived.by((): string[] => {
		const categorized = new Set<string>();
		for (const cat of channelUIState.categories) {
			for (const ch of cat.channels) {
				categorized.add(ch);
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
			onVoiceChannelClick?.(name);
		} else {
			setActiveChannel(name);
		}
	}

	function handleCategoryClick(cat: ChannelCategory): void {
		toggleCategory(cat.name);
	}

	/**
	 * Get voice participants for a channel as an array.
	 * If we're in this room, use LiveKit data (has speaking/mute info).
	 * Otherwise, fall back to IRC channel membership so users can see
	 * who's in a voice channel without joining it.
	 */
	function getVoiceParticipants(channel: string): VoiceParticipant[] {
		if (voiceState.currentRoom === channel) {
			return Array.from(voiceState.participants.values());
		}
		// Fall back to IRC membership for voice channels we haven't joined
		const ch = channelState.channels.get(channel);
		if (!ch) return [];
		const members: VoiceParticipant[] = [];
		for (const [nick] of ch.members) {
			members.push({ nick, isSpeaking: false, isMuted: false, isDeafened: false, hasVideo: false, hasScreenShare: false });
		}
		return members;
	}
</script>

<aside class="channel-sidebar" aria-label="Channels">
	<div class="server-header">
		<span class="server-name">{getActiveServer()?.name ?? 'virc'}</span>
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
					{/each}
				</div>
			</div>
		{/if}

		{#each channelUIState.categories as cat (cat.name)}
			<div class="category">
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

				{#if !cat.collapsed}
					<div class="category-channels">
						{#each cat.channels as ch (ch)}
							{@const chUnread = getUnreadCount(ch)}
							{@const chMentions = getMentionCount(ch)}
							<button
								class="channel-item"
								class:active={!cat.voice && channelUIState.activeChannel === ch}
								class:voice-connected={cat.voice && voiceState.currentRoom === ch}
								class:has-unread={chUnread > 0}
								class:has-mentions={chMentions > 0}
								onclick={() => handleChannelClick(ch, !!cat.voice)}
							>
								{#if cat.voice}
									<svg class="channel-icon voice-icon" width="14" height="14" viewBox="0 0 16 16">
										<path
											d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
											fill="currentColor"
										/>
									</svg>
								{:else}
									<span class="channel-icon hash-icon">#</span>
								{/if}
								<span class="channel-name">{ch.replace(/^#/, '')}</span>
								{#if chUnread > 0}
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
							<button
								class="channel-item"
								class:active={channelUIState.activeChannel === ch}
								class:has-unread={chUnread > 0}
								class:has-mentions={chMentions > 0}
								onclick={() => handleChannelClick(ch, false)}
							>
								<span class="channel-icon hash-icon">#</span>
								<span class="channel-name">{ch.replace(/^#/, '')}</span>
								{#if chUnread > 0}
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
		<VoicePanel {voiceRoom} onexpand={onVoiceExpand} />
	{/if}

	<UserPanel onSettingsClick={() => onSettingsClick?.()} />
</aside>

<style>
	.channel-sidebar {
		display: flex;
		flex-direction: column;
		width: 240px;
		min-width: 240px;
		height: 100%;
		background: var(--surface-low);
		overflow: hidden;
	}

	.server-header {
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 16px;
		border-bottom: 1px solid var(--surface-lowest);
		flex-shrink: 0;
	}

	.server-name {
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.channel-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
	}

	.category {
		margin-bottom: 2px;
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
</style>
