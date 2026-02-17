<script lang="ts">
	import { getActiveServer } from '$lib/state/servers.svelte';
	import { serverConfig } from '$lib/state/serverConfig.svelte';
	import { channelUIState } from '$lib/state/channels.svelte';
	import { getMembers } from '$lib/state/members.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { getToken } from '$lib/api/auth';
	import { listInvites, createInvite, deleteInvite, type InviteSummary } from '$lib/api/invites';
	import { formatMessage } from '$lib/irc/parser';
	import { themeState, parseServerTheme } from '$lib/state/theme.svelte';
	import { DEFAULT_ROLES, MODE_ORDER } from '$lib/constants';
	import type { IRCConnection } from '$lib/irc/connection';

	type TabId = 'overview' | 'channels' | 'roles' | 'members' | 'invites' | 'appearance' | 'moderation';

	interface Props {
		onclose: () => void;
		connection: IRCConnection | null;
		initialTab?: TabId;
	}

	let { onclose, connection, initialTab = 'overview' }: Props = $props();

	let activeTab: TabId = $state(initialTab);

	const TAB_TITLES: Record<TabId, string> = {
		overview: 'Overview',
		channels: 'Channels',
		roles: 'Roles',
		members: 'Members',
		invites: 'Invites',
		appearance: 'Appearance',
		moderation: 'Moderation',
	};

	let tabTitle = $derived(TAB_TITLES[activeTab]);

	const server = $derived(getActiveServer());
	const config = $derived(serverConfig.config);

	/** Merged role map: virc.json roles override defaults. */
	const roles = $derived.by(() => {
		const configRoles = config?.roles;
		if (configRoles && Object.keys(configRoles).length > 0) return configRoles;
		return DEFAULT_ROLES;
	});

	/** Categories from channelUIState (populated from virc.json on connect). */
	const categories = $derived(channelUIState.categories);

	/** Uncategorized channels. */
	const uncategorized = $derived.by((): string[] => {
		const categorized = new Set<string>();
		for (const cat of categories) {
			for (const ch of cat.channels) {
				categorized.add(ch);
			}
		}
		const all = new Set<string>();
		if (config?.channels?.categories) {
			for (const cat of config.channels.categories) {
				for (const ch of cat.channels) {
					all.add(ch);
				}
			}
		}
		const result: string[] = [];
		for (const ch of all) {
			if (!categorized.has(ch)) {
				result.push(ch);
			}
		}
		return result.sort();
	});

	// --- Appearance tab ---

	/** Theme overrides parsed from virc.json config. */
	const themeOverrides = $derived.by((): Record<string, string> => {
		const theme = config?.theme;
		if (!theme) return {};
		return parseServerTheme(theme);
	});

	/** Whether any server theme overrides are active. */
	const hasThemeOverrides = $derived(Object.keys(themeOverrides).length > 0);

	/** Currently applied server overrides (may differ from config if user disabled them). */
	const appliedOverrides = $derived(themeState.serverOverrides);

	// --- Moderation tab ---

	/** Slow mode state per channel (UI-only for now, maps to IRC MODE +d). */
	let slowModeEnabled: Record<string, boolean> = $state({});

	function toggleSlowMode(channel: string): void {
		if (!connection) return;
		const enabled = !slowModeEnabled[channel];
		slowModeEnabled[channel] = enabled;
		// Send IRC MODE for rate limiting: +d <seconds> enables, -d disables
		if (enabled) {
			connection.send(formatMessage('MODE', channel, '+d', '5'));
		} else {
			connection.send(formatMessage('MODE', channel, '-d'));
		}
	}

	/** Get all channels from config for moderation display. */
	const allChannels = $derived.by((): string[] => {
		const channels = new Set<string>();
		if (config?.channels?.categories) {
			for (const cat of config.channels.categories) {
				for (const ch of cat.channels) {
					channels.add(ch);
				}
			}
		}
		return [...channels].sort();
	});

	// --- Members tab ---

	/** Active channel for member lookup. */
	const activeChannel = $derived(channelUIState.activeChannel);

	/** Members in the current channel, sorted by role. */
	const members = $derived(activeChannel ? getMembers(activeChannel) : []);

	/** Whether the current user is an op (@) or higher in the active channel. */
	const isOp = $derived.by(() => {
		if (!activeChannel || !userState.nick) return false;
		const m = members.find((mem) => mem.nick === userState.nick);
		if (!m || !m.highestMode) return false;
		const opModes = ['~', '&', '@'];
		return opModes.includes(m.highestMode);
	});

	function getRoleName(mode: string | null): string {
		if (!mode) return 'No role';
		return roles[mode]?.name ?? mode;
	}

	function getRoleColor(mode: string | null): string | null {
		if (!mode) return null;
		return roles[mode]?.color ?? null;
	}

	function handleKick(nick: string): void {
		if (!connection || !activeChannel) return;
		connection.send(formatMessage('KICK', activeChannel, nick, 'Kicked by server admin'));
	}

	function handleBan(nick: string): void {
		if (!connection || !activeChannel) return;
		connection.send(formatMessage('MODE', activeChannel, '+b', `${nick}!*@*`));
	}

	// --- Invites tab ---

	let invites: InviteSummary[] = $state([]);
	let invitesLoading = $state(false);
	let invitesError: string | null = $state(null);
	let newInviteChannel = $state('#general');
	let creatingInvite = $state(false);

	async function loadInvites(): Promise<void> {
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) {
			invitesError = 'Not connected to virc-files.';
			return;
		}
		invitesLoading = true;
		invitesError = null;
		try {
			invites = await listInvites(filesUrl, token);
		} catch {
			invitesError = 'Failed to load invites.';
		} finally {
			invitesLoading = false;
		}
	}

	async function handleCreateInvite(): Promise<void> {
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token || !newInviteChannel) return;
		creatingInvite = true;
		try {
			await createInvite(filesUrl, token, newInviteChannel);
			await loadInvites();
		} catch {
			invitesError = 'Failed to create invite.';
		} finally {
			creatingInvite = false;
		}
	}

	async function handleDeleteInvite(inviteToken: string): Promise<void> {
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) return;
		try {
			await deleteInvite(filesUrl, token, inviteToken);
			invites = invites.filter((i) => i.token !== inviteToken);
		} catch {
			invitesError = 'Failed to delete invite.';
		}
	}

	/** Load invites when switching to invites tab. */
	$effect(() => {
		if (activeTab === 'invites') {
			loadInvites();
		}
	});

	function formatExpiry(expiresAt: number): string {
		if (expiresAt === 0) return 'Never';
		const d = new Date(expiresAt);
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="settings-overlay" role="dialog" aria-modal="true" aria-label="Server Settings" tabindex="-1" onkeydown={handleKeydown}>
	<div class="settings-container">
		<!-- Left: navigation -->
		<nav class="settings-nav">
			<div class="nav-section">
				<span class="nav-section-title">{server?.name ?? 'Server'}</span>
				<button class="nav-item" class:active={activeTab === 'overview'} onclick={() => activeTab = 'overview'}>
					Overview
				</button>
				<button class="nav-item" class:active={activeTab === 'channels'} onclick={() => activeTab = 'channels'}>
					Channels
				</button>
			</div>
			<div class="nav-divider"></div>
			<div class="nav-section">
				<button class="nav-item" class:active={activeTab === 'roles'} onclick={() => activeTab = 'roles'}>
					Roles
				</button>
				<button class="nav-item" class:active={activeTab === 'members'} onclick={() => activeTab = 'members'}>
					Members
				</button>
				<button class="nav-item" class:active={activeTab === 'invites'} onclick={() => activeTab = 'invites'}>
					Invites
				</button>
				<button class="nav-item" class:active={activeTab === 'appearance'} onclick={() => activeTab = 'appearance'}>
					Appearance
				</button>
				<button class="nav-item" class:active={activeTab === 'moderation'} onclick={() => activeTab = 'moderation'}>
					Moderation
				</button>
			</div>
		</nav>

		<!-- Right: content -->
		<div class="settings-content">
			<div class="content-header">
				<h2 class="content-title">{tabTitle}</h2>
				<button class="close-btn" onclick={onclose} aria-label="Close settings">
					<svg width="18" height="18" viewBox="0 0 24 24">
						<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					</svg>
					<span class="close-hint">ESC</span>
				</button>
			</div>

			<div class="content-body">
				{#if activeTab === 'overview'}
					<div class="overview-card">
						{#if server?.icon}
							<img class="server-icon-lg" src={server.icon} alt="{server.name} icon" />
						{:else}
							<div class="server-icon-lg placeholder">
								<span class="icon-letter">{(server?.name ?? 'S')[0].toUpperCase()}</span>
							</div>
						{/if}
						<div class="overview-details">
							<div class="overview-field">
								<span class="field-label">Server Name</span>
								<span class="field-value">{server?.name ?? 'Unknown'}</span>
							</div>
							{#if config?.description}
								<div class="overview-field">
									<span class="field-label">Description</span>
									<span class="field-value">{config.description}</span>
								</div>
							{/if}
							{#if config?.welcome?.message}
								<div class="overview-field">
									<span class="field-label">Welcome Message</span>
									<span class="field-value field-value-multiline">{config.welcome.message}</span>
								</div>
							{/if}
						</div>
					</div>

					{#if !config}
						<p class="hint-text">
							Server configuration not available. The server may not have a virc.json file.
						</p>
					{/if}

				{:else if activeTab === 'channels'}
					<div class="channels-section">
						{#each categories as cat (cat.name)}
							<div class="channel-category">
								<div class="category-header-row">
									<span class="category-label">{cat.name}</span>
									{#if cat.voice}
										<span class="category-badge">Voice</span>
									{/if}
									<span class="category-count">{cat.channels.length}</span>
								</div>
								<div class="category-channel-list">
									{#each cat.channels as ch (ch)}
										<div class="channel-row">
											{#if cat.voice}
												<svg class="channel-type-icon" width="14" height="14" viewBox="0 0 16 16">
													<path
														d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
														fill="currentColor"
													/>
												</svg>
											{:else}
												<span class="channel-type-icon hash">#</span>
											{/if}
											<span class="channel-row-name">{ch.replace(/^#/, '')}</span>
										</div>
									{/each}
								</div>
							</div>
						{/each}

						{#if uncategorized.length > 0}
							<div class="channel-category">
								<div class="category-header-row">
									<span class="category-label">Uncategorized</span>
									<span class="category-count">{uncategorized.length}</span>
								</div>
								<div class="category-channel-list">
									{#each uncategorized as ch (ch)}
										<div class="channel-row">
											<span class="channel-type-icon hash">#</span>
											<span class="channel-row-name">{ch.replace(/^#/, '')}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						{#if categories.length === 0 && uncategorized.length === 0}
							<p class="hint-text">No channels configured.</p>
						{/if}

						<p class="hint-text">
							Channel management (create, edit, delete, reorder) requires operator privileges and will be available in a future update.
						</p>
					</div>

				{:else if activeTab === 'roles'}
					<div class="roles-section">
						<p class="section-description">
							Role mappings from the server configuration. Each IRC mode prefix is mapped to a display name and color.
						</p>
						<div class="roles-list">
							{#each MODE_ORDER as mode (mode)}
								{@const role = roles[mode]}
								{#if role}
									<div class="role-row">
										<span class="role-prefix">{mode}</span>
										<span class="role-badge" style:--role-color={role.color ?? 'var(--text-muted)'}>
											{role.name}
										</span>
										{#if role.color}
											<span class="role-color-swatch" style:background={role.color}></span>
											<span class="role-color-value">{role.color}</span>
										{:else}
											<span class="role-color-value muted">No color</span>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
						<p class="hint-text">
							Role configuration is read from the server's virc.json. Editing requires server admin access.
						</p>
					</div>

				{:else if activeTab === 'members'}
					<div class="members-section">
						{#if !activeChannel}
							<p class="hint-text">Select a channel to view its members.</p>
						{:else}
							<p class="section-description">
								Members in <strong>{activeChannel}</strong> ({members.length})
							</p>
							<div class="members-list">
								{#each members as member (member.nick)}
									<div class="member-row">
										<div class="member-info">
											<span class="member-nick">{member.nick}</span>
											{#if member.highestMode}
												{@const color = getRoleColor(member.highestMode)}
												<span class="member-role-badge" style:--badge-color={color ?? 'var(--text-muted)'}>
													{getRoleName(member.highestMode)}
												</span>
											{/if}
										</div>
										{#if isOp && member.nick !== userState.nick}
											<div class="member-actions">
												<button class="action-btn kick-btn" onclick={() => handleKick(member.nick)} title="Kick {member.nick}">
													Kick
												</button>
												<button class="action-btn ban-btn" onclick={() => handleBan(member.nick)} title="Ban {member.nick}">
													Ban
												</button>
											</div>
										{/if}
									</div>
								{/each}
							</div>
							{#if members.length === 0}
								<p class="hint-text">No members found in this channel.</p>
							{/if}
						{/if}
					</div>

				{:else if activeTab === 'invites'}
					<div class="invites-section">
						{#if !server?.filesUrl}
							<p class="hint-text">Invite management requires virc-files. This server does not have a filesUrl configured.</p>
						{:else}
							<div class="invite-create-form">
								<label class="invite-label" for="invite-channel">Channel</label>
								<div class="invite-create-row">
									<input
										id="invite-channel"
										class="invite-input"
										type="text"
										bind:value={newInviteChannel}
										placeholder="#general"
									/>
									<button class="action-btn create-btn" onclick={handleCreateInvite} disabled={creatingInvite || !newInviteChannel}>
										{creatingInvite ? 'Creating...' : 'Create Invite'}
									</button>
								</div>
							</div>

							{#if invitesError}
								<p class="error-text">{invitesError}</p>
							{/if}

							{#if invitesLoading}
								<p class="hint-text">Loading invites...</p>
							{:else if invites.length === 0}
								<p class="hint-text">No active invites.</p>
							{:else}
								<div class="invites-list">
									{#each invites as invite (invite.token)}
										<div class="invite-row" class:expired={invite.expired || invite.maxUsesReached}>
											<div class="invite-info">
												<span class="invite-token">{invite.token}</span>
												<span class="invite-channel">{invite.channel}</span>
												<span class="invite-meta">
													by {invite.createdBy}
													&middot; {invite.useCount}{invite.maxUses > 0 ? `/${invite.maxUses}` : ''} uses
													&middot; Expires: {formatExpiry(invite.expiresAt)}
												</span>
											</div>
											<button class="action-btn delete-btn" onclick={() => handleDeleteInvite(invite.token)} title="Delete invite">
												Delete
											</button>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</div>

				{:else if activeTab === 'appearance'}
					<div class="appearance-section">
						<p class="section-description">
							Server theme overrides from the virc.json configuration. These are CSS variable values that layer on top of your current theme.
						</p>

						{#if hasThemeOverrides}
							<div class="theme-overrides-list">
								<div class="overrides-header">
									<span class="field-label">Configured Overrides</span>
								</div>
								{#each Object.entries(themeOverrides) as [variable, value] (variable)}
									<div class="theme-override-row">
										<span class="override-var">{variable}</span>
										<div class="override-value-group">
											<span class="override-swatch" style:background={value}></span>
											<span class="override-value">{value}</span>
										</div>
									</div>
								{/each}
							</div>

							<div class="theme-preview">
								<span class="field-label">Preview</span>
								<div class="preview-card" style:--preview-accent={themeOverrides['--accent-primary'] ?? 'var(--accent-primary)'} style:--preview-surface-lowest={themeOverrides['--surface-lowest'] ?? 'var(--surface-lowest)'} style:--preview-surface-low={themeOverrides['--surface-low'] ?? 'var(--surface-low)'} style:--preview-surface-base={themeOverrides['--surface-base'] ?? 'var(--surface-base)'} style:--preview-surface-high={themeOverrides['--surface-high'] ?? 'var(--surface-high)'} style:--preview-surface-highest={themeOverrides['--surface-highest'] ?? 'var(--surface-highest)'}>
									<div class="preview-sidebar" style:background="var(--preview-surface-low)">
										<div class="preview-channel" style:background="var(--preview-accent)"></div>
										<div class="preview-channel-muted"></div>
										<div class="preview-channel-muted"></div>
									</div>
									<div class="preview-main" style:background="var(--preview-surface-base)">
										<div class="preview-message"></div>
										<div class="preview-message short"></div>
										<div class="preview-message"></div>
										<div class="preview-input" style:background="var(--preview-surface-high)"></div>
									</div>
								</div>
							</div>

							{#if Object.keys(appliedOverrides).length > 0}
								<p class="hint-text">These overrides are currently applied to your theme.</p>
							{:else}
								<p class="hint-text">These overrides are configured but not currently applied.</p>
							{/if}
						{:else}
							<p class="hint-text">This server has no theme overrides configured in virc.json.</p>
						{/if}

						<p class="hint-text">
							Editing theme overrides requires access to the virc-files API and will be available in a future update.
						</p>
					</div>

				{:else if activeTab === 'moderation'}
					<div class="moderation-section">
						<p class="section-description">
							Channel moderation controls. Slow mode limits how often users can send messages.
						</p>

						<div class="mod-subsection">
							<span class="field-label">Slow Mode</span>
							{#if allChannels.length > 0}
								<div class="slow-mode-list">
									{#each allChannels as channel (channel)}
										<div class="slow-mode-row">
											<span class="slow-mode-channel">{channel}</span>
											<button
												class="slow-mode-toggle"
												class:enabled={slowModeEnabled[channel]}
												onclick={() => toggleSlowMode(channel)}
												disabled={!connection || !isOp}
												title={!isOp ? 'Requires operator privileges' : slowModeEnabled[channel] ? 'Disable slow mode' : 'Enable slow mode (5s cooldown)'}
											>
												{slowModeEnabled[channel] ? 'On' : 'Off'}
											</button>
										</div>
									{/each}
								</div>
							{:else}
								<p class="hint-text">No channels configured.</p>
							{/if}
							{#if !isOp}
								<p class="hint-text">Slow mode controls require operator (@) privileges or higher.</p>
							{/if}
						</div>

						<div class="mod-subsection">
							<span class="field-label">Auto-Mod Rules</span>
							<p class="hint-text">
								Auto-moderation rules (message filtering, spam detection) will be available in a future update.
							</p>
						</div>

						<div class="mod-subsection">
							<span class="field-label">Banned Words</span>
							<p class="hint-text">
								Banned word lists will be available in a future update.
							</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.settings-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		background: var(--surface-lowest);
		display: flex;
		align-items: stretch;
		justify-content: center;
	}

	.settings-container {
		display: flex;
		width: 100%;
		max-width: 1200px;
		height: 100%;
	}

	/* ---- Navigation ---- */

	.settings-nav {
		width: 220px;
		min-width: 220px;
		background: var(--surface-low);
		padding: 60px 8px 20px 20px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-section {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nav-section-title {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 8px 12px 4px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 12px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-secondary);
		font-size: var(--font-base);
		font-family: var(--font-primary);
		text-align: left;
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.nav-item:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	.nav-item.active {
		background: var(--accent-bg);
		color: var(--text-primary);
		font-weight: var(--weight-medium);
	}

	.nav-divider {
		height: 1px;
		background: var(--surface-highest);
		margin: 8px 12px;
	}

	/* ---- Content ---- */

	.settings-content {
		flex: 1;
		max-width: 740px;
		padding: 60px 40px 20px 40px;
		overflow-y: auto;
		position: relative;
	}

	.content-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.content-title {
		font-size: var(--font-lg);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 2px solid var(--surface-highest);
		border-radius: 50%;
		width: 36px;
		height: 36px;
		cursor: pointer;
		color: var(--text-muted);
		transition: color var(--duration-channel), border-color var(--duration-channel);
		position: relative;
	}

	.close-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	.close-hint {
		position: absolute;
		top: 40px;
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-weight: var(--weight-semibold);
		letter-spacing: 0.04em;
	}

	.content-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.section-description {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		margin: 0 0 8px;
	}

	/* ---- Overview Tab ---- */

	.overview-card {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 16px;
		background: var(--surface-low);
		border-radius: 8px;
	}

	.server-icon-lg {
		width: 72px;
		height: 72px;
		border-radius: 16px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.server-icon-lg.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-primary);
	}

	.icon-letter {
		color: var(--text-inverse, #fff);
		font-size: var(--font-xl);
		font-weight: var(--weight-bold);
		line-height: 1;
	}

	.overview-details {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
		flex: 1;
	}

	.overview-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.field-label {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.field-value {
		font-size: var(--font-base);
		color: var(--text-primary);
	}

	.field-value-multiline {
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.hint-text {
		font-size: var(--font-sm);
		color: var(--text-muted);
		font-style: italic;
		margin: 0;
	}

	.error-text {
		font-size: var(--font-sm);
		color: var(--status-error, #e05050);
		margin: 0;
	}

	/* ---- Channels Tab ---- */

	.channels-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.channel-category {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.category-header-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 0;
	}

	.category-label {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.category-badge {
		font-size: 10px;
		font-weight: var(--weight-semibold);
		color: var(--accent-primary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		background: var(--accent-bg);
		border-radius: 3px;
	}

	.category-count {
		font-size: var(--font-xs);
		color: var(--text-muted);
		margin-left: auto;
	}

	.category-channel-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.channel-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		background: var(--surface-low);
		border-radius: 4px;
	}

	.channel-type-icon {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: var(--font-md);
		font-weight: var(--weight-medium);
		line-height: 1;
	}

	.channel-type-icon.hash {
		font-size: var(--font-md);
	}

	.channel-row-name {
		font-size: var(--font-base);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ---- Roles Tab ---- */

	.roles-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.roles-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.role-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: var(--surface-low);
		border-radius: 4px;
	}

	.role-prefix {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-md);
		font-weight: var(--weight-bold);
		color: var(--text-muted);
		width: 24px;
		text-align: center;
		flex-shrink: 0;
	}

	.role-badge {
		font-size: var(--font-base);
		font-weight: var(--weight-semibold);
		color: var(--role-color);
	}

	.role-color-swatch {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		flex-shrink: 0;
		margin-left: auto;
	}

	.role-color-value {
		font-size: var(--font-xs);
		font-family: var(--font-mono, monospace);
		color: var(--text-secondary);
	}

	.role-color-value.muted {
		color: var(--text-muted);
		font-family: var(--font-primary);
	}

	/* ---- Members Tab ---- */

	.members-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.members-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.member-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 12px;
		background: var(--surface-low);
		border-radius: 4px;
	}

	.member-info {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.member-nick {
		font-size: var(--font-base);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-role-badge {
		font-size: 10px;
		font-weight: var(--weight-semibold);
		color: var(--badge-color);
		padding: 1px 6px;
		background: var(--surface-high);
		border-radius: 3px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.member-actions {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.action-btn {
		padding: 3px 10px;
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		border: none;
		border-radius: 3px;
		cursor: pointer;
		transition: background var(--duration-channel), opacity var(--duration-channel);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.kick-btn {
		background: var(--surface-high);
		color: var(--text-secondary);
	}

	.kick-btn:hover:not(:disabled) {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.ban-btn {
		background: var(--status-error, #e05050);
		color: #fff;
	}

	.ban-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	/* ---- Invites Tab ---- */

	.invites-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.invite-create-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.invite-label {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.invite-create-row {
		display: flex;
		gap: 8px;
	}

	.invite-input {
		flex: 1;
		padding: 6px 10px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		color: var(--text-primary);
		outline: none;
	}

	.invite-input:focus {
		border-color: var(--accent-primary);
	}

	.create-btn {
		background: var(--accent-primary);
		color: #fff;
		white-space: nowrap;
	}

	.create-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.invites-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.invite-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--surface-low);
		border-radius: 4px;
		gap: 12px;
	}

	.invite-row.expired {
		opacity: 0.5;
	}

	.invite-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.invite-token {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-base);
		color: var(--text-primary);
	}

	.invite-channel {
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.invite-meta {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

	.delete-btn {
		background: var(--surface-high);
		color: var(--status-error, #e05050);
		flex-shrink: 0;
	}

	.delete-btn:hover:not(:disabled) {
		background: var(--status-error, #e05050);
		color: #fff;
	}

	/* ---- Appearance Tab ---- */

	.appearance-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.theme-overrides-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.overrides-header {
		padding: 4px 0 8px;
	}

	.theme-override-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--surface-low);
		border-radius: 4px;
	}

	.override-var {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.override-value-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.override-swatch {
		width: 16px;
		height: 16px;
		border-radius: 3px;
		border: 1px solid var(--surface-highest);
		flex-shrink: 0;
	}

	.override-value {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-sm);
		color: var(--text-primary);
	}

	.theme-preview {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.preview-card {
		display: flex;
		border-radius: 8px;
		overflow: hidden;
		height: 120px;
		border: 1px solid var(--surface-highest);
	}

	.preview-sidebar {
		width: 60px;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.preview-channel {
		height: 8px;
		border-radius: 3px;
		opacity: 0.8;
	}

	.preview-channel-muted {
		height: 8px;
		border-radius: 3px;
		background: var(--text-muted);
		opacity: 0.2;
	}

	.preview-main {
		flex: 1;
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.preview-message {
		height: 8px;
		background: var(--text-muted);
		opacity: 0.15;
		border-radius: 3px;
		width: 80%;
	}

	.preview-message.short {
		width: 50%;
	}

	.preview-input {
		margin-top: auto;
		height: 24px;
		border-radius: 4px;
	}

	/* ---- Moderation Tab ---- */

	.moderation-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.mod-subsection {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.slow-mode-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.slow-mode-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 12px;
		background: var(--surface-low);
		border-radius: 4px;
	}

	.slow-mode-channel {
		font-size: var(--font-base);
		color: var(--text-primary);
	}

	.slow-mode-toggle {
		padding: 3px 12px;
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		border: none;
		border-radius: 3px;
		cursor: pointer;
		background: var(--surface-high);
		color: var(--text-secondary);
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.slow-mode-toggle:hover:not(:disabled) {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.slow-mode-toggle.enabled {
		background: var(--accent-primary);
		color: #fff;
	}

	.slow-mode-toggle.enabled:hover:not(:disabled) {
		opacity: 0.85;
	}

	.slow-mode-toggle:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* ---- Responsive ---- */

	@media (max-width: 768px) {
		.settings-nav {
			width: 180px;
			min-width: 180px;
			padding: 20px 8px 20px 12px;
		}

		.settings-content {
			padding: 20px 16px;
		}
	}

	@media (max-width: 600px) {
		.settings-container {
			flex-direction: column;
		}

		.settings-nav {
			width: 100%;
			min-width: unset;
			flex-direction: row;
			flex-wrap: wrap;
			padding: 12px;
			gap: 4px;
			overflow-y: visible;
			overflow-x: auto;
		}

		.nav-section {
			flex-direction: row;
			gap: 4px;
		}

		.nav-section-title {
			display: none;
		}

		.nav-divider {
			display: none;
		}

		.settings-content {
			flex: 1;
			overflow-y: auto;
		}
	}
</style>
