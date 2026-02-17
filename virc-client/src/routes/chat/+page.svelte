<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { IRCConnection } from '$lib/irc/connection';
	import { negotiateCaps } from '$lib/irc/cap';
	import { authenticateSASL } from '$lib/irc/sasl';
	import { registerHandler, resetHandlerState, setSuppressSelfJoins } from '$lib/irc/handler';
	import { join, chathistory, markread, tagmsg, redact, privmsg, topic, monitor, who, escapeTagValue } from '$lib/irc/commands';
	import { getCredentials, getToken, fetchToken, startTokenRefresh, stopTokenRefresh, clearCredentials, clearToken } from '$lib/api/auth';
	import { connectToVoice, disconnectVoice, toggleMute as toggleMuteRoom, toggleDeafen as toggleDeafenRoom, toggleVideo as toggleVideoRoom, toggleScreenShare as toggleScreenShareRoom } from '$lib/voice/room';
	import {
		handleVoiceChannelClick as voiceChannelClick,
		handleDMVoiceCall as dmVoiceCall,
		handleDMVideoCall as dmVideoCall,
	} from '$lib/voice/manager';
	import { navigateChannel, navigateUnreadChannel, navigateServer } from '$lib/navigation/channelNav';
	import { voiceState, updateParticipant } from '$lib/state/voice.svelte';
	import { audioSettings } from '$lib/state/audioSettings.svelte';
	import type { Room } from 'livekit-client';
	import {
		setConnecting,
		setConnected,
		setDisconnected,
		setReconnecting,
		connectionState,
	} from '$lib/state/connection.svelte';
	import { rehydrate, userState } from '$lib/state/user.svelte';
	import {
		channelUIState,
		channelState,
		getChannel,
		setActiveChannel,
		setCategories,
		isDMTarget,
		openDM,
		clearChannelMembers as clearSimpleMembers,
	} from '$lib/state/channels.svelte';
	import { markRead } from '$lib/state/notifications.svelte';
	import { getMember, clearChannel as clearRichMembers } from '$lib/state/members.svelte';
	import { getCursors, getMessage, getMessages, redactMessage, addReaction, removeReaction, updateSendState, addMessage, pinMessage, unpinMessage, isPinned } from '$lib/state/messages.svelte';
	import type { Message } from '$lib/state/messages.svelte';
	import { addServer, getActiveServer } from '$lib/state/servers.svelte';
	import { installGlobalHandler, registerKeybindings } from '$lib/keybindings';
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
	import VoiceOverlay from '../../components/VoiceOverlay.svelte';
	import ServerList from '../../components/ServerList.svelte';
	import RawIrcPanel from '../../components/RawIrcPanel.svelte';
	import SearchPanel from '../../components/SearchPanel.svelte';
	import UserProfilePopout from '../../components/UserProfilePopout.svelte';
	import ResizeHandle from '../../components/ResizeHandle.svelte';
	import WelcomeModal from '../../components/WelcomeModal.svelte';
	import { appSettings, SIDEBAR_MIN, SIDEBAR_MAX, MEMBER_MIN, MEMBER_MAX } from '$lib/state/appSettings.svelte';
	import { applyServerTheme, clearServerTheme, parseServerTheme } from '$lib/state/theme.svelte';
	import { setServerConfig, resetServerConfig } from '$lib/state/serverConfig.svelte';
	import { setCustomEmoji, clearCustomEmoji } from '$lib/emoji';

	/** virc.json config shape (subset we consume). */
	interface VircConfig {
		name?: string;
		icon?: string;
		filesUrl?: string;
		description?: string;
		welcome?: {
			message?: string;
			suggested_channels?: string[];
		};
		channels?: {
			categories?: Array<{
				name: string;
				channels: string[];
				voice?: boolean;
				readonly?: boolean;
			}>;
		};
		roles?: Record<string, { name: string; color: string | null }>;
		theme?: {
			accent?: string;
			surfaces?: Record<string, string>;
		};
		emoji?: Record<string, string>;
	}

	let conn: IRCConnection | null = $state(null);
	let voiceRoom: Room | null = $state(null);
	let showMembers = $state(false);
	let showSidebar = $state(false);
	let innerWidth = $state(0);
	let error: string | null = $state(null);
	let voiceError: string | null = $state(null);
	let initializing = $state(true);

	// Responsive breakpoints
	let isDesktop = $derived(innerWidth > 1200);
	let sidebarIsOverlay = $derived(innerWidth <= 900);

	// Reply state
	interface ReplyContext {
		msgid: string;
		nick: string;
		text: string;
	}
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

	// Settings modal state
	let showSettings = $state(false);
	let showServerSettings = $state(false);
	let serverSettingsInitialTab: 'overview' | 'channels' | 'roles' | 'members' | 'invites' | 'appearance' | 'moderation' = $state('overview');

	// Voice overlay state
	let showVoiceOverlay = $state(false);
	/** Set when user explicitly closes overlay — suppresses auto-open until next connect. */
	let overlayDismissed = $state(false);

	// User profile popout state
	let profilePopout: { nick: string; account: string; x: number; y: number } | null = $state(null);

	// Auth expiry state
	let authExpired = $state(false);

	// Welcome modal state
	let welcomeConfig: { serverName: string; message: string; suggestedChannels: string[] } | null = $state(null);

	// Rate limit state
	let rateLimitSeconds = $state(0);
	let rateLimitTimer: ReturnType<typeof setInterval> | null = null;

	// MONITOR tracking: nicks currently being monitored for presence
	let monitoredNicks = new Set<string>();

	// Guard against overlapping reconnect attempts
	let _reconnecting = false;

	/**
	* Update MONITOR list for the given channel.
	* Adds nicks in the active channel, prunes nicks not in any joined channel
	* or DM list. Also sends WHO to get initial away status.
	*/
	function updateMonitorForChannel(channel: string): void {
		if (!conn) return;
		// DM targets are monitored individually, not via channel membership
		if (isDMTarget(channel)) return;

		const chInfo = getChannel(channel);
		if (!chInfo) return;

		const currentNicks = new Set(chInfo.members.keys());
		// Remove own nick from monitoring
		const ownNick = userState.nick;
		if (ownNick) currentNicks.delete(ownNick);

		// Build the full set of nicks that should be monitored:
		// all nicks in any joined channel + DM partners
		const allNeeded = new Set<string>();
		for (const [chName, chData] of channelState.channels) {
			if (chName.startsWith('#') || chName.startsWith('&')) {
				for (const nick of chData.members.keys()) {
					if (nick !== ownNick) allNeeded.add(nick);
				}
			}
		}
		for (const dm of channelUIState.dmConversations) {
			allNeeded.add(dm.nick);
		}

		// Add nicks from active channel not yet monitored
		const toAdd = [...currentNicks].filter((n) => !monitoredNicks.has(n));
		// Remove monitored nicks not needed by any channel or DM
		const toRemove = [...monitoredNicks].filter((n) => !allNeeded.has(n));

		if (toRemove.length > 0) {
			monitor(conn, '-', toRemove);
			for (const n of toRemove) monitoredNicks.delete(n);
		}
		if (toAdd.length > 0) {
			monitor(conn, '+', toAdd);
			for (const n of toAdd) monitoredNicks.add(n);
		}

		// Send WHO to get initial away status for the channel
		who(conn, channel);
	}

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

	/**
	* Effect: when active channel changes, mark it read and sync via MARKREAD.
	* - Resets local unread/mention counts.
	* - Sends MARKREAD to the server with the newest message timestamp (or queries if none).
	*/
	let prevActiveChannel: string | null = null;
	$effect(() => {
		const channel = channelUIState.activeChannel;
		if (!channel || channel === prevActiveChannel) return;
		prevActiveChannel = channel;

		// Mark channel as read locally
		const cursors = getCursors(channel);
		if (cursors.newestMsgid) {
			markRead(channel, cursors.newestMsgid);
		}

		// Sync read position via IRC MARKREAD
		if (conn) {
			if (cursors.newestMsgid) {
				// We have messages — set read marker to newest
				markread(conn, channel, new Date().toISOString());
			} else {
				// No messages yet — query current read position from server
				markread(conn, channel);
				// Request initial history for channels with no buffered messages
				chathistory(conn, 'LATEST', channel, '*', '50');
			}
		}

		// Update MONITOR list for presence tracking in the new channel
		updateMonitorForChannel(channel);

		// Clear reply/emoji/edit/popout state on channel switch
		replyContext = null;
		editingMsgid = null;
		editingChannel = null;
		emojiPickerTarget = null;
		emojiPickerPosition = null;
		deleteTarget = null;
		profilePopout = null;
	});

	/**
	 * Effect: re-run MONITOR when NAMES completes for the active channel.
	 * If the user switches to a channel before NAMES finishes, the member list
	 * is empty and no nicks get monitored. This catches that case.
	 *
	 * Tracks which channel we last ran MONITOR for after NAMES, so we only
	 * fire once per channel (not on every unrelated channel state change).
	 */
	let monitoredAfterNames: string | null = null;
	$effect(() => {
		const channel = channelUIState.activeChannel;
		if (!channel || isDMTarget(channel)) return;
		const ch = getChannel(channel);
		if (!ch?.namesLoaded) {
			// Reset tracker when switching to a channel whose names haven't loaded
			if (monitoredAfterNames !== channel) monitoredAfterNames = null;
			return;
		}
		if (monitoredAfterNames === channel) return; // Already ran for this channel
		monitoredAfterNames = channel;
		updateMonitorForChannel(channel);
	});

	/**
	 * Effect: auto-register #general with ChanServ when joining a fresh server.
	 * If no member has founder (~) mode after NAMES completes, the channel is
	 * unregistered — register it so the first user becomes channel owner.
	 */
	let hasAttemptedRegister = false;
	$effect(() => {
		if (hasAttemptedRegister || !conn) return;
		const ch = getChannel('#general');
		if (!ch || !ch.namesLoaded) return;

		let hasFounder = false;
		for (const member of ch.members.values()) {
			if (member.prefix.includes('~')) {
				hasFounder = true;
				break;
			}
		}
		if (hasFounder) return;

		hasAttemptedRegister = true;
		conn.send('CS REGISTER #general');
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

	/** Reply button clicked on a message. */
	function handleReply(msgid: string): void {
		const channel = channelUIState.activeChannel;
		if (!channel) return;
		const msg = getMessage(channel, msgid);
		if (!msg) return;
		replyContext = {
			msgid: msg.msgid,
			nick: msg.nick,
			text: msg.text,
		};
	}

	function handleCancelReply(): void {
		replyContext = null;
	}

	/** React button clicked on a message — open emoji picker.
	 *  If anchor coordinates are provided (from the reaction bar '+' button),
	 *  position the picker near the anchor. Otherwise center it on screen.
	 */
	function handleReact(msgid: string, anchor?: { x: number; y: number }): void {
		emojiPickerTarget = msgid;
		if (anchor) {
			// Position picker above the anchor point, clamped to viewport
			const pickerWidth = 352;
			const pickerHeight = 400;
			emojiPickerPosition = {
				x: Math.max(16, Math.min(anchor.x, window.innerWidth - pickerWidth - 16)),
				y: Math.max(16, anchor.y - pickerHeight - 8),
			};
		} else {
			emojiPickerPosition = {
				x: Math.max(16, window.innerWidth / 2 - 176),
				y: Math.max(16, window.innerHeight / 2 - 200),
			};
		}
	}

	/** Open emoji picker for inserting into the message input. */
	function handleInputEmojiPicker(): void {
		emojiPickerTarget = '_input_';
		emojiPickerPosition = {
			x: Math.max(16, window.innerWidth / 2 - 176),
			y: Math.max(16, window.innerHeight / 2 - 200),
		};
	}

	/** Emoji selected from picker — either insert into input or send reaction TAGMSG. */
	function handleEmojiSelect(emoji: string): void {
		if (emojiPickerTarget === '_input_') {
			// Insert emoji into message input by dispatching a custom event
			window.dispatchEvent(new CustomEvent('accord:insert-emoji', { detail: { emoji } }));
			emojiPickerTarget = null;
			emojiPickerPosition = null;
			return;
		}
		if (!conn || !emojiPickerTarget || !channelUIState.activeChannel) return;
		tagmsg(conn, channelUIState.activeChannel, {
			'+draft/react': emoji,
			'+draft/reply': emojiPickerTarget,
		});
		emojiPickerTarget = null;
		emojiPickerPosition = null;
	}

	function handleEmojiPickerClose(): void {
		emojiPickerTarget = null;
		emojiPickerPosition = null;
	}

	/** Toggle a reaction on a message (click existing reaction pill). */
	function handleToggleReaction(msgid: string, emoji: string): void {
		if (!conn || !channelUIState.activeChannel) return;
		const channel = channelUIState.activeChannel;

		// Send the reaction toggle via TAGMSG
		tagmsg(conn, channel, {
			'+draft/react': emoji,
			'+draft/reply': msgid,
		});
	}

	/** More menu clicked — offer delete. */
	function handleMore(msgid: string, _event: MouseEvent): void {
		if (!channelUIState.activeChannel) return;
		deleteTarget = { msgid, channel: channelUIState.activeChannel };
	}

	/** Pin/unpin a message in the active channel. */
	function handlePin(msgid: string): void {
		const channel = channelUIState.activeChannel;
		if (!channel) return;
		if (isPinned(channel, msgid)) {
			unpinMessage(channel, msgid);
		} else {
			pinMessage(channel, msgid);
		}
	}

	/** Confirm message deletion — send REDACT. */
	function handleConfirmDelete(): void {
		if (!conn || !deleteTarget) return;
		redact(conn, deleteTarget.channel, deleteTarget.msgid);
		redactMessage(deleteTarget.channel, deleteTarget.msgid);
		deleteTarget = null;
	}

	function handleCancelDelete(): void {
		deleteTarget = null;
	}

	/** Retry sending a failed message. */
	function handleRetry(msgid: string): void {
		const channel = channelUIState.activeChannel;
		if (!channel || !conn) return;
		const msg = getMessage(channel, msgid);
		if (!msg || msg.sendState !== 'failed') return;

		updateSendState(channel, msgid, 'sending');
		let sent: boolean;
		if (msg.replyTo) {
			// Re-emit with the original reply context
			const tags = `@+draft/reply=${escapeTagValue(msg.replyTo)}`;
			sent = conn.send(`${tags} PRIVMSG ${channel} :${msg.text}`);
		} else {
			sent = privmsg(conn, channel, msg.text);
		}
		updateSendState(channel, msgid, sent ? 'sent' : 'failed');
	}

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

	/** Wrapper: voice channel click delegates to extracted manager, manages local state. */
	async function handleVoiceChannelClick(channel: string): Promise<void> {
		const result = await voiceChannelClick(channel, conn, voiceRoom);
		if (result.ok) {
			// Toggle off returns a null-like room; toggle on returns the new room
			voiceRoom = voiceState.isConnected ? result.room : null;
		} else {
			voiceError = result.error;
			setTimeout(() => { voiceError = null; }, 5_000);
		}
	}

	/** Wrapper: DM voice call delegates to extracted manager. */
	async function handleDMVoiceCall(target: string): Promise<void> {
		const result = await dmVoiceCall(target, conn, voiceRoom);
		if (result.ok) {
			voiceRoom = voiceState.isConnected ? result.room : null;
		} else {
			voiceError = result.error;
			setTimeout(() => { voiceError = null; }, 5_000);
		}
	}

	/** Wrapper: DM video call delegates to extracted manager. */
	async function handleDMVideoCall(target: string): Promise<void> {
		const result = await dmVideoCall(target, conn, voiceRoom);
		if (result.ok) {
			voiceRoom = voiceState.isConnected ? result.room : null;
		} else {
			voiceError = result.error;
			setTimeout(() => { voiceError = null; }, 5_000);
		}
	}

	/**
	* Fetch virc.json from the files server.
	* Returns parsed config or null on failure.
	*/
	async function fetchVircConfig(filesUrl: string): Promise<VircConfig | null> {
		try {
			const token = getToken();
			const headers: Record<string, string> = {};
			if (token) {
				headers['Authorization'] = `Bearer ${token}`;
			}
			const res = await fetch(`${filesUrl}/.well-known/virc.json`, { headers });
			if (!res.ok) return null;
			return (await res.json()) as VircConfig;
		} catch {
			return null;
		}
	}

	/**
	* Connect to IRC, authenticate, fetch virc.json, populate state,
	* and auto-join channels.
	*/
	async function initConnection(): Promise<void> {
		const creds = await getCredentials();
		if (!creds) {
			error = 'No saved credentials. Please log in.';
			initializing = false;
			return;
		}

		// Rehydrate user state from localStorage
		rehydrate();

		// Determine server URLs from localStorage (set during login)
		const serverUrl = localStorage.getItem('accord:serverUrl')
			?? (import.meta.env.DEV ? `ws://${window.location.hostname}:8097` : null);
		if (!serverUrl) {
			error = 'No server URL configured. Please log in again.';
			initializing = false;
			return;
		}
		const filesUrl = localStorage.getItem('accord:filesUrl') ?? null;

		error = null;

		try {
			// 1. Create and connect
			conn = new IRCConnection({ url: serverUrl });
			setConnecting();
			await conn.connect();
			setConnected();

			// 2. Register message handler (before sending any commands)
			registerHandler(conn);

			// 3. CAP negotiation + NICK/USER
			// CAP LS must be sent before NICK/USER to prevent premature registration
			const capPromise = negotiateCaps(conn);
			conn.send(`NICK ${creds.account}`);
			conn.send(`USER ${creds.account} 0 * :${creds.account}`);
			await capPromise;

			// 4. SASL authentication
			await authenticateSASL(conn, creds.account, creds.password);

			// 4b. Fetch initial JWT and start refresh loop with auth expiry detection
			if (filesUrl) {
				try {
					await fetchToken(filesUrl, creds.account, creds.password);
					startTokenRefresh(filesUrl, () => {
						authExpired = true;
					});
				} catch {
					// JWT fetch failure at startup is not fatal — file uploads won't work
					// but chat still functions. Auth expiry modal fires on refresh failure.
				}
			}

			// 5. Fetch virc.json
			const config = filesUrl ? await fetchVircConfig(filesUrl) : null;

			// 5b. Store config for ServerSettings modal
			if (config) {
				setServerConfig(config);
			}

			// 6. Register server in state
			const serverName = config?.name ?? 'IRC Server';
			const serverIcon = config?.icon ?? null;
			addServer({
				id: 'default',
				name: serverName,
				url: serverUrl,
				filesUrl,
				icon: serverIcon && filesUrl ? `${filesUrl}${serverIcon}` : null,
			});

			// Update window title with server name (sets Tauri window title too)
			document.title = serverName;

			// Apply server theme overrides if configured
			if (config?.theme) {
				const overrides = parseServerTheme(config.theme);
				if (Object.keys(overrides).length > 0) {
					applyServerTheme(overrides);
				}
			}

			// 6b. Load custom emoji from virc.json
			if (config?.emoji && typeof config.emoji === 'object') {
				// Resolve relative emoji URLs against the files server
				const resolved: Record<string, string> = {};
				for (const [name, url] of Object.entries(config.emoji)) {
					if (url.startsWith('http://') || url.startsWith('https://')) {
						resolved[name] = url;
					} else if (filesUrl) {
						resolved[name] = `${filesUrl}${url}`;
					} else {
						resolved[name] = url;
					}
				}
				setCustomEmoji(resolved);
			}

			// 7. Populate categories from virc.json
			const categories = config?.channels?.categories ?? [
				{ name: 'Channels', channels: ['#general'] },
			];
			setCategories(categories);

			// 8. Auto-join all channels from categories
			const allChannels = categories.flatMap((cat) => cat.channels);
			if (allChannels.length > 0) {
				join(conn, allChannels);
			}

			// 9. Fetch initial message history for all text channels.
			// CHATHISTORY LATEST loads the most recent messages from the server.
			// This runs immediately after JOIN so message buffers are populated
			// before the UI renders (no empty channel flash on app restart).
			const textChannels = categories
				.filter((cat) => !cat.voice)
				.flatMap((cat) => cat.channels);
			for (const channel of textChannels) {
				chathistory(conn, 'LATEST', channel, '*', '50');
			}

			// 10. Set first text channel as active
			const firstTextCategory = categories.find((cat) => !cat.voice);
			const firstChannel = firstTextCategory?.channels[0] ?? allChannels[0];
			if (firstChannel) {
				setActiveChannel(firstChannel);
			}

			// 10b. Show welcome modal on first join (once per server)
			if (config?.welcome?.message) {
				const serverId = serverUrl;
				const dismissKey = `accord:welcome-dismissed:${serverId}`;
				if (!localStorage.getItem(dismissKey)) {
					welcomeConfig = {
						serverName: config.name ?? 'IRC Server',
						message: config.welcome.message,
						suggestedChannels: config.welcome.suggested_channels ?? [],
					};
				}
			}

			// 11. Register reconnect event handlers
			conn.on('reconnecting', (attempt: number) => {
				setReconnecting(attempt);
			});

			conn.on('reconnected', () => {
				handleReconnect(filesUrl);
			});

			initializing = false;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			setDisconnected(msg);
			// Clean up the partially-connected socket to prevent background reconnect attempts
			if (conn) {
				try { conn.disconnect(); } catch { /* ignore */ }
			}
			initializing = false;
		}
	}

	/**
	* Handle a successful WebSocket reconnect.
	* Re-authenticates, rejoins channels, fills message gaps, and refreshes JWT.
	*/
	async function handleReconnect(filesUrl: string | null): Promise<void> {
		if (!conn) return;
		if (_reconnecting) return; // Prevent overlapping reconnect attempts
		_reconnecting = true;

		const creds = await getCredentials();
		if (!creds) { _reconnecting = false; return; }

		try {
			// Clear stale handler state (batch buffers, typing timers)
			resetHandlerState();

			// 1. Re-register message handler on the new WebSocket
			registerHandler(conn);

			// 2. CAP negotiation + NICK/USER
			const capPromise = negotiateCaps(conn);
			conn.send(`NICK ${creds.account}`);
			conn.send(`USER ${creds.account} 0 * :${creds.account}`);
			await capPromise;

			// 3. SASL re-authentication
			await authenticateSASL(conn, creds.account, creds.password);

			// 4. Refresh virc-files JWT
			if (filesUrl) {
				try {
					await fetchToken(filesUrl, creds.account, creds.password);
					startTokenRefresh(filesUrl, () => {
						authExpired = true;
					});
				} catch {
					// Non-fatal — chat still works without JWT
				}
			}

			// 5. Re-join all previously joined channels (suppress self-JOIN system messages)
			const joinedChannels = Array.from(channelState.channels.keys()).filter(
				(ch) => ch.startsWith('#') || ch.startsWith('&')
			);

			// Clear stale member lists before re-joining. The server sends fresh
			// NAMES after each JOIN which will repopulate them. Without this,
			// users who left while we were disconnected would remain as ghosts.
			for (const ch of joinedChannels) {
				clearChannelMembers(ch);
			}

			setSuppressSelfJoins(joinedChannels.length);
			if (joinedChannels.length > 0) {
				join(conn, joinedChannels);
			}

			// 6. Fill message gaps or load initial history for each channel
			for (const channel of joinedChannels) {
				const cursors = getCursors(channel);
				if (cursors.newestMsgid) {
					// Have existing messages — fill the gap since last known message
					chathistory(conn, 'AFTER', channel, `msgid=${cursors.newestMsgid}`, '50');
				} else {
					// No messages in buffer — fetch latest history
					chathistory(conn, 'LATEST', channel, '*', '50');
				}
			}

			// 7. Re-establish MONITOR for presence tracking
			monitoredNicks.clear();
			const dmNicks = channelUIState.dmConversations.map((dm) => dm.nick);
			if (dmNicks.length > 0) {
				monitor(conn, '+', dmNicks);
				for (const n of dmNicks) monitoredNicks.add(n);
			}
			// Also monitor active channel members
			const activeChannel = channelUIState.activeChannel;
			if (activeChannel && !isDMTarget(activeChannel)) {
				updateMonitorForChannel(activeChannel);
			}

			// 8. Refresh voice connection if was in a voice channel
			if (voiceState.currentRoom && voiceRoom) {
				const voiceChannel = voiceState.currentRoom;
				try {
					await disconnectVoice(voiceRoom);
					voiceRoom = null;
					// Re-join the voice channel
					await handleVoiceChannelClick(voiceChannel);
				} catch {
					// Voice reconnect failure is non-fatal
					voiceRoom = null;
				}
			}

			// 9. Mark connected
			setConnected();
			error = null;
		} catch (e) {
			console.error('Reconnect recovery failed:', e);
			// Connection will retry via the existing backoff mechanism
		} finally {
			_reconnecting = false;
		}
	}

	/** Mark the active channel as read and sync via MARKREAD. */
	function markActiveChannelRead(): void {
		const channel = channelUIState.activeChannel;
		if (!channel) return;
		const cursors = getCursors(channel);
		if (cursors.newestMsgid) {
			markRead(channel, cursors.newestMsgid);
		}
		if (conn) {
			markread(conn, channel, new Date().toISOString());
		}
	}

	/** Scroll the message list by dispatching a custom event. */
	function scrollMessageList(action: 'pageup' | 'pagedown' | 'home' | 'end'): void {
		window.dispatchEvent(new CustomEvent('accord:scroll-messages', { detail: { action } }));
	}

	// Track the msgid and channel being edited — redaction deferred until user confirms send
	let editingMsgid: string | null = $state(null);
	let editingChannel: string | null = $state(null);

	/**
	* "Edit" the last message by the current user:
	* Populates the input with the message text. The original message is only
	* redacted when the user actually sends the edited text (or discarded if
	* the user cancels / clears the input).
	*/
	function editLastMessage(): void {
		const channel = channelUIState.activeChannel;
		if (!channel) return;
		const nick = userState.nick;
		if (!nick) return;

		const msgs = getMessages(channel);
		// Find the last non-redacted privmsg by the current user
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m = msgs[i];
			if (m.nick === nick && m.type === 'privmsg' && !m.isRedacted) {
				// Store the msgid and channel for deferred redaction on send
				editingMsgid = m.msgid;
				editingChannel = channel;
				// Set the input textarea value by dispatching a custom event
				// The MessageInput component will pick this up
				window.dispatchEvent(
					new CustomEvent('accord:edit-message', { detail: { text: m.text } })
				);
				return;
			}
		}
	}

	/** Called by MessageInput after a successful send while editing. */
	function handleEditComplete(): void {
		// The edit is handled entirely by the +accord/edit tag on the PRIVMSG.
		// The server echoes it back, and handlePrivmsg updates the message in-place
		// via updateMessageText(). No REDACT needed — that would hide the message.
		editingMsgid = null;
		editingChannel = null;
	}

	/** Called when the user cancels editing (Escape or clearing input). */
	function handleEditCancel(): void {
		editingMsgid = null;
		editingChannel = null;
	}

	/** Edit a specific message by msgid (from More menu). */
	function handleEditMessage(msgid: string): void {
		const channel = channelUIState.activeChannel;
		if (!channel) return;
		const msg = getMessage(channel, msgid);
		if (!msg || msg.isRedacted) return;

		editingMsgid = msg.msgid;
		editingChannel = channel;
		window.dispatchEvent(
			new CustomEvent('accord:edit-message', { detail: { text: msg.text } })
		);
	}

	/** Copy message text to clipboard. */
	function handleCopyText(text: string): void {
		navigator.clipboard.writeText(text).catch(() => {
			// Fallback: ignore clipboard errors silently
		});
	}

	/** Copy a permalink-style reference to clipboard. */
	function handleCopyLink(msgid: string): void {
		const channel = channelUIState.activeChannel;
		if (!channel) return;
		const server = getActiveServer();
		const serverName = server?.name ?? 'irc';
		const link = `${serverName}/${channel}/${msgid}`;
		navigator.clipboard.writeText(link).catch(() => {});
	}

	/** Set read marker to a specific message (Mark Unread). */
	function handleMarkUnread(msgid: string): void {
		const channel = channelUIState.activeChannel;
		if (!channel || !conn) return;
		const msg = getMessage(channel, msgid);
		if (!msg) return;
		// Set read marker to this message's timestamp via MARKREAD
		markread(conn, channel, msg.time.toISOString());
	}

	/** Scroll to a specific message in the message list (used by pinned messages). */
	function handleScrollToMessage(msgid: string): void {
		window.dispatchEvent(
			new CustomEvent('accord:scroll-to-message', { detail: { msgid } })
		);
	}

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

	/** Dismiss the welcome modal and persist in localStorage. */
	function dismissWelcome(): void {
		const serverUrl = localStorage.getItem('accord:serverUrl');
		if (serverUrl) {
			localStorage.setItem(`accord:welcome-dismissed:${serverUrl}`, '1');
		}
		welcomeConfig = null;
	}

	/** Handle channel click from welcome modal: switch to the channel. */
	function handleWelcomeJoinChannel(channel: string): void {
		const normalized = channel.startsWith('#') ? channel : `#${channel}`;
		setActiveChannel(normalized);
	}

	// ---------------------------------------------------------------------------
	// Keyboard shortcuts
	// ---------------------------------------------------------------------------

	let cleanupKeybindings: (() => void) | null = null;
	let cleanupGlobalHandler: (() => void) | null = null;

	function setupKeybindings(): void {
		cleanupGlobalHandler = installGlobalHandler();

		cleanupKeybindings = registerKeybindings([
			// Ctrl+K — Quick switcher
			{
				key: 'k',
				ctrl: true,
				handler: () => {
					showQuickSwitcher = !showQuickSwitcher;
					return true;
				},
				description: 'Open quick channel switcher',
			},
			// Ctrl+, — User settings
			{
				key: ',',
				ctrl: true,
				handler: () => {
					showSettings = !showSettings;
					return true;
				},
				description: 'Open user settings',
			},
			// Alt+ArrowUp — Previous channel
			{
				key: 'ArrowUp',
				alt: true,
				handler: () => {
					navigateChannel(-1);
					return true;
				},
				description: 'Navigate to previous channel',
			},
			// Alt+ArrowDown — Next channel
			{
				key: 'ArrowDown',
				alt: true,
				handler: () => {
					navigateChannel(1);
					return true;
				},
				description: 'Navigate to next channel',
			},
			// Alt+Shift+ArrowUp — Previous unread channel
			{
				key: 'ArrowUp',
				alt: true,
				shift: true,
				handler: () => {
					navigateUnreadChannel(-1);
					return true;
				},
				description: 'Navigate to previous unread channel',
			},
			// Alt+Shift+ArrowDown — Next unread channel
			{
				key: 'ArrowDown',
				alt: true,
				shift: true,
				handler: () => {
					navigateUnreadChannel(1);
					return true;
				},
				description: 'Navigate to next unread channel',
			},
			// Ctrl+Shift+F — Search messages
			{
				key: 'F',
				ctrl: true,
				shift: true,
				handler: () => {
					showSearch = true;
					// Focus the search input after panel renders
					tick().then(() => searchPanelRef?.focusInput());
					return true;
				},
				description: 'Search messages',
			},
			// Escape — Close modals, cancel reply, close emoji picker
			{
				key: 'Escape',
				handler: () => {
					if (welcomeConfig) {
						dismissWelcome();
						return true;
					}
					if (profilePopout) {
						profilePopout = null;
						return true;
					}
					if (showVoiceOverlay) {
						showVoiceOverlay = false;
						overlayDismissed = true;
						return true;
					}
					if (showSettings) {
						showSettings = false;
						return true;
					}
					if (showServerSettings) {
						showServerSettings = false;
						return true;
					}
					if (showQuickSwitcher) {
						showQuickSwitcher = false;
						return true;
					}
					if (showSearch) {
						showSearch = false;
						return true;
					}
					if (deleteTarget) {
						deleteTarget = null;
						return true;
					}
					if (emojiPickerTarget) {
						emojiPickerTarget = null;
						emojiPickerPosition = null;
						return true;
					}
					if (replyContext) {
						replyContext = null;
						return true;
					}
					// Close responsive overlays
					if (showSidebar && sidebarIsOverlay) {
						showSidebar = false;
						return true;
					}
					if (showMembers && !isDesktop) {
						showMembers = false;
						return true;
					}
					// Don't prevent default if nothing to close
					return false;
				},
				description: 'Close modal / cancel reply / close emoji picker',
			},
			// Ctrl+Shift+M — Toggle voice mute
			{
				key: 'M',
				ctrl: true,
				shift: true,
				handler: () => {
					if (voiceState.isConnected && voiceRoom) {
						toggleMuteRoom(voiceRoom);
						return true;
					}
					return false;
				},
				description: 'Toggle voice mute',
			},
			// Ctrl+Shift+D — Toggle voice deafen
			{
				key: 'D',
				ctrl: true,
				shift: true,
				handler: () => {
					if (voiceState.isConnected && voiceRoom) {
						toggleDeafenRoom(voiceRoom);
						return true;
					}
					return false;
				},
				description: 'Toggle voice deafen',
			},
			// Ctrl+Shift+V — Toggle camera
			{
				key: 'V',
				ctrl: true,
				shift: true,
				handler: () => {
					if (voiceState.isConnected && voiceRoom) {
						toggleVideoRoom(voiceRoom);
						return true;
					}
					return false;
				},
				description: 'Toggle camera',
			},
			// Ctrl+Shift+S — Toggle screen share
			{
				key: 'S',
				ctrl: true,
				shift: true,
				handler: () => {
					if (voiceState.isConnected && voiceRoom) {
						toggleScreenShareRoom(voiceRoom);
						return true;
					}
					return false;
				},
				description: 'Toggle screen share',
			},
			// Ctrl+[ — Previous server
			{
				key: '[',
				ctrl: true,
				handler: () => {
					navigateServer(-1);
					return true;
				},
				description: 'Navigate to previous server',
			},
			// Ctrl+] — Next server
			{
				key: ']',
				ctrl: true,
				handler: () => {
					navigateServer(1);
					return true;
				},
				description: 'Navigate to next server',
			},
			// Ctrl+E — Toggle emoji picker
			{
				key: 'e',
				ctrl: true,
				handler: () => {
					handleInputEmojiPicker();
					return true;
				},
				description: 'Toggle emoji picker',
			},
			// Shift+Escape — Mark channel as read
			{
				key: 'Escape',
				shift: true,
				handler: () => {
					markActiveChannelRead();
					return true;
				},
				description: 'Mark channel as read',
			},
			// PageUp — Scroll messages up
			{
				key: 'PageUp',
				handler: (e) => {
					// Don't capture when in an input/textarea
					const tag = (e.target as HTMLElement)?.tagName;
					if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
					scrollMessageList('pageup');
					return true;
				},
				description: 'Scroll messages up',
			},
			// PageDown — Scroll messages down
			{
				key: 'PageDown',
				handler: (e) => {
					const tag = (e.target as HTMLElement)?.tagName;
					if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
					scrollMessageList('pagedown');
					return true;
				},
				description: 'Scroll messages down',
			},
			// Home — Jump to oldest loaded message
			{
				key: 'Home',
				handler: (e) => {
					const tag = (e.target as HTMLElement)?.tagName;
					if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
					scrollMessageList('home');
					return true;
				},
				description: 'Jump to oldest message',
			},
			// End — Jump to newest message
			{
				key: 'End',
				handler: (e) => {
					const tag = (e.target as HTMLElement)?.tagName;
					if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
					scrollMessageList('end');
					return true;
				},
				description: 'Jump to newest message',
			},
		]);
	}

	function teardownKeybindings(): void {
		cleanupKeybindings?.();
		cleanupGlobalHandler?.();
		cleanupKeybindings = null;
		cleanupGlobalHandler = null;
	}

	// --- Push-to-talk ---

	let pttActive = false;

	function handlePTTKeyDown(e: KeyboardEvent): void {
		if (!audioSettings.pushToTalk || !voiceState.isConnected || !voiceRoom) return;
		if (e.code !== audioSettings.pttKey) return;
		if (pttActive) return; // Key repeat
		// Don't capture when typing in inputs
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		e.preventDefault();
		pttActive = true;
		voiceRoom.localParticipant.setMicrophoneEnabled(true);
		voiceState.localMuted = false;
		updateParticipant(voiceRoom.localParticipant.identity, { isMuted: false });
	}

	function handlePTTKeyUp(e: KeyboardEvent): void {
		if (!audioSettings.pushToTalk || !voiceRoom) return;
		if (e.code !== audioSettings.pttKey) return;
		if (!pttActive) return;
		releasePTT();
	}

	/** Release PTT — shared by keyup and window blur. */
	function releasePTT(): void {
		if (!pttActive || !voiceRoom) return;
		pttActive = false;
		voiceRoom.localParticipant.setMicrophoneEnabled(false);
		voiceState.localMuted = true;
		updateParticipant(voiceRoom.localParticipant.identity, { isMuted: true });
	}

	/** Release PTT when window loses focus (keyup won't fire). */
	function handleWindowBlur(): void {
		if (pttActive) releasePTT();
	}

	// Sync output volume to all remote audio tracks when slider changes.
	$effect(() => {
		const vol = audioSettings.outputVolume / 100;
		if (!voiceRoom) return;
		for (const p of voiceRoom.remoteParticipants.values()) {
			for (const pub of p.trackPublications.values()) {
				if (pub.track && pub.track.kind === 'audio') {
					(pub.track as any).setVolume?.(vol);
				}
			}
		}
	});

	// Switch input device when changed in settings while connected.
	$effect(() => {
		const deviceId = audioSettings.inputDeviceId;
		if (!voiceRoom) return;
		voiceRoom.switchActiveDevice('audioinput', deviceId)
			.catch((err) => console.error('[virc] Failed to switch input device:', err));
	});

	// Switch output device when changed in settings while connected.
	$effect(() => {
		const deviceId = audioSettings.outputDeviceId;
		if (!voiceRoom) return;
		voiceRoom.switchActiveDevice('audiooutput', deviceId)
			.catch((err) => console.error('[virc] Failed to switch output device:', err));
	});

	// Switch video device when changed in settings while connected with camera on.
	$effect(() => {
		const deviceId = audioSettings.videoDeviceId;
		if (!voiceRoom || !voiceState.localVideoEnabled) return;
		voiceRoom.switchActiveDevice('videoinput', deviceId)
			.catch((err) => console.error('[virc] Failed to switch video device:', err));
	});

	// Auto-open voice overlay when video tracks first appear (camera/screen share).
	// Respects user dismissal — won't re-open until next voice session.
	$effect(() => {
		if (voiceState.videoTracks.length > 0 && voiceState.isConnected && !overlayDismissed) {
			showVoiceOverlay = true;
		}
	});

	// Auto-close voice overlay when voice disconnects and reset dismissal flag.
	$effect(() => {
		if (!voiceState.isConnected) {
			showVoiceOverlay = false;
			overlayDismissed = false;
		}
	});

	/** Emergency logout — works even during connecting/error state. */
	function forceLogout(): void {
		try { if (conn) { conn.disconnect(); conn = null; } } catch { /* ignore */ }
		// Best-effort credential cleanup (async, but localStorage clears synchronously)
		void clearCredentials();
		clearToken();
		localStorage.removeItem('accord:serverUrl');
		localStorage.removeItem('accord:filesUrl');
		// Hard navigate — bypasses SvelteKit lifecycle that may be blocked
		window.location.href = '/login';
	}

	onMount(() => {
		setupKeybindings();
		document.addEventListener('keydown', handlePTTKeyDown);
		document.addEventListener('keyup', handlePTTKeyUp);
		window.addEventListener('blur', handleWindowBlur);
		initConnection();
	});

	onDestroy(() => {
		teardownKeybindings();
		document.removeEventListener('keydown', handlePTTKeyDown);
		document.removeEventListener('keyup', handlePTTKeyUp);
		window.removeEventListener('blur', handleWindowBlur);
		stopTokenRefresh();

		if (rateLimitTimer) {
			clearInterval(rateLimitTimer);
			rateLimitTimer = null;
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
	<!-- Far left: Server list strip -->
	<ServerList onserversettings={() => { serverSettingsInitialTab = 'overview'; showServerSettings = true; }} />

	<!-- Left column: Channel sidebar -->
	<div class="left-panel" class:overlay={sidebarIsOverlay} class:visible={sidebarIsOverlay && showSidebar} style="width: {appSettings.sidebarWidth}px;">
		<ChannelSidebar onvoicechannelclick={handleVoiceChannelClick} {voiceRoom} onsettingsclick={() => (showSettings = true)} onserversettingsclick={() => { serverSettingsInitialTab = 'overview'; showServerSettings = true; }} oncreatechannel={(ch) => { if (conn) { join(conn, [ch]); setActiveChannel(ch); chathistory(conn, 'LATEST', ch, '*', '50'); } }} onvoiceexpand={() => (showVoiceOverlay = true)} />
		{#if !sidebarIsOverlay}
			<ResizeHandle side="left" min={SIDEBAR_MIN} max={SIDEBAR_MAX} width={appSettings.sidebarWidth} onresize={(w) => { appSettings.sidebarWidth = w; }} />
		{/if}
	</div>

	<!-- Sidebar overlay backdrop -->
	{#if sidebarIsOverlay && showSidebar}
		<div class="overlay-backdrop" role="presentation" onclick={handleOverlayClick}></div>
	{/if}

	<!-- Center column: Header + Messages + Input -->
	<div class="center-panel">
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
			onopenserversettings={() => { serverSettingsInitialTab = 'channels'; showServerSettings = true; }}
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
				{#if error}
					<div class="error-banner">
						<span>Connection error: {error}</span>
						<button class="error-logout-btn" onclick={forceLogout}>Log Out</button>
					</div>
				{:else if connectionState.status === 'connecting' || initializing}
					<div class="splash-screen">
						<div class="splash-spinner"></div>
						<span class="splash-text">Connecting to server...</span>
						<button class="splash-logout-btn" onclick={forceLogout}>Log Out</button>
					</div>
				{:else if !channelUIState.activeChannel}
					<div class="empty-state">
						<p>Select a channel to start chatting</p>
					</div>
				{:else}
					<MessageList
						onloadhistory={handleLoadHistory}
						onreply={handleReply}
						onreact={handleReact}
						onmore={handleMore}
						onpin={handlePin}
						onedit={handleEditMessage}
						oncopytext={handleCopyText}
						oncopylink={handleCopyLink}
						onmarkunread={handleMarkUnread}
						ontogglereaction={handleToggleReaction}
						onretry={handleRetry}
						onnickclick={handleNickClick}
						{isOp}
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
		</div>

		{#if channelUIState.activeChannel}
			<TypingIndicator channel={channelUIState.activeChannel} />
			<MessageInput
				target={channelUIState.activeChannel}
				connection={conn}
				reply={replyContext}
				oncancelreply={handleCancelReply}
				oneditlast={editLastMessage}
				editing={editingMsgid !== null}
				editMsgid={editingMsgid}
				oneditcomplete={handleEditComplete}
				oneditcancel={handleEditCancel}
				disconnected={isDisconnected}
				{rateLimitSeconds}
				filesUrl={activeFilesUrl}
				onemojipicker={handleInputEmojiPicker}
			/>
		{:else}
			<div class="message-input-area">
				<div class="input-placeholder">
					<span class="input-placeholder-text">Select a channel</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Right column: Member list (overlay below 1200px, hidden for DMs) -->
	{#if !isActiveDM && (isDesktop || showMembers)}
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
			onselect={handleEmojiSelect}
			onclose={handleEmojiPickerClose}
		/>
	</div>
{/if}

<!-- Delete confirmation dialog -->
{#if deleteTarget}
	<div class="delete-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" tabindex="-1" onclick={handleCancelDelete} onkeydown={(e) => { if (e.key === 'Escape') handleCancelDelete(); }}>
		<div class="delete-dialog" role="presentation" onclick={(e) => e.stopPropagation()}>
			<h3 id="delete-dialog-title" class="delete-title">Delete Message</h3>
			<p class="delete-text">Are you sure you want to delete this message? This cannot be undone.</p>
			<div class="delete-actions">
				<button class="btn-cancel" onclick={handleCancelDelete}>Cancel</button>
				<button class="btn-delete" onclick={handleConfirmDelete}>Delete</button>
			</div>
		</div>
	</div>
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
	<UserSettings onclose={() => (showSettings = false)} connection={conn} />
{/if}

{#if showServerSettings}
	<ServerSettings onclose={() => (showServerSettings = false)} connection={conn} initialTab={serverSettingsInitialTab} />
{/if}

<!-- Voice overlay (expanded view with video grid + participants) -->
{#if showVoiceOverlay && voiceState.isConnected && voiceRoom}
	<VoiceOverlay {voiceRoom} onclose={() => { showVoiceOverlay = false; overlayDismissed = true; }} />
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

	/* Status banners */
	.error-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 8px 16px;
		background: var(--danger);
		color: var(--text-inverse);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
	}

	.error-logout-btn {
		padding: 4px 12px;
		background: rgba(255, 255, 255, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.4);
		border-radius: 4px;
		color: var(--text-inverse);
		font-size: var(--font-sm);
		cursor: pointer;
	}

	.error-logout-btn:hover {
		background: rgba(255, 255, 255, 0.3);
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

	/* Branded splash screen for initial connection */
	.splash-screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
	}

	.splash-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--surface-high);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: splash-spin 0.8s linear infinite;
	}

	.splash-text {
		color: var(--text-secondary);
		font-size: var(--font-base);
	}

	.splash-logout-btn {
		margin-top: 8px;
		padding: 6px 16px;
		background: none;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		color: var(--text-secondary);
		font-size: var(--font-sm);
		cursor: pointer;
		transition: color var(--duration-channel), border-color var(--duration-channel);
	}

	.splash-logout-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	@keyframes splash-spin {
		to { transform: rotate(360deg); }
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

	/* Delete confirmation overlay */
	.delete-overlay {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
	}

	.delete-dialog {
		background: var(--surface-low);
		border-radius: 8px;
		padding: 24px;
		max-width: 400px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.delete-title {
		margin: 0 0 8px;
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.delete-text {
		margin: 0 0 20px;
		font-size: var(--font-base);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.delete-actions {
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

	.btn-delete {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--danger);
		color: var(--text-inverse);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-delete:hover {
		filter: brightness(1.1);
	}
</style>
