<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { IRCConnection } from '$lib/irc/connection';
	import { join, chathistory, topic, escapeTagValue } from '$lib/irc/commands';
	import { updateMonitorForChannel, clearMonitoredNicks, addMonitoredNicks } from '$lib/channelMonitor';
	import { stopTokenRefresh, clearCredentials, clearToken, getToken } from '$lib/api/auth';
	import { disconnectVoice } from '$lib/voice/room';
	import {
		handleVoiceChannelClick as voiceChannelClick,
		handleDMVoiceCall as dmVoiceCall,
		handleDMVideoCall as dmVideoCall,
	} from '$lib/voice/manager';
	import { voiceState } from '$lib/state/voice.svelte';
	import { audioSettings } from '$lib/state/audioSettings.svelte';
	import type { Room } from 'livekit-client';
	import { connectionState, initOnlineTracking } from '$lib/state/connection.svelte';
	import { userState } from '$lib/state/user.svelte';
	import {
		channelUIState,
		setActiveChannel,
		isDMTarget,
		clearChannelMembers as clearSimpleMembers,
	} from '$lib/state/channels.svelte';
	import { getMember, clearChannel as clearRichMembers } from '$lib/state/members.svelte';
	import { getActiveServer } from '$lib/state/servers.svelte';
	import { initConnection } from '$lib/connection/lifecycle';
	import { setupShortcuts } from '$lib/shortcuts';
	import { setupChannelEffects } from '$lib/channelEffects.svelte';
	import {
		type ReplyContext,
		type MessageActionState,
		createBoundActions,
		handleScrollToMessage,
	} from '$lib/messageActions';
	import ChannelSidebar from '../../components/ChannelSidebar.svelte';
	import HeaderBar from '../../components/HeaderBar.svelte';
	import MessageList from '../../components/MessageList.svelte';
	import MessageInput from '../../components/MessageInput.svelte';
	import MemberList from '../../components/MemberList.svelte';
	import TypingIndicator from '../../components/TypingIndicator.svelte';
	import EmojiPicker from '../../components/EmojiPicker.svelte';
	import QuickSwitcher from '../../components/QuickSwitcher.svelte';
	import AuthExpiredModal from '../../components/AuthExpiredModal.svelte';
	import UserSettings from '../../components/UserSettings.svelte';
	import ServerSettings from '../../components/ServerSettings.svelte';
	import ErrorBoundary from '../../components/ErrorBoundary.svelte';
	import ConnectionBanner from '../../components/ConnectionBanner.svelte';
	import ConnectionStatus from '../../components/ConnectionStatus.svelte';
	import VoiceOverlay from '../../components/VoiceOverlay.svelte';
	import ServerList from '../../components/ServerList.svelte';
	import RawIrcPanel from '../../components/RawIrcPanel.svelte';
	import SearchPanel from '../../components/SearchPanel.svelte';
	import ThreadView from '../../components/ThreadView.svelte';
	import UserProfilePopout from '../../components/UserProfilePopout.svelte';
	import ResizeHandle from '../../components/ResizeHandle.svelte';
	import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.svelte';
	import AdminPanel from '../../components/AdminPanel.svelte';
	import WelcomeModal from '../../components/WelcomeModal.svelte';
	import { checkAdmin } from '$lib/api/admin';
	import { appSettings, SIDEBAR_MIN, SIDEBAR_MAX, MEMBER_MIN, MEMBER_MAX } from '$lib/state/appSettings.svelte';
	import { clearServerTheme } from '$lib/state/theme.svelte';
	import { resetServerConfig } from '$lib/state/serverConfig.svelte';
	import { clearCustomEmoji } from '$lib/emoji';
	import { hasLocalStorage } from '$lib/utils/storage';

	let conn: IRCConnection | null = $state(null);
	let voiceRoom: Room | null = $state(null);
	let showMembers = $state(true);
	let showSidebar = $state(false);
	let innerWidth = $state(0);
	let error: string | null = $state(null);
	let voiceError: string | null = $state(null);
	let initializing = $state(true);

	// Responsive breakpoints
	let isDesktop = $derived(innerWidth > 1200);
	let sidebarIsOverlay = $derived(innerWidth <= 900);

	// Reply state
	let replyContext: ReplyContext | null = $state(null);

	// Emoji picker state
	let emojiPickerTarget: string | null = $state(null);
	let emojiPickerPosition: { x: number; y: number } | null = $state(null);

	// Delete confirmation state
	let deleteTarget: { msgid: string; channel: string } | null = $state(null);

	// Quick switcher state
	let showQuickSwitcher = $state(false);

	// Search panel state
	let showSearch = $state(false);
	let searchPanelRef: SearchPanel | undefined = $state(undefined);

	// Thread panel state
	let activeThreadId: string | null = $state(null);

	// Settings modal state
	let showSettings = $state(false);
	let showServerSettings = $state(false);
	let serverSettingsInitialTab: 'overview' | 'channels' | 'roles' | 'members' | 'invites' | 'appearance' | 'moderation' = $state('overview');

	// Voice overlay state
	let showVoiceOverlay = $state(false);
	/** Track count when overlay last auto-opened — prevents re-opening after user closes. */
	let lastAutoOpenTrackCount = $state(0);

	// User profile popout state
	let profilePopout: { nick: string; account: string; x: number; y: number } | null = $state(null);

	// Auth expiry state
	let authExpired = $state(false);

	// Welcome modal state
	let welcomeConfig: { serverName: string; message: string; suggestedChannels: string[] } | null = $state(null);

	// Admin panel state
	let showAdminPanel = $state(false);
	let isAdmin = $state(false);

	// Rate limit state
	let rateLimitSeconds = $state(0);
	let rateLimitTimer: ReturnType<typeof setInterval> | null = null;

	// Voice error auto-dismiss timer ref
	let voiceErrorTimer: ReturnType<typeof setTimeout> | null = null;

	// Derived: is the active channel a DM?
	let isActiveDM = $derived(
		channelUIState.activeChannel ? isDMTarget(channelUIState.activeChannel) : false
	);

	/** Whether the current user has op (@) or higher in the active channel. */
	let isOp = $derived.by(() => {
		if (!channelUIState.activeChannel || !userState.nick) return false;
		const member = getMember(channelUIState.activeChannel, userState.nick);
		if (!member || !member.highestMode) return false;
		return ['~', '&', '@'].includes(member.highestMode);
	});

	// Derived disconnect state for MessageInput
	let isDisconnected = $derived(
		connectionState.status === 'disconnected' || connectionState.status === 'reconnecting'
	);

	// Derived filesUrl for file uploads
	let activeFilesUrl = $derived(getActiveServer()?.filesUrl ?? null);

	// Channel lifecycle effects (mark-read, MONITOR, ChanServ register)
	setupChannelEffects({
		getConn: () => conn,
		onChannelSwitch() {
			replyContext = null;
			editingMsgid = null;
			editingChannel = null;
			emojiPickerTarget = null;
			emojiPickerPosition = null;
			deleteTarget = null;
			profilePopout = null;
			activeThreadId = null;
		},
	});

	function toggleSearch(): void {
		showSearch = !showSearch;
	}

	function toggleMembers(): void {
		showMembers = !showMembers;
	}

	function toggleSidebar(): void {
		showSidebar = !showSidebar;
	}

	/** Close overlay panels when clicking outside them. */
	function handleOverlayClick(): void {
		if (showSidebar && sidebarIsOverlay) showSidebar = false;
		if (showMembers && !isDesktop) showMembers = false;
	}

	function handleLoadHistory(target: string, beforeMsgid: string): void {
		if (!conn) return;
		chathistory(conn, 'BEFORE', target, `msgid=${beforeMsgid}`, '50');
	}

	// ---------------------------------------------------------------------------
	// Message action state bridge — connects extracted handlers to local state
	// ---------------------------------------------------------------------------
	const actionState: MessageActionState = {
		getConn: () => conn,
		getReplyContext: () => replyContext,
		setReplyContext: (ctx) => { replyContext = ctx; },
		getEmojiPickerTarget: () => emojiPickerTarget,
		setEmojiPickerTarget: (t) => { emojiPickerTarget = t; },
		getEmojiPickerPosition: () => emojiPickerPosition,
		setEmojiPickerPosition: (p) => { emojiPickerPosition = p; },
		getDeleteTarget: () => deleteTarget,
		setDeleteTarget: (t) => { deleteTarget = t; },
		getEditingMsgid: () => editingMsgid,
		setEditingMsgid: (id) => { editingMsgid = id; },
		getEditingChannel: () => editingChannel,
		setEditingChannel: (ch) => { editingChannel = ch; },
	};

	// All message action handlers, pre-bound to component state
	const actions = createBoundActions(actionState);

	/** Clear both simple and rich member lists for a channel (for reconnect). */
	function clearChannelMembers(channel: string): void {
		clearSimpleMembers(channel);
		clearRichMembers(channel);
	}

	/** Start a rate limit countdown timer. */
	function startRateLimit(seconds: number): void {
		rateLimitSeconds = seconds;
		if (rateLimitTimer) clearInterval(rateLimitTimer);
		rateLimitTimer = setInterval(() => {
			rateLimitSeconds--;
			if (rateLimitSeconds <= 0) {
				rateLimitSeconds = 0;
				if (rateLimitTimer) {
					clearInterval(rateLimitTimer);
					rateLimitTimer = null;
				}
			}
		}, 1000);
	}

	/** Apply result from a voice manager call — update room or show error. */
	function applyVoiceResult(result: { ok: true; room: Room | null } | { ok: false; error: string }): void {
		if (result.ok) {
			voiceRoom = voiceState.isConnected ? result.room : null;
		} else {
			// Clear any pending dismiss timer so a new error gets the full 5s window
			if (voiceErrorTimer) clearTimeout(voiceErrorTimer);
			voiceError = result.error;
			voiceErrorTimer = setTimeout(() => {
				voiceError = null;
				voiceErrorTimer = null;
			}, 5_000);
		}
	}

	/** Called when LiveKit disconnects unexpectedly (network drop, token expiry). */
	function onVoiceDisconnected(prevChannel: string | null): void {
		voiceRoom = null;
		if (conn && prevChannel && (prevChannel.startsWith('#') || prevChannel.startsWith('&'))) {
			conn.send(`PART ${prevChannel}`);
		}
	}

	async function handleVoiceChannelClick(ch: string): Promise<void> { applyVoiceResult(await voiceChannelClick(ch, conn, voiceRoom, onVoiceDisconnected)); }
	async function handleDMVoiceCall(target: string): Promise<void> { applyVoiceResult(await dmVoiceCall(target, conn, voiceRoom, onVoiceDisconnected)); }
	async function handleDMVideoCall(target: string): Promise<void> { applyVoiceResult(await dmVideoCall(target, conn, voiceRoom, onVoiceDisconnected)); }

	/**
	* Start the connection lifecycle using the extracted module.
	* Wires up callbacks so the lifecycle module can communicate state
	* changes back to the component without touching reactive state directly.
	*/
	async function startConnection(): Promise<void> {
		await initConnection({
			onConnection(c) {
				conn = c;
			},
			onError(message) {
				error = message;
				// Clean up the partially-connected socket to prevent background reconnect attempts
				if (conn) {
					try { conn.disconnect(); } catch { /* ignore */ }
				}
			},
			onInitDone() {
				initializing = false;
				// Check if current user has admin privileges
				const filesUrl = getActiveServer()?.filesUrl;
				const token = getToken();
				if (filesUrl && token) {
					checkAdmin(filesUrl, token).then((result) => { isAdmin = result; }).catch(() => { isAdmin = false; });
				}
			},
			onAuthExpired() {
				authExpired = true;
			},
			onWelcome(config) {
				welcomeConfig = config;
			},
			clearChannelMembers,
			clearMonitoredNicks,
			addMonitoredNicks,
			async handleVoiceReconnect() {
				if (voiceState.currentRoom && voiceRoom) {
					const voiceChannel = voiceState.currentRoom;
					try {
						await disconnectVoice(voiceRoom);
						voiceRoom = null;
						await handleVoiceChannelClick(voiceChannel);
					} catch {
						voiceRoom = null;
					}
				}
			},
			updateMonitorForChannel: (channel) => updateMonitorForChannel(conn, channel),
		});
	}

	/** Scroll the message list by dispatching a custom event. */
	function scrollMessageList(action: 'pageup' | 'pagedown' | 'home' | 'end'): void {
		window.dispatchEvent(new CustomEvent('accord:scroll-messages', { detail: { action } }));
	}

	// Track the msgid and channel being edited — redaction deferred until user confirms send
	let editingMsgid: string | null = $state(null);
	let editingChannel: string | null = $state(null);

	/** Send a TOPIC command when the user edits the channel topic. */
	function handleTopicEdit(channel: string, newTopic: string): void {
		if (!conn) return;
		topic(conn, channel, newTopic);
	}

	/** Insert @nick mention into the message input via custom event. */
	function handleMemberMention(nick: string): void {
		window.dispatchEvent(
			new CustomEvent('accord:insert-mention', { detail: { nick } })
		);
	}

	/** Open user profile popout when clicking a nick in a message. */
	function handleNickClick(nick: string, account: string, event: MouseEvent): void {
		profilePopout = { nick, account, x: event.clientX, y: event.clientY };
	}

	/** Close user profile popout. */
	function closeProfilePopout(): void {
		profilePopout = null;
	}

	/** Open thread panel for a given root message id. */
	function handleViewThread(rootMsgId: string): void {
		activeThreadId = rootMsgId;
	}

	/** Send a reply within the thread panel (auto-targets the thread root). */
	function handleThreadReply(rootMsgId: string, text: string): void {
		if (!conn || !channelUIState.activeChannel) return;
		const tags = `@+draft/reply=${escapeTagValue(rootMsgId)}`;
		conn.send(`${tags} PRIVMSG ${channelUIState.activeChannel} :${text}`);
	}

	/** Dismiss the welcome modal and persist in localStorage. */
	function dismissWelcome(): void {
		if (hasLocalStorage()) {
			const serverUrl = localStorage.getItem('accord:serverUrl');
			if (serverUrl) {
				localStorage.setItem(`accord:welcome-dismissed:${serverUrl}`, '1');
			}
		}
		welcomeConfig = null;
	}

	/** Handle channel click from welcome modal: switch to the channel. */
	function handleWelcomeJoinChannel(channel: string): void {
		const normalized = channel.startsWith('#') ? channel : `#${channel}`;
		setActiveChannel(normalized);
	}

	// ---------------------------------------------------------------------------
	// Keyboard shortcuts & push-to-talk (extracted to $lib/shortcuts.ts)
	// ---------------------------------------------------------------------------

	let shortcutHandle: ReturnType<typeof setupShortcuts> | null = null;

	function initShortcuts(): void {
		shortcutHandle = setupShortcuts({
			toggleQuickSwitcher: () => { showQuickSwitcher = !showQuickSwitcher; },
			toggleSettings: () => { showSettings = !showSettings; },
			toggleSearch,
			openSearch: () => { showSearch = true; },
			focusSearchInput: () => { searchPanelRef?.focusInput(); },
			dismissWelcome: () => {
				if (!welcomeConfig) return false;
				dismissWelcome();
				return true;
			},
			closeProfilePopout: () => {
				if (!profilePopout) return false;
				profilePopout = null;
				return true;
			},
			closeVoiceOverlay: () => {
				if (!showVoiceOverlay) return false;
				showVoiceOverlay = false;
				return true;
			},
			closeSettings: () => {
				if (!showSettings) return false;
				showSettings = false;
				return true;
			},
			closeServerSettings: () => {
				if (!showServerSettings) return false;
				showServerSettings = false;
				return true;
			},
			closeAdminPanel: () => {
				if (!showAdminPanel) return false;
				showAdminPanel = false;
				return true;
			},
			closeQuickSwitcher: () => {
				if (!showQuickSwitcher) return false;
				showQuickSwitcher = false;
				return true;
			},
			closeSearch: () => {
				if (!showSearch) return false;
				showSearch = false;
				return true;
			},
			closeThread: () => {
				if (!activeThreadId) return false;
				activeThreadId = null;
				return true;
			},
			closeDeleteTarget: () => {
				if (!deleteTarget) return false;
				deleteTarget = null;
				return true;
			},
			closeEmojiPicker: () => {
				if (!emojiPickerTarget) return false;
				emojiPickerTarget = null;
				emojiPickerPosition = null;
				return true;
			},
			cancelReply: () => {
				if (!replyContext) return false;
				replyContext = null;
				return true;
			},
			closeSidebarOverlay: () => {
				if (!(showSidebar && sidebarIsOverlay)) return false;
				showSidebar = false;
				return true;
			},
			closeMembersOverlay: () => {
				if (!(showMembers && !isDesktop)) return false;
				showMembers = false;
				return true;
			},
			markActiveChannelRead: actions.markActiveChannelRead,
			scrollMessageList,
			openInputEmojiPicker: actions.handleInputEmojiPicker,
			getVoiceRoom: () => voiceRoom,
		});
	}

	// Sync output volume to all remote audio tracks when slider changes.
	$effect(() => {
		const vol = audioSettings.outputVolume / 100;
		if (!voiceRoom) return;
		for (const p of voiceRoom.remoteParticipants.values()) {
			for (const pub of p.trackPublications.values()) {
				if (pub.track && pub.track.kind === 'audio') (pub.track as any).setVolume?.(vol);
			}
		}
	});

	// Switch audio/video devices when the device ID *actually changes* in settings.
	// We track previous values to avoid spurious switchActiveDevice calls when
	// unrelated reactive state (like localVideoEnabled) changes — LiveKit's
	// switchActiveDevice stops the current track before reacquiring, which would
	// kill a camera that was just enabled.
	let prevInputDevice = audioSettings.inputDeviceId;
	let prevOutputDevice = audioSettings.outputDeviceId;
	let prevVideoDevice = audioSettings.videoDeviceId;
	$effect(() => {
		const d = audioSettings.inputDeviceId;
		if (d !== prevInputDevice) { prevInputDevice = d; if (voiceRoom) voiceRoom.switchActiveDevice('audioinput', d).catch(() => {}); }
	});
	$effect(() => {
		const d = audioSettings.outputDeviceId;
		if (d !== prevOutputDevice) { prevOutputDevice = d; if (voiceRoom) voiceRoom.switchActiveDevice('audiooutput', d).catch(() => {}); }
	});
	$effect(() => {
		const d = audioSettings.videoDeviceId;
		if (d !== prevVideoDevice) { prevVideoDevice = d; if (voiceRoom && voiceState.localVideoEnabled) voiceRoom.switchActiveDevice('videoinput', d).catch(() => {}); }
	});

	// Auto-open voice overlay when a new video track appears (e.g. user toggles
	// camera or someone starts sharing screen). Reset the track counter when all
	// tracks are removed so the overlay reopens on the next camera toggle.
	$effect(() => {
		const count = voiceState.videoTracks.length;
		if (count === 0) {
			lastAutoOpenTrackCount = 0;
		} else if (count > lastAutoOpenTrackCount && voiceState.isConnected) {
			showVoiceOverlay = true;
			lastAutoOpenTrackCount = count;
		}
	});
	$effect(() => { if (!voiceState.isConnected) { showVoiceOverlay = false; lastAutoOpenTrackCount = 0; } });

	/** Emergency logout — works even during connecting/error state. */
	function forceLogout(): void {
		try { if (conn) { conn.disconnect(); conn = null; } } catch { /* ignore */ }
		// Best-effort credential cleanup (async, but localStorage clears synchronously)
		void clearCredentials();
		clearToken();
		if (hasLocalStorage()) {
			localStorage.removeItem('accord:serverUrl');
			localStorage.removeItem('accord:filesUrl');
		}
		// Hard navigate — bypasses SvelteKit lifecycle that may be blocked
		window.location.href = '/login';
	}

	let cleanupOnlineTracking: (() => void) | null = null;

	onMount(() => {
		cleanupOnlineTracking = initOnlineTracking();
		initShortcuts();
		startConnection();
	});

	onDestroy(() => {
		cleanupOnlineTracking?.();
		shortcutHandle?.cleanup();
		stopTokenRefresh();

		if (rateLimitTimer) {
			clearInterval(rateLimitTimer);
			rateLimitTimer = null;
		}

		if (voiceErrorTimer) {
			clearTimeout(voiceErrorTimer);
			voiceErrorTimer = null;
		}

		// Clean up voice connection.
		if (voiceRoom) {
			disconnectVoice(voiceRoom).catch(() => {});
			voiceRoom = null;
		}

		if (conn) {
			try {
				conn.disconnect();
			} catch {
				// ignore cleanup errors
			}
			conn = null;
		}

		// Clear server theme overrides, custom emoji, and config on teardown
		clearServerTheme();
		clearCustomEmoji();
		resetServerConfig();
	});
</script>

<svelte:window bind:innerWidth={innerWidth} />

<div class="chat-layout">
	<!-- Far left: Server list strip (ServerList is already a <nav> landmark) -->
	<ServerList onserversettings={() => { serverSettingsInitialTab = 'overview'; showServerSettings = true; }} />

	<!-- Left column: Channel sidebar (ChannelSidebar is already an <aside> landmark) -->
	<div class="left-panel" class:overlay={sidebarIsOverlay} class:visible={sidebarIsOverlay && showSidebar} style="width: {appSettings.sidebarWidth}px;">
		<ChannelSidebar onvoicechannelclick={handleVoiceChannelClick} {voiceRoom} onsettingsclick={() => { showSettings = true; }} onserversettingsclick={() => { serverSettingsInitialTab = 'overview'; showServerSettings = true; }} onadminpanelclick={() => { showAdminPanel = true; }} {isAdmin} oncreatechannel={(ch) => { if (conn) { join(conn, [ch]); setActiveChannel(ch); chathistory(conn, 'LATEST', ch, '*', '50'); } }} onvoiceexpand={() => (showVoiceOverlay = true)} onvoicedisconnect={() => { onVoiceDisconnected(null); voiceRoom = null; }} />
		{#if !sidebarIsOverlay}
			<ResizeHandle side="left" min={SIDEBAR_MIN} max={SIDEBAR_MAX} width={appSettings.sidebarWidth} onresize={(w) => { appSettings.sidebarWidth = w; }} />
		{/if}
	</div>

	<!-- Sidebar overlay backdrop -->
	{#if sidebarIsOverlay && showSidebar}
		<div class="overlay-backdrop" role="presentation" onclick={handleOverlayClick}></div>
	{/if}

	<!-- Center column: Header + Messages + Input -->
	<main class="center-panel">
		<HeaderBar
			ontogglemembers={toggleMembers}
			membersVisible={showMembers}
			ontopicedit={handleTopicEdit}
			ontogglesidebar={toggleSidebar}
			showSidebarToggle={sidebarIsOverlay}
			onvoicecall={handleDMVoiceCall}
			onvideocall={handleDMVideoCall}
			onscrolltomessage={handleScrollToMessage}
			ontogglesearch={toggleSearch}
			searchVisible={showSearch}
		/>

		<div class="message-area">
			<ConnectionBanner />
			{#if voiceError}
				<div class="voice-error-banner" role="alert">
					<span>{voiceError}</span>
					<button class="voice-error-dismiss" onclick={() => (voiceError = null)} aria-label="Dismiss">&times;</button>
				</div>
			{/if}
			<ErrorBoundary>
				{#if error || connectionState.status === 'connecting' || initializing}
					<ConnectionStatus {error} connecting={connectionState.status === 'connecting' || initializing} onlogout={forceLogout} />
				{:else if !channelUIState.activeChannel}
					<div class="empty-state">
						<p>Select a channel to start chatting</p>
					</div>
				{:else}
					<MessageList
						onloadhistory={handleLoadHistory}
						onreply={actions.handleReply}
						onreact={actions.handleReact}
						onmore={actions.handleMore}
						onpin={actions.handlePin}
						onedit={actions.handleEditMessage}
						oncopytext={actions.handleCopyText}
						oncopylink={actions.handleCopyLink}
						onmarkunread={actions.handleMarkUnread}
						ontogglereaction={actions.handleToggleReaction}
						onretry={actions.handleRetry}
						onnickclick={handleNickClick}
						onviewthread={handleViewThread}
						{isOp}
						disconnected={isDisconnected}
					/>
				{/if}
			</ErrorBoundary>

			{#if appSettings.showRawIrc}
				<RawIrcPanel />
			{/if}

			{#if showSearch}
				<SearchPanel
					bind:this={searchPanelRef}
					onclose={() => (showSearch = false)}
					onscrolltomessage={handleScrollToMessage}
				/>
			{/if}

			{#if activeThreadId && channelUIState.activeChannel}
				<ThreadView
					rootMsgId={activeThreadId}
					target={channelUIState.activeChannel}
					onclose={() => (activeThreadId = null)}
					onreply={actions.handleReply}
					onreact={actions.handleReact}
					onmore={actions.handleMore}
					onpin={actions.handlePin}
					onedit={actions.handleEditMessage}
					oncopytext={actions.handleCopyText}
					oncopylink={actions.handleCopyLink}
					onmarkunread={actions.handleMarkUnread}
					ontogglereaction={actions.handleToggleReaction}
					onretry={actions.handleRetry}
					onnickclick={handleNickClick}
					onsendreply={handleThreadReply}
					{isOp}
				/>
			{/if}
		</div>

		{#if channelUIState.activeChannel}
			<TypingIndicator channel={channelUIState.activeChannel} />
			<MessageInput
				target={channelUIState.activeChannel}
				connection={conn}
				reply={replyContext}
				oncancelreply={actions.handleCancelReply}
				oneditlast={actions.editLastMessage}
				editing={editingMsgid !== null}
				editMsgid={editingMsgid}
				oneditcomplete={actions.handleEditComplete}
				oneditcancel={actions.handleEditCancel}
				disconnected={isDisconnected}
				{rateLimitSeconds}
				filesUrl={activeFilesUrl}
				onemojipicker={actions.handleInputEmojiPicker}
			/>
		{:else}
			<div class="message-input-area">
				<div class="input-placeholder">
					<span class="input-placeholder-text">Select a channel</span>
				</div>
			</div>
		{/if}
	</main>

	<!-- Right column: Member list (MemberList is already an <aside> landmark) -->
	{#if !isActiveDM && showMembers}
		<div class="right-panel" class:overlay={!isDesktop} class:visible={!isDesktop && showMembers} style="width: {appSettings.memberListWidth}px;">
			{#if isDesktop}
				<ResizeHandle side="right" min={MEMBER_MIN} max={MEMBER_MAX} width={appSettings.memberListWidth} onresize={(w) => { appSettings.memberListWidth = w; }} />
			{/if}
			<MemberList onmention={handleMemberMention} connection={conn} />
		</div>
	{/if}

	<!-- Member list overlay backdrop -->
	{#if !isDesktop && showMembers && !isActiveDM}
		<div class="overlay-backdrop member-overlay-backdrop" role="presentation" onclick={handleOverlayClick}></div>
	{/if}
</div>

<!-- Quick Switcher modal -->
{#if showQuickSwitcher}
	<QuickSwitcher onclose={() => (showQuickSwitcher = false)} />
{/if}

<!-- Emoji Picker overlay -->
{#if emojiPickerTarget && emojiPickerPosition}
	<div
		class="emoji-picker-overlay"
		style="left: {emojiPickerPosition.x}px; top: {emojiPickerPosition.y}px;"
	>
		<EmojiPicker
			onselect={actions.handleEmojiSelect}
			onclose={actions.handleEmojiPickerClose}
		/>
	</div>
{/if}

{#if deleteTarget}
	<DeleteConfirmDialog onconfirm={actions.handleConfirmDelete} oncancel={actions.handleCancelDelete} />
{/if}

<!-- Auth expiry modal -->
<AuthExpiredModal visible={authExpired} />

<!-- Welcome modal (first join) -->
{#if welcomeConfig}
	<WelcomeModal
		serverName={welcomeConfig.serverName}
		message={welcomeConfig.message}
		suggestedChannels={welcomeConfig.suggestedChannels}
		ondismiss={dismissWelcome}
		onjoin={handleWelcomeJoinChannel}
	/>
{/if}

<!-- User Settings modal -->
{#if showSettings}
	<UserSettings onclose={() => (showSettings = false)} />
{/if}

{#if showServerSettings}
	<ServerSettings onclose={() => (showServerSettings = false)} connection={conn} initialTab={serverSettingsInitialTab} />
{/if}

<!-- Admin Panel modal -->
{#if showAdminPanel}
	<AdminPanel onclose={() => (showAdminPanel = false)} />
{/if}

<!-- Voice overlay (expanded view with video grid + participants) -->
{#if showVoiceOverlay && voiceState.isConnected && voiceRoom}
	<VoiceOverlay {voiceRoom} onclose={() => { showVoiceOverlay = false; }} />
{/if}

<!-- User profile popout (from message nick clicks) -->
{#if profilePopout}
	<UserProfilePopout
		nick={profilePopout.nick}
		account={profilePopout.account}
		position={{ x: profilePopout.x, y: profilePopout.y }}
		onclose={closeProfilePopout}
	/>
{/if}

<style>
	.chat-layout {
		display: flex;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: var(--surface-base);
		position: relative;
	}

	.left-panel {
		display: flex;
		flex-shrink: 0;
		height: 100%;
		z-index: 1;
		position: relative;
	}

	/* Below 900px: sidebar becomes an overlay that slides in from left */
	.left-panel.overlay {
		position: fixed;
		top: 0;
		left: 56px;
		height: 100%;
		z-index: 200;
		transform: translateX(-100%);
		transition: transform 0.2s ease;
	}

	.left-panel.overlay.visible {
		transform: translateX(0);
	}

	.center-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100%;
	}

	.message-area {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.message-input-area {
		flex-shrink: 0;
		padding: 0 16px 16px;
	}

	.right-panel {
		flex-shrink: 0;
		height: 100%;
		background: var(--surface-low);
		border-left: 1px solid var(--surface-lowest);
		overflow-y: auto;
		position: relative;
	}

	/* Below 1200px: member list becomes an overlay from the right */
	.right-panel.overlay {
		position: fixed;
		top: 0;
		right: 0;
		height: 100%;
		z-index: 200;
		box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
	}

	/* Overlay backdrop for sidebar and member list */
	.overlay-backdrop {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: rgba(0, 0, 0, 0.5);
	}

	.voice-error-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 6px 16px;
		background: var(--danger-bg);
		color: var(--danger);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		flex-shrink: 0;
	}

	.voice-error-dismiss {
		background: none;
		border: none;
		color: var(--danger);
		font-size: var(--font-lg);
		cursor: pointer;
		padding: 0 4px;
		line-height: 1;
	}

	.empty-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-size: var(--font-md);
	}

	/* Input placeholder */
	.input-placeholder {
		display: flex;
		align-items: center;
		padding: 10px 16px;
		background: var(--surface-high);
		border-radius: 8px;
		min-height: 44px;
	}

	.input-placeholder-text {
		color: var(--text-muted);
		font-size: var(--font-base);
	}

	/* Emoji picker overlay */
	.emoji-picker-overlay {
		position: fixed;
		z-index: 1000;
	}

</style>
