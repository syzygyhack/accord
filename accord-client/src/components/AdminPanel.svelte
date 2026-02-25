<script lang="ts">
	import { getActiveServer } from '$lib/state/servers.svelte';
	import { useTrapFocus, handleTablistKeydown } from '$lib/utils/a11y';
	import { getToken } from '$lib/api/auth';
	import {
		type AdminStats,
		type AdminUser,
		type AuditEntry,
		type AuditResponse,
		fetchStats,
		fetchUsers,
		kickUser,
		banUser,
		fetchAuditLog,
		filterUsers,
		formatUptime,
	} from '$lib/api/admin';

	type TabId = 'dashboard' | 'users' | 'moderation' | 'audit';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let activeTab: TabId = $state('dashboard');

	const TAB_TITLES: Record<TabId, string> = {
		dashboard: 'Dashboard',
		users: 'Users',
		moderation: 'Moderation',
		audit: 'Audit Log',
	};

	let tabTitle = $derived(TAB_TITLES[activeTab]);

	const server = $derived(getActiveServer());

	// ---------------------------------------------------------------------------
	// Dashboard tab
	// ---------------------------------------------------------------------------

	let stats: AdminStats | null = $state(null);
	let statsLoading = $state(false);
	let statsError: string | null = $state(null);

	async function loadStats(): Promise<void> {
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) { statsError = 'Not connected.'; return; }
		statsLoading = true;
		statsError = null;
		try {
			stats = await fetchStats(filesUrl, token);
			if (!stats) statsError = 'Failed to load stats.';
		} catch {
			statsError = 'Failed to load stats.';
		} finally {
			statsLoading = false;
		}
	}

	// ---------------------------------------------------------------------------
	// Users tab
	// ---------------------------------------------------------------------------

	let users: AdminUser[] = $state([]);
	let usersLoading = $state(false);
	let usersError: string | null = $state(null);
	let userSearch = $state('');
	let filteredUsers = $derived(filterUsers(users, userSearch));

	// Confirmation state for user actions
	let confirmAction: { type: 'kick' | 'ban'; user: AdminUser } | null = $state(null);
	let actionError: string | null = $state(null);

	async function loadUsers(): Promise<void> {
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) { usersError = 'Not connected.'; return; }
		usersLoading = true;
		usersError = null;
		try {
			users = await fetchUsers(filesUrl, token);
		} catch {
			usersError = 'Failed to load users.';
		} finally {
			usersLoading = false;
		}
	}

	function requestKickUser(user: AdminUser): void {
		confirmAction = { type: 'kick', user };
		actionError = null;
	}

	function requestBanUser(user: AdminUser): void {
		confirmAction = { type: 'ban', user };
		actionError = null;
	}

	async function executeUserAction(): Promise<void> {
		if (!confirmAction) return;
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) return;

		const { type, user } = confirmAction;
		try {
			if (type === 'kick') {
				await kickUser(filesUrl, token, '#general', user.account);
			} else {
				await banUser(filesUrl, token, '#general', user.account);
			}
			confirmAction = null;
			actionError = null;
		} catch (e) {
			actionError = e instanceof Error ? e.message : 'Action failed.';
		}
	}

	function cancelUserAction(): void {
		confirmAction = null;
		actionError = null;
	}

	// ---------------------------------------------------------------------------
	// Moderation tab
	// ---------------------------------------------------------------------------

	let kickChannel = $state('#general');
	let kickNick = $state('');
	let kickReason = $state('');
	let banChannel = $state('#general');
	let banNick = $state('');
	let banReason = $state('');
	let banDuration = $state('');
	let modLoading = $state(false);
	let modError: string | null = $state(null);
	let modSuccess: string | null = $state(null);
	let modConfirm: { type: 'kick' | 'ban' } | null = $state(null);

	function requestKick(): void {
		if (!kickNick.trim() || !kickChannel.trim()) return;
		modConfirm = { type: 'kick' };
		modError = null;
		modSuccess = null;
	}

	function requestBan(): void {
		if (!banNick.trim() || !banChannel.trim()) return;
		modConfirm = { type: 'ban' };
		modError = null;
		modSuccess = null;
	}

	async function executeModAction(): Promise<void> {
		if (!modConfirm) return;
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) return;

		modLoading = true;
		modError = null;
		modSuccess = null;
		try {
			if (modConfirm.type === 'kick') {
				await kickUser(filesUrl, token, kickChannel, kickNick, kickReason || undefined);
				modSuccess = `Kicked ${kickNick} from ${kickChannel}.`;
				kickNick = '';
				kickReason = '';
			} else {
				await banUser(filesUrl, token, banChannel, banNick, banReason || undefined, banDuration || undefined);
				modSuccess = `Banned ${banNick} from ${banChannel}.`;
				banNick = '';
				banReason = '';
				banDuration = '';
			}
		} catch (e) {
			modError = e instanceof Error ? e.message : 'Action failed.';
		} finally {
			modLoading = false;
			modConfirm = null;
		}
	}

	function cancelModAction(): void {
		modConfirm = null;
	}

	// ---------------------------------------------------------------------------
	// Audit Log tab
	// ---------------------------------------------------------------------------

	let auditEntries: AuditEntry[] = $state([]);
	let auditTotal = $state(0);
	let auditOffset = $state(0);
	let auditLoading = $state(false);
	let auditError: string | null = $state(null);
	let auditFilter = $state('');
	const AUDIT_PAGE_SIZE = 50;

	let filteredAudit = $derived(
		auditFilter.trim()
			? auditEntries.filter((e) => e.action.toLowerCase().includes(auditFilter.toLowerCase()))
			: auditEntries,
	);

	async function loadAudit(offset = 0): Promise<void> {
		const filesUrl = server?.filesUrl;
		const token = getToken();
		if (!filesUrl || !token) { auditError = 'Not connected.'; return; }
		auditLoading = true;
		auditError = null;
		try {
			const data: AuditResponse | null = await fetchAuditLog(filesUrl, token, offset, AUDIT_PAGE_SIZE);
			if (data) {
				auditEntries = data.entries;
				auditTotal = data.total;
				auditOffset = data.offset;
			} else {
				auditError = 'Failed to load audit log.';
			}
		} catch {
			auditError = 'Failed to load audit log.';
		} finally {
			auditLoading = false;
		}
	}

	function auditNextPage(): void {
		const nextOffset = auditOffset + AUDIT_PAGE_SIZE;
		if (nextOffset < auditTotal) loadAudit(nextOffset);
	}

	function auditPrevPage(): void {
		const prevOffset = Math.max(0, auditOffset - AUDIT_PAGE_SIZE);
		loadAudit(prevOffset);
	}

	/** Format a timestamp for display. */
	function formatTime(ts: number): string {
		return new Date(ts).toLocaleString();
	}

	// ---------------------------------------------------------------------------
	// Tab switching triggers data loading
	// ---------------------------------------------------------------------------

	$effect(() => {
		if (activeTab === 'dashboard') loadStats();
		if (activeTab === 'users') loadUsers();
		if (activeTab === 'audit') loadAudit(0);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="admin-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-title" tabindex="-1" onclick={onclose} onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} use:useTrapFocus>
	<div class="admin-container" role="presentation" onclick={(e) => e.stopPropagation()}>
		<!-- Left nav -->
		<nav class="admin-nav">
			<h2 id="admin-title" class="admin-heading">Admin Panel</h2>
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div class="admin-tabs" role="tablist" aria-orientation="vertical" onkeydown={(e) => handleTablistKeydown(e, e.currentTarget as HTMLElement)}>
				{#each Object.entries(TAB_TITLES) as [id, label]}
					<button
						role="tab"
						class="admin-tab"
						class:active={activeTab === id}
						aria-selected={activeTab === id}
						onclick={() => { activeTab = id as TabId; }}
					>
						{label}
					</button>
				{/each}
			</div>
			<button class="admin-close-btn" onclick={onclose} aria-label="Close admin panel">&times;</button>
		</nav>

		<!-- Right content -->
		<div class="admin-content">
			<h3 class="admin-content-title">{tabTitle}</h3>

			<!-- Dashboard -->
			{#if activeTab === 'dashboard'}
				<div class="tab-panel">
					{#if statsLoading}
						<p class="loading-text">Loading stats...</p>
					{:else if statsError}
						<p class="error-text">{statsError}</p>
					{:else if stats}
						<div class="stats-grid">
							<div class="stat-card">
								<span class="stat-value">{stats.registeredAccounts}</span>
								<span class="stat-label">Registered Users</span>
							</div>
							<div class="stat-card">
								<span class="stat-value">{stats.channels}</span>
								<span class="stat-label">Channels</span>
							</div>
							<div class="stat-card">
								<span class="stat-value">{formatUptime(stats.uptimeSeconds)}</span>
								<span class="stat-label">Uptime</span>
							</div>
							<div class="stat-card">
								<span class="stat-value">{stats.profileCount}</span>
								<span class="stat-label">Profiles</span>
							</div>
						</div>
					{/if}
				</div>

			<!-- Users -->
			{:else if activeTab === 'users'}
				<div class="tab-panel">
					<div class="search-bar">
						<input
							type="text"
							class="search-input"
							placeholder="Search users..."
							bind:value={userSearch}
						/>
					</div>
					{#if usersLoading}
						<p class="loading-text">Loading users...</p>
					{:else if usersError}
						<p class="error-text">{usersError}</p>
					{:else}
						<div class="table-container">
							<table class="admin-table">
								<thead>
									<tr>
										<th>Account</th>
										<th>Display Name</th>
										<th>Status</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									{#each filteredUsers as user}
										<tr>
											<td>{user.account}</td>
											<td>{user.displayName ?? '-'}</td>
											<td>{user.status ?? '-'}</td>
											<td class="action-cell">
												<button class="btn-kick" onclick={() => requestKickUser(user)}>Kick</button>
												<button class="btn-ban" onclick={() => requestBanUser(user)}>Ban</button>
											</td>
										</tr>
									{/each}
									{#if filteredUsers.length === 0}
										<tr>
											<td colspan="4" class="empty-row">No users found.</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>
					{/if}
				</div>

			<!-- Moderation -->
			{:else if activeTab === 'moderation'}
				<div class="tab-panel">
					{#if modSuccess}
						<div class="mod-success" role="status">{modSuccess}</div>
					{/if}
					{#if modError}
						<div class="mod-error" role="alert">{modError}</div>
					{/if}

					<div class="mod-forms">
						<fieldset class="mod-fieldset">
							<legend>Kick User</legend>
							<label class="mod-label">
								Channel
								<input type="text" class="mod-input" bind:value={kickChannel} placeholder="#channel" />
							</label>
							<label class="mod-label">
								Nick
								<input type="text" class="mod-input" bind:value={kickNick} placeholder="username" />
							</label>
							<label class="mod-label">
								Reason
								<input type="text" class="mod-input" bind:value={kickReason} placeholder="(optional)" />
							</label>
							<button class="btn-action btn-kick" onclick={requestKick} disabled={modLoading || !kickNick.trim()}>Kick</button>
						</fieldset>

						<fieldset class="mod-fieldset">
							<legend>Ban User</legend>
							<label class="mod-label">
								Channel
								<input type="text" class="mod-input" bind:value={banChannel} placeholder="#channel" />
							</label>
							<label class="mod-label">
								Nick
								<input type="text" class="mod-input" bind:value={banNick} placeholder="username" />
							</label>
							<label class="mod-label">
								Reason
								<input type="text" class="mod-input" bind:value={banReason} placeholder="(optional)" />
							</label>
							<label class="mod-label">
								Duration
								<input type="text" class="mod-input" bind:value={banDuration} placeholder="e.g. 1h, 7d (empty = permanent)" />
							</label>
							<button class="btn-action btn-ban" onclick={requestBan} disabled={modLoading || !banNick.trim()}>Ban</button>
						</fieldset>
					</div>
				</div>

			<!-- Audit Log -->
			{:else if activeTab === 'audit'}
				<div class="tab-panel">
					<div class="search-bar">
						<input
							type="text"
							class="search-input"
							placeholder="Filter by action type..."
							bind:value={auditFilter}
						/>
					</div>
					{#if auditLoading}
						<p class="loading-text">Loading audit log...</p>
					{:else if auditError}
						<p class="error-text">{auditError}</p>
					{:else}
						<div class="table-container">
							<table class="admin-table">
								<thead>
									<tr>
										<th>Time</th>
										<th>Actor</th>
										<th>Action</th>
										<th>Detail</th>
									</tr>
								</thead>
								<tbody>
									{#each filteredAudit as entry}
										<tr>
											<td class="nowrap">{formatTime(entry.timestamp)}</td>
											<td>{entry.account}</td>
											<td><span class="audit-action">{entry.action}</span></td>
											<td class="detail-cell">{entry.detail}</td>
										</tr>
									{/each}
									{#if filteredAudit.length === 0}
										<tr>
											<td colspan="4" class="empty-row">No entries found.</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>
						<div class="pagination">
							<button class="btn-page" onclick={auditPrevPage} disabled={auditOffset === 0}>Previous</button>
							<span class="page-info">{auditOffset + 1} - {Math.min(auditOffset + AUDIT_PAGE_SIZE, auditTotal)} of {auditTotal}</span>
							<button class="btn-page" onclick={auditNextPage} disabled={auditOffset + AUDIT_PAGE_SIZE >= auditTotal}>Next</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Confirmation dialog for user actions (Users tab) -->
	{#if confirmAction}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="confirm-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={cancelUserAction} onkeydown={(e) => { if (e.key === 'Escape') cancelUserAction(); }}>
			<div class="confirm-dialog" role="presentation" onclick={(e) => e.stopPropagation()}>
				<h3 class="confirm-title">{confirmAction.type === 'kick' ? 'Kick' : 'Ban'} User</h3>
				<p class="confirm-text">
					Are you sure you want to {confirmAction.type} <strong>{confirmAction.user.account}</strong>?
				</p>
				{#if actionError}
					<p class="error-text">{actionError}</p>
				{/if}
				<div class="confirm-actions">
					<button class="btn-cancel" onclick={cancelUserAction}>Cancel</button>
					<button class="btn-danger" onclick={executeUserAction}>
						{confirmAction.type === 'kick' ? 'Kick' : 'Ban'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Confirmation dialog for moderation actions -->
	{#if modConfirm}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="confirm-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={cancelModAction} onkeydown={(e) => { if (e.key === 'Escape') cancelModAction(); }}>
			<div class="confirm-dialog" role="presentation" onclick={(e) => e.stopPropagation()}>
				<h3 class="confirm-title">Confirm {modConfirm.type === 'kick' ? 'Kick' : 'Ban'}</h3>
				<p class="confirm-text">
					{#if modConfirm.type === 'kick'}
						Kick <strong>{kickNick}</strong> from <strong>{kickChannel}</strong>?
					{:else}
						Ban <strong>{banNick}</strong> from <strong>{banChannel}</strong>{banDuration ? ` for ${banDuration}` : ' permanently'}?
					{/if}
				</p>
				<div class="confirm-actions">
					<button class="btn-cancel" onclick={cancelModAction}>Cancel</button>
					<button class="btn-danger" onclick={executeModAction} disabled={modLoading}>
						{modLoading ? 'Processing...' : (modConfirm.type === 'kick' ? 'Kick' : 'Ban')}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Overlay — matches ServerSettings pattern */
	.admin-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: flex;
		align-items: stretch;
		justify-content: center;
		background: var(--surface-lowest);
	}

	.admin-container {
		display: flex;
		width: 100%;
		height: 100%;
		max-width: 1200px;
	}

	/* Left navigation */
	.admin-nav {
		width: 220px;
		min-width: 220px;
		background: var(--surface-low);
		display: flex;
		flex-direction: column;
		padding: 24px 12px;
		gap: 4px;
		border-right: 1px solid var(--surface-lowest);
	}

	.admin-heading {
		font-size: var(--font-md);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
		padding: 0 8px 16px;
		margin: 0;
	}

	.admin-tabs {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.admin-tab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: background 80ms, color 80ms;
	}

	.admin-tab:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	.admin-tab.active {
		background: var(--accent-bg);
		color: var(--text-primary);
	}

	.admin-close-btn {
		margin-top: auto;
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		background: var(--surface-high);
		color: var(--text-secondary);
		font-family: var(--font-primary);
		font-size: var(--font-lg);
		cursor: pointer;
	}

	.admin-close-btn:hover {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	/* Right content */
	.admin-content {
		flex: 1;
		max-width: 740px;
		overflow-y: auto;
		padding: 32px 40px;
	}

	.admin-content-title {
		font-size: var(--font-lg);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
		margin: 0 0 24px;
	}

	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* Shared states */
	.loading-text {
		color: var(--text-muted);
		font-size: var(--font-base);
		margin: 0;
	}

	.error-text {
		color: var(--danger);
		font-size: var(--font-sm);
		margin: 0;
	}

	/* Dashboard stats */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 16px;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 20px 16px;
		background: var(--surface-high);
		border-radius: 8px;
		gap: 4px;
	}

	.stat-value {
		font-size: var(--font-xl);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
	}

	.stat-label {
		font-size: var(--font-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Search bar */
	.search-bar {
		display: flex;
		gap: 8px;
	}

	.search-input {
		flex: 1;
		padding: 8px 12px;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		background: var(--surface-base);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	/* Table */
	.table-container {
		overflow-x: auto;
	}

	.admin-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-sm);
	}

	.admin-table th {
		text-align: left;
		padding: 8px 12px;
		color: var(--text-muted);
		font-weight: var(--weight-semibold);
		font-size: var(--font-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--surface-highest);
	}

	.admin-table td {
		padding: 8px 12px;
		color: var(--text-primary);
		border-bottom: 1px solid var(--surface-high);
	}

	.admin-table tbody tr:hover {
		background: var(--surface-high);
	}

	.action-cell {
		display: flex;
		gap: 4px;
	}

	.empty-row {
		text-align: center;
		color: var(--text-muted);
		padding: 24px 12px;
	}

	.nowrap {
		white-space: nowrap;
	}

	.detail-cell {
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.audit-action {
		display: inline-block;
		padding: 2px 6px;
		border-radius: 3px;
		background: var(--surface-highest);
		font-size: var(--font-xs);
		font-family: var(--font-mono, monospace);
	}

	/* Buttons */
	.btn-kick {
		padding: 4px 10px;
		border: none;
		border-radius: 3px;
		background: var(--warning, #f0ad4e);
		color: var(--text-inverse, #fff);
		font-family: var(--font-primary);
		font-size: var(--font-xs);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-kick:hover {
		filter: brightness(1.1);
	}

	.btn-ban {
		padding: 4px 10px;
		border: none;
		border-radius: 3px;
		background: var(--danger);
		color: var(--text-inverse, #fff);
		font-family: var(--font-primary);
		font-size: var(--font-xs);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-ban:hover {
		filter: brightness(1.1);
	}

	/* Moderation forms */
	.mod-forms {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.mod-fieldset {
		border: 1px solid var(--surface-highest);
		border-radius: 8px;
		padding: 16px;
		margin: 0;
	}

	.mod-fieldset legend {
		font-size: var(--font-base);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		padding: 0 8px;
	}

	.mod-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.mod-input {
		padding: 8px 12px;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		background: var(--surface-base);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
	}

	.mod-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.btn-action {
		padding: 8px 16px;
		font-size: var(--font-sm);
	}

	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.mod-success {
		padding: 8px 12px;
		border-radius: 4px;
		background: var(--success-bg, rgba(40, 167, 69, 0.15));
		color: var(--success, #28a745);
		font-size: var(--font-sm);
	}

	.mod-error {
		padding: 8px 12px;
		border-radius: 4px;
		background: var(--danger-bg, rgba(220, 53, 69, 0.15));
		color: var(--danger);
		font-size: var(--font-sm);
	}

	/* Pagination */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding-top: 12px;
	}

	.btn-page {
		padding: 6px 14px;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		background: var(--surface-high);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		cursor: pointer;
	}

	.btn-page:hover:not(:disabled) {
		background: var(--surface-highest);
	}

	.btn-page:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.page-info {
		font-size: var(--font-sm);
		color: var(--text-muted);
	}

	/* Confirmation dialog — reuses DeleteConfirmDialog pattern */
	.confirm-overlay {
		position: fixed;
		inset: 0;
		z-index: 1300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
	}

	.confirm-dialog {
		background: var(--surface-low);
		border-radius: 8px;
		padding: 24px;
		max-width: 400px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.confirm-title {
		margin: 0 0 8px;
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.confirm-text {
		margin: 0 0 20px;
		font-size: var(--font-base);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn-cancel {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--surface-high);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-cancel:hover {
		background: var(--surface-highest);
	}

	.btn-danger {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--danger);
		color: var(--text-inverse, #fff);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-danger:hover {
		filter: brightness(1.1);
	}

	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.admin-nav {
			width: 160px;
			min-width: 160px;
			padding: 16px 8px;
		}

		.admin-content {
			padding: 24px 20px;
		}
	}

	@media (max-width: 600px) {
		.admin-container {
			flex-direction: column;
		}

		.admin-nav {
			width: 100%;
			min-width: 100%;
			flex-direction: row;
			padding: 8px;
			border-right: none;
			border-bottom: 1px solid var(--surface-lowest);
		}

		.admin-heading {
			display: none;
		}

		.admin-tabs {
			flex-direction: row;
			flex: 1;
			overflow-x: auto;
		}

		.admin-close-btn {
			margin-top: 0;
		}
	}
</style>
