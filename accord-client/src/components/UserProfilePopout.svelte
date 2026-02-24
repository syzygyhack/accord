<script lang="ts">
	import { getMember } from '$lib/state/members.svelte';
	import { channelUIState, openDM } from '$lib/state/channels.svelte';
	import { getActiveServer } from '$lib/state/servers.svelte';
	import { getToken } from '$lib/api/auth';
	import { fetchAccountInfo, formatRegisteredDate } from '$lib/api/accountInfo';
	import { nickColor } from '$lib/irc/format';
	import { themeState } from '$lib/state/theme.svelte';
	import { getRoleColor } from '$lib/state/serverConfig.svelte';
	import { DEFAULT_ROLES } from '$lib/constants';
	import { getProfile, fetchProfile, resolveAvatarUrl } from '$lib/state/profiles.svelte';
	import { userState } from '$lib/state/user.svelte';
	import Avatar from './Avatar.svelte';

	interface Props {
		nick: string;
		account: string;
		/** Channel to look up roles in. Defaults to active channel. */
		channel?: string;
		/** Anchor position (click point). */
		position: { x: number; y: number };
		/** Optional avatar URL override (from draft/metadata-2 if available). */
		avatarUrl?: string | null;
		/** Optional bio text override (from draft/metadata-2 if available). */
		bio?: string | null;
		/** Callback when the popout should close. */
		onclose: () => void;
		/** Callback to open profile editor (for own profile). */
		oneditprofile?: () => void;
	}

	let {
		nick,
		account,
		channel,
		position,
		avatarUrl = null,
		bio = null,
		onclose,
		oneditprofile,
	}: Props = $props();

	let popoutEl: HTMLDivElement | undefined = $state();

	/** Registered date string (e.g. "Jan 15, 2026"), fetched from Ergo API. */
	let registeredDate: string | null = $state(null);

	/** Resolve channel for role lookup. */
	let resolvedChannel = $derived(channel ?? channelUIState.activeChannel ?? '');

	/** Look up member data from state. */
	let member = $derived(getMember(resolvedChannel, nick));

	/** Profile from store. */
	let profile = $derived(getProfile(account));

	/** Resolved display name: profile displayName > nick. */
	let displayName = $derived(profile?.displayName || nick);

	/** Resolved bio: prop override > profile bio. */
	let resolvedBio = $derived(bio || profile?.bio || null);

	/** Resolved avatar URL: prop override > profile avatar. */
	let resolvedAvatarUrl = $derived(avatarUrl || resolveAvatarUrl(profile?.avatar) || null);

	/** Whether this is the current user's own profile. */
	let isOwnProfile = $derived(account === userState.account);

	/** Nick color based on account hash. */
	let color = $derived(nickColor(account, themeState.current));

	/** Presence info. */
	let presence = $derived.by((): { label: string; className: string } => {
		const p = member?.presence ?? 'offline';
		switch (p) {
			case 'online': return { label: 'Online', className: 'presence-online' };
			case 'idle': return { label: 'Idle', className: 'presence-idle' };
			case 'dnd': return { label: 'Do Not Disturb', className: 'presence-dnd' };
			case 'offline': return { label: 'Offline', className: 'presence-offline' };
		}
	});

	/** Build role badges from member modes. */
	let roles = $derived.by((): Array<{ name: string; color: string }> => {
		if (!member) return [];
		return member.modes
			.map((mode) => {
				const def = DEFAULT_ROLES[mode];
				if (!def) return null;
				const color = getRoleColor(mode) ?? def.color ?? '#a0a0a0';
				return { name: def.name, color };
			})
			.filter((r): r is { name: string; color: string } => r != null);
	});

	/** Compute popout position that stays within viewport. */
	let style = $derived.by(() => {
		const popoutWidth = 280;
		const popoutMaxHeight = 400;
		const margin = 8;

		let x = position.x;
		let y = position.y;

		// Adjust horizontal: keep within viewport
		if (x + popoutWidth + margin > window.innerWidth) {
			x = window.innerWidth - popoutWidth - margin;
		}
		if (x < margin) {
			x = margin;
		}

		// Adjust vertical: prefer below click, flip above if no room
		if (y + popoutMaxHeight + margin > window.innerHeight) {
			y = Math.max(margin, y - popoutMaxHeight);
		}

		return `left: ${x}px; top: ${y}px;`;
	});

	/** Close on click outside. */
	function handleMouseDown(event: MouseEvent) {
		if (popoutEl && !popoutEl.contains(event.target as Node)) {
			onclose();
		}
	}

	/** Close on Escape. */
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
	}

	/** "Send Message" button opens DM conversation. */
	function handleSendMessage() {
		openDM(nick, account);
		onclose();
	}

	$effect(() => {
		document.addEventListener('mousedown', handleMouseDown);
		return () => {
			document.removeEventListener('mousedown', handleMouseDown);
		};
	});

	/** Fetch registered date from Ergo via accord-files on mount. */
	$effect(() => {
		if (!account) return;
		const server = getActiveServer();
		const token = getToken();
		if (!server?.filesUrl || !token) return;

		fetchAccountInfo(account, token, server.filesUrl).then((info) => {
			if (info?.registeredAt) {
				registeredDate = formatRegisteredDate(info.registeredAt);
			}
		});
	});

	/** Fetch profile if not already cached. */
	$effect(() => {
		if (!account) return;
		if (!getProfile(account)) {
			fetchProfile(account);
		}
	});

	function handleEditProfile() {
		oneditprofile?.();
		onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="profile-popout"
	role="dialog"
	aria-label="User profile: {nick}"
	bind:this={popoutEl}
	{style}
>
	<!-- Avatar -->
	<div class="profile-avatar-section">
		{#if resolvedAvatarUrl}
			<img class="profile-avatar" src={resolvedAvatarUrl} alt="{nick}'s avatar" />
		{:else}
			<div class="profile-avatar-letter" style="background-color: {color}">
				{(nick).charAt(0).toUpperCase()}
			</div>
		{/if}
		<span class="presence-badge {presence.className}" title={presence.label}></span>
	</div>

	<!-- Name -->
	<div class="profile-name-section">
		<span class="profile-display-name" style="color: {color}">{displayName}</span>
		{#if account && displayName !== nick}
			<span class="profile-nick">{nick}</span>
		{/if}
		{#if account}
			<span class="profile-account">@{account}</span>
		{/if}
	</div>

	<div class="profile-divider"></div>

	<!-- Bio (when available) -->
	{#if resolvedBio}
		<div class="profile-section">
			<div class="profile-section-label">About</div>
			<div class="profile-bio">{resolvedBio}</div>
		</div>
		<div class="profile-divider"></div>
	{/if}

	<!-- Roles -->
	{#if roles.length > 0}
		<div class="profile-section">
			<div class="profile-section-label">Roles</div>
			<div class="profile-roles">
				{#each roles as role}
					<span class="role-badge" style="border-color: {role.color}; color: {role.color}">
						<span class="role-dot" style="background-color: {role.color}"></span>
						{role.name}
					</span>
				{/each}
			</div>
		</div>
		<div class="profile-divider"></div>
	{/if}

	<!-- Registered date -->
	{#if registeredDate}
		<div class="profile-section">
			<div class="profile-section-label">Registered</div>
			<div class="profile-registered">{registeredDate}</div>
		</div>
		<div class="profile-divider"></div>
	{/if}

	<!-- Actions -->
	<div class="profile-actions">
		{#if isOwnProfile && oneditprofile}
			<button class="profile-edit-btn" onclick={handleEditProfile}>
				Edit Profile
			</button>
		{:else}
			<button class="profile-send-message" onclick={handleSendMessage}>
				Send Message
			</button>
		{/if}
	</div>
</div>

<style>
	.profile-popout {
		position: fixed;
		z-index: 1200;
		width: 280px;
		background: var(--surface-high);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	/* Avatar section */
	.profile-avatar-section {
		position: relative;
		display: flex;
		justify-content: center;
		padding: 20px 20px 8px;
	}

	.profile-avatar {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		object-fit: cover;
	}

	.profile-avatar-letter {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 32px;
		font-weight: var(--weight-semibold);
		color: var(--text-inverse);
	}

	.presence-badge {
		position: absolute;
		bottom: 10px;
		right: calc(50% - 44px);
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 3px solid var(--surface-high);
	}

	.presence-badge.presence-online {
		background: var(--status-online);
	}

	.presence-badge.presence-idle {
		background: var(--status-idle);
	}

	.presence-badge.presence-dnd {
		background: var(--status-dnd);
	}

	.presence-badge.presence-offline {
		background: var(--status-offline);
	}

	/* Name section */
	.profile-name-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 4px 20px 12px;
	}

	.profile-display-name {
		font-size: var(--font-lg);
		font-weight: var(--weight-semibold);
	}

	.profile-nick {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		margin-top: 1px;
	}

	.profile-account {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		margin-top: 2px;
	}

	/* Divider */
	.profile-divider {
		height: 1px;
		background: var(--surface-highest);
		margin: 0 16px;
	}

	/* Sections */
	.profile-section {
		padding: 12px 16px;
	}

	.profile-section-label {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 8px;
	}

	.profile-bio {
		font-size: var(--font-sm);
		color: var(--text-primary);
		line-height: 1.4;
		word-wrap: break-word;
	}

	/* Registered date */
	.profile-registered {
		font-size: var(--font-sm);
		color: var(--text-primary);
	}

	/* Roles */
	.profile-roles {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.role-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border: 1px solid;
		border-radius: 12px;
		font-size: var(--font-xs);
		font-weight: var(--weight-medium);
	}

	.role-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	/* Actions */
	.profile-actions {
		padding: 12px 16px;
	}

	.profile-send-message {
		width: 100%;
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: filter var(--duration-channel);
	}

	.profile-send-message:hover {
		filter: brightness(1.1);
	}

	.profile-send-message:active {
		filter: brightness(0.95);
	}

	.profile-edit-btn {
		width: 100%;
		padding: 8px 16px;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		background: var(--surface-low);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background var(--duration-channel), border-color var(--duration-channel);
	}

	.profile-edit-btn:hover {
		background: var(--surface-high);
		border-color: var(--text-muted);
	}
</style>
