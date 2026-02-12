<script lang="ts">
	import { channelUIState, getChannel, isDMTarget } from '$lib/state/channels.svelte';
	import { getMember } from '$lib/state/members.svelte';
	import { userState } from '$lib/state/user.svelte';

	interface Props {
		onToggleMembers?: () => void;
		membersVisible?: boolean;
		onTopicEdit?: (channel: string, newTopic: string) => void;
		onToggleSidebar?: () => void;
		showSidebarToggle?: boolean;
	}

	let { onToggleMembers, membersVisible = false, onTopicEdit, onToggleSidebar, showSidebarToggle = false }: Props = $props();

	let channelInfo = $derived(
		channelUIState.activeChannel
			? getChannel(channelUIState.activeChannel)
			: null
	);

	let isDM = $derived(
		channelUIState.activeChannel
			? isDMTarget(channelUIState.activeChannel)
			: false
	);

	let isVoice = $derived(() => {
		if (!channelUIState.activeChannel) return false;
		return channelUIState.categories.some(
			(cat) => cat.voice && cat.channels.includes(channelUIState.activeChannel!)
		);
	});

	/** Whether the current user has op (@) or higher in the active channel. */
	let isOp = $derived(() => {
		if (!channelUIState.activeChannel || !userState.nick) return false;
		const member = getMember(channelUIState.activeChannel, userState.nick);
		if (!member || !member.highestMode) return false;
		// ~, &, @ are op-level or higher
		return ['~', '&', '@'].includes(member.highestMode);
	});

	let topicExpanded = $state(false);
	let topicEditing = $state(false);
	let editValue = $state('');

	function handleTopicClick(): void {
		if (isOp()) {
			// Enter edit mode
			topicEditing = true;
			editValue = channelInfo?.topic ?? '';
		} else {
			// Toggle expanded
			topicExpanded = !topicExpanded;
		}
	}

	function handleEditKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (onTopicEdit && channelUIState.activeChannel) {
				onTopicEdit(channelUIState.activeChannel, editValue);
			}
			topicEditing = false;
		} else if (e.key === 'Escape') {
			e.preventDefault();
			topicEditing = false;
		}
	}

	function handleEditBlur(): void {
		topicEditing = false;
	}
</script>

<header class="header-bar">
	{#if showSidebarToggle}
		<button
			class="action-button hamburger-button"
			title="Toggle Sidebar"
			aria-label="Toggle Sidebar"
			onclick={onToggleSidebar}
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</button>
	{/if}

	<div class="channel-info">
		{#if channelUIState.activeChannel}
			<span class="channel-label">
				{#if isDM}
					<span class="hash">@</span>
				{:else if isVoice()}
					<svg class="channel-type-icon" width="16" height="16" viewBox="0 0 16 16">
						<path
							d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
							fill="currentColor"
						/>
					</svg>
				{:else}
					<span class="hash">#</span>
				{/if}
				<span class="channel-name">{isDM ? channelUIState.activeChannel : channelUIState.activeChannel.replace(/^#/, '')}</span>
			</span>

			{#if !isDM}
				{#if topicEditing}
					<span class="divider"></span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="topic-edit"
						type="text"
						bind:value={editValue}
						onkeydown={handleEditKeydown}
						onblur={handleEditBlur}
						autofocus
					/>
				{:else if channelInfo?.topic}
					<span class="divider"></span>
					<span
						class="topic"
						class:topic-expanded={topicExpanded}
						class:topic-editable={isOp()}
						title={topicExpanded ? undefined : channelInfo.topic}
						role="button"
						tabindex="0"
						onclick={handleTopicClick}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTopicClick(); } }}
					>{channelInfo.topic}</span>
				{/if}
			{/if}
		{/if}
	</div>

	<div class="actions">
		<button
			class="action-button"
			title="Search"
			aria-label="Search"
			disabled
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5" />
				<path d="M12.5 12.5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</button>

		<button
			class="action-button"
			class:active={membersVisible}
			title="Toggle Member List"
			aria-label="Toggle Member List"
			onclick={onToggleMembers}
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path
					d="M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2.33 0-7 1.17-7 3.5V14h14v-1.5C13 10.17 8.33 9 6 9zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 1c-1.01 0-2.13.25-3 .68 1.1.73 1.88 1.75 1.88 2.82V14H18v-1.5c0-2.01-3.67-3.5-3-3.5z"
					fill="currentColor"
				/>
			</svg>
		</button>
	</div>
</header>

<style>
	.header-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		padding: 0 16px;
		background: var(--surface-base);
		border-bottom: 1px solid var(--surface-low);
		flex-shrink: 0;
	}

	.channel-info {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}

	.channel-label {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.hash {
		color: var(--text-muted);
		font-size: var(--font-lg);
		font-weight: var(--weight-medium);
		line-height: 1;
	}

	.channel-type-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.channel-name {
		font-size: var(--font-md);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
		white-space: nowrap;
	}

	.divider {
		width: 1px;
		height: 20px;
		background: var(--surface-highest);
		flex-shrink: 0;
	}

	.topic {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		cursor: pointer;
	}

	.topic.topic-expanded {
		white-space: normal;
		overflow: visible;
		text-overflow: unset;
	}

	.topic.topic-editable {
		cursor: text;
	}

	.topic-edit {
		font-size: var(--font-sm);
		color: var(--text-primary);
		background: var(--surface-high);
		border: 1px solid var(--accent-primary);
		border-radius: 4px;
		padding: 2px 6px;
		min-width: 0;
		flex: 1;
		font-family: inherit;
		outline: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		margin-left: 8px;
	}

	.action-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--interactive-normal);
		transition:
			color var(--duration-channel),
			background var(--duration-channel);
	}

	.action-button:hover:not(:disabled) {
		color: var(--interactive-hover);
		background: var(--surface-high);
	}

	.action-button.active {
		color: var(--interactive-active);
		background: var(--surface-high);
	}

	.action-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.hamburger-button {
		flex-shrink: 0;
		margin-right: 8px;
	}
</style>
