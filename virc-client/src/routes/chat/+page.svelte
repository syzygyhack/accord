<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { IRCConnection } from '$lib/irc/connection';
	import { negotiateCaps } from '$lib/irc/cap';
	import { authenticateSASL } from '$lib/irc/sasl';
	import { registerHandler, resetHandlerState } from '$lib/irc/handler';
	import { join, chathistory, markread, tagmsg, redact, privmsg, topic, monitor } from '$lib/irc/commands';
	import { getCredentials, getToken, fetchToken, startTokenRefresh, stopTokenRefresh } from '$lib/api/auth';
	import { connectToVoice, disconnectVoice } from '$lib/voice/room';
	import { voiceState, toggleMute, toggleDeafen } from '$lib/state/voice.svelte';
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
		setActiveChannel,
		setCategories,
		isDMTarget,
		openDM,
	} from '$lib/state/channels.svelte';
	import { markRead } from '$lib/state/notifications.svelte';
	import { getUnreadCount } from '$lib/state/notifications.svelte';
	import { getCursors, getMessage, getMessages, redactMessage, addReaction, removeReaction, updateSendState, addMessage } from '$lib/state/messages.svelte';
	import type { Message } from '$lib/state/messages.svelte';
	import { addServer, getActiveServer } from '$lib/state/servers.svelte';
	import { installGlobalHandler, registerKeybindings } from '$lib/keybindings';
	import ServerList from '../../components/ServerList.svelte';
	import ChannelSidebar from '../../components/ChannelSidebar.svelte';
	import HeaderBar from '../../components/HeaderBar.svelte';
	import MessageList from '../../components/MessageList.svelte';
	import MessageInput from '../../components/MessageInput.svelte';
	import MemberList from '../../components/MemberList.svelte';
	import TypingIndicator from '../../components/TypingIndicator.svelte';
	import EmojiPicker from '../../components/EmojiPicker.svelte';
	import QuickSwitcher from '../../components/QuickSwitcher.svelte';
	import AuthExpiredModal from '../../components/AuthExpiredModal.svelte';
	import ErrorBoundary from '../../components/ErrorBoundary.svelte';
	import ConnectionBanner from '../../components/ConnectionBanner.svelte';

	/** virc.json config shape (subset we consume). */
	interface VircConfig {
		name?: string;
		icon?: string;
		channels?: {
			categories?: Array<{
				name: string;
				channels: string[];
				voice?: boolean;
			}>;
		};
	}

	let conn: IRCConnection | null = $state(null);
	let voiceRoom: Room | null = $state(null);
	let showMembers = $state(false);
	let showSidebar = $state(false);
	let innerWidth = $state(0);
	let error: string | null = $state(null);
	let voiceError: string | null = $state(null);

	// Responsive breakpoints
	let isDesktop = $derived(innerWidth > 1200);
	let isTablet = $derived(innerWidth > 900 && innerWidth <= 1200);
	let isNarrow = $derived(innerWidth > 600 && innerWidth <= 900);
	let isMobile = $derived(innerWidth <= 600);
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

	// Auth expiry state
	let authExpired = $state(false);

	// Rate limit state
	let rateLimitSeconds = $state(0);
	let rateLimitTimer: ReturnType<typeof setInterval> | null = null;

	// Derived: is the active channel a DM?
	let isActiveDM = $derived(
		channelUIState.activeChannel ? isDMTarget(channelUIState.activeChannel) : false
	);

	// Derived disconnect state for MessageInput
	let isDisconnected = $derived(
		connectionState.status === 'disconnected' || connectionState.status === 'reconnecting'
	);

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

		// Clear reply/emoji/edit state on channel switch
		replyContext = null;
		editingMsgid = null;
		editingChannel = null;
		emojiPickerTarget = null;
		emojiPickerPosition = null;
		deleteTarget = null;
	});

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

	/** React button clicked on a message — open emoji picker. */
	function handleReact(msgid: string): void {
		emojiPickerTarget = msgid;
		emojiPickerPosition = {
			x: Math.max(16, window.innerWidth / 2 - 176),
			y: Math.max(16, window.innerHeight / 2 - 200),
		};
	}

	/** Emoji selected from picker — send reaction TAGMSG. */
	function handleEmojiSelect(emoji: string): void {
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
		try {
			privmsg(conn, channel, msg.text);
			updateSendState(channel, msgid, 'sent');
		} catch {
			updateSendState(channel, msgid, 'failed');
		}
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

	/**
	* Handle a voice channel click: request mic permission, fetch a
	* LiveKit token, connect to the room, and JOIN the IRC channel.
	*/
	async function handleVoiceChannelClick(channel: string): Promise<void> {
		// If already in this channel, disconnect instead (toggle behavior).
		if (voiceState.currentRoom === channel && voiceRoom) {
			await disconnectVoice(voiceRoom);
			voiceRoom = null;
			// PART the IRC voice channel for presence.
			if (conn) {
				conn.send(`PART ${channel}`);
			}
			return;
		}

		// If connected to a different voice channel, disconnect first.
		if (voiceRoom) {
			const prevChannel = voiceState.currentRoom;
			await disconnectVoice(voiceRoom);
			voiceRoom = null;
			if (conn && prevChannel) {
				conn.send(`PART ${prevChannel}`);
			}
		}

		try {
			// 1. Request microphone permission.
			await navigator.mediaDevices.getUserMedia({ audio: true });

			// 2. Fetch LiveKit token from virc-files.
			const server = getActiveServer();
			if (!server) throw new Error('No active server');

			const jwt = getToken();
			if (!jwt) throw new Error('Not authenticated');

			const res = await fetch(`${server.filesUrl}/api/livekit/token`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${jwt}`,
				},
				body: JSON.stringify({ channel }),
			});

			if (!res.ok) {
				throw new Error(`Failed to get voice token (${res.status})`);
			}

			const data = (await res.json()) as { token: string; url: string };

			// 3. Connect to the LiveKit room.
			voiceRoom = await connectToVoice(channel, data.url, data.token);

			// 4. JOIN the IRC voice channel for presence.
			if (conn) {
				join(conn, [channel]);
			}
		} catch (e) {
			console.error('Voice connection failed:', e);
			const msg = e instanceof Error ? e.message : String(e);
			voiceError = `Voice connection failed: ${msg}`;
			// Auto-clear the error after 5 seconds
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
		const creds = getCredentials();
		if (!creds) return;

		// Rehydrate user state from sessionStorage
		rehydrate();

		// Determine server URLs from sessionStorage
		const serverUrl = sessionStorage.getItem('virc:serverUrl') ?? 'ws://localhost:8097';
		const filesUrl = sessionStorage.getItem('virc:filesUrl') ?? 'http://localhost:8080';

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
			conn.send(`NICK ${creds.account}`);
			conn.send(`USER ${creds.account} 0 * :${creds.account}`);
			await negotiateCaps(conn);

			// 4. SASL authentication
			await authenticateSASL(conn, creds.account, creds.password);

			// 4b. Fetch initial JWT and start refresh loop with auth expiry detection
			try {
				await fetchToken(filesUrl, creds.account, creds.password);
				startTokenRefresh(filesUrl, () => {
					authExpired = true;
				});
			} catch {
				// JWT fetch failure at startup is not fatal — file uploads won't work
				// but chat still functions. Auth expiry modal fires on refresh failure.
			}

			// 5. Fetch virc.json
			const config = await fetchVircConfig(filesUrl);

			// 6. Register server in state
			const serverName = config?.name ?? 'IRC Server';
			const serverIcon = config?.icon ?? null;
			addServer({
				id: 'default',
				name: serverName,
				url: serverUrl,
				filesUrl,
				icon: serverIcon ? `${filesUrl}${serverIcon}` : null,
			});

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

			// 9. Set first text channel as active
			const firstTextCategory = categories.find((cat) => !cat.voice);
			const firstChannel = firstTextCategory?.channels[0] ?? allChannels[0];
			if (firstChannel) {
				setActiveChannel(firstChannel);
			}

			// 10. Register reconnect event handlers
			conn.on('reconnecting', (attempt: number) => {
				setReconnecting(attempt);
			});

			conn.on('reconnected', () => {
				handleReconnect(filesUrl);
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			setDisconnected(msg);
		}
	}

	/**
	* Handle a successful WebSocket reconnect.
	* Re-authenticates, rejoins channels, fills message gaps, and refreshes JWT.
	*/
	async function handleReconnect(filesUrl: string): Promise<void> {
		if (!conn) return;

		const creds = getCredentials();
		if (!creds) return;

		try {
			// Clear stale handler state (batch buffers, typing timers)
			resetHandlerState();

			// 1. Re-register message handler on the new WebSocket
			registerHandler(conn);

			// 2. NICK/USER + CAP negotiation
			conn.send(`NICK ${creds.account}`);
			conn.send(`USER ${creds.account} 0 * :${creds.account}`);
			await negotiateCaps(conn);

			// 3. SASL re-authentication
			await authenticateSASL(conn, creds.account, creds.password);

			// 4. Refresh virc-files JWT
			try {
				await fetchToken(filesUrl, creds.account, creds.password);
			} catch {
				// Non-fatal — chat still works without JWT
			}

			// 5. Re-join all previously joined channels
			const joinedChannels = Array.from(channelState.channels.keys()).filter(
				(ch) => ch.startsWith('#') || ch.startsWith('&')
			);
			if (joinedChannels.length > 0) {
				join(conn, joinedChannels);
			}

			// 6. Fill message gaps via CHATHISTORY AFTER for each channel
			for (const channel of joinedChannels) {
				const cursors = getCursors(channel);
				if (cursors.newestMsgid) {
					chathistory(conn, 'AFTER', channel, `msgid=${cursors.newestMsgid}`, '50');
				}
			}

			// 7. Re-establish MONITOR for presence tracking
			// Collect all unique nicks from DM conversations for monitoring
			const dmNicks = channelUIState.dmConversations.map((dm) => dm.nick);
			if (dmNicks.length > 0) {
				monitor(conn, '+', dmNicks);
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
		}
	}

	// ---------------------------------------------------------------------------
	// Channel navigation helpers
	// ---------------------------------------------------------------------------

	/**
	* Get the flat, ordered list of text channels (non-voice) from categories.
	* Used for Alt+Up/Down navigation.
	*/
	function getTextChannelList(): string[] {
		const channels: string[] = [];
		for (const dm of channelUIState.dmConversations) {
			channels.push(dm.nick);
		}
		for (const cat of channelUIState.categories) {
			if (cat.voice) continue;
			for (const ch of cat.channels) {
				channels.push(ch);
			}
		}
		return channels;
	}

	/** Navigate to the next or previous channel in the sidebar. */
	function navigateChannel(direction: 1 | -1): void {
		const channels = getTextChannelList();
		if (channels.length === 0) return;
		const current = channelUIState.activeChannel;
		const idx = current ? channels.indexOf(current) : -1;
		let next: number;
		if (idx === -1) {
			next = direction === 1 ? 0 : channels.length - 1;
		} else {
			next = (idx + direction + channels.length) % channels.length;
		}
		setActiveChannel(channels[next]);
	}

	/** Navigate to the next or previous unread channel. */
	function navigateUnreadChannel(direction: 1 | -1): void {
		const channels = getTextChannelList();
		if (channels.length === 0) return;
		const current = channelUIState.activeChannel;
		const idx = current ? channels.indexOf(current) : -1;
		const start = idx === -1 ? 0 : idx;

		// Search in the given direction for an unread channel
		for (let i = 1; i <= channels.length; i++) {
			const checkIdx = (start + i * direction + channels.length) % channels.length;
			if (getUnreadCount(channels[checkIdx]) > 0) {
				setActiveChannel(channels[checkIdx]);
				return;
			}
		}
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
					new CustomEvent('virc:edit-message', { detail: { text: m.text } })
				);
				return;
			}
		}
	}

	/** Called by MessageInput after a successful send while editing. */
	function handleEditComplete(): void {
		if (!editingMsgid || !editingChannel || !conn) {
			editingMsgid = null;
			editingChannel = null;
			return;
		}
		redact(conn, editingChannel, editingMsgid);
		redactMessage(editingChannel, editingMsgid);
		editingMsgid = null;
		editingChannel = null;
	}

	/** Called when the user cancels editing (Escape or clearing input). */
	function handleEditCancel(): void {
		editingMsgid = null;
		editingChannel = null;
	}

	/** Send a TOPIC command when the user edits the channel topic. */
	function handleTopicEdit(channel: string, newTopic: string): void {
		if (!conn) return;
		topic(conn, channel, newTopic);
	}

	/** Insert @nick mention into the message input via custom event. */
	function handleMemberMention(nick: string): void {
		window.dispatchEvent(
			new CustomEvent('virc:insert-mention', { detail: { nick } })
		);
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
			// Escape — Close modals, cancel reply, close emoji picker
			{
				key: 'Escape',
				handler: () => {
					if (showQuickSwitcher) {
						showQuickSwitcher = false;
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
					if (voiceState.isConnected) {
						toggleMute();
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
					if (voiceState.isConnected) {
						toggleDeafen();
						return true;
					}
					return false;
				},
				description: 'Toggle voice deafen',
			},
		]);
	}

	function teardownKeybindings(): void {
		cleanupKeybindings?.();
		cleanupGlobalHandler?.();
		cleanupKeybindings = null;
		cleanupGlobalHandler = null;
	}

	onMount(() => {
		setupKeybindings();
		initConnection();
	});

	onDestroy(() => {
		teardownKeybindings();
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
	});
</script>

<svelte:window bind:innerWidth={innerWidth} />

<div class="chat-layout">
	<!-- Left column: Server list + Channel sidebar -->
	<div class="left-panel" class:overlay={sidebarIsOverlay} class:visible={sidebarIsOverlay && showSidebar}>
		<ServerList />
		<ChannelSidebar onVoiceChannelClick={handleVoiceChannelClick} {voiceRoom} />
	</div>

	<!-- Sidebar overlay backdrop -->
	{#if sidebarIsOverlay && showSidebar}
		<div class="overlay-backdrop" role="presentation" onclick={handleOverlayClick}></div>
	{/if}

	<!-- Center column: Header + Messages + Input -->
	<div class="center-panel">
		<HeaderBar
			onToggleMembers={toggleMembers}
			membersVisible={showMembers}
			onTopicEdit={handleTopicEdit}
			onToggleSidebar={toggleSidebar}
			showSidebarToggle={sidebarIsOverlay}
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
					</div>
				{:else if connectionState.status === 'connecting'}
					<div class="splash-screen">
						<div class="splash-spinner"></div>
						<span class="splash-text">Connecting to server...</span>
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
						ontogglereaction={handleToggleReaction}
						onretry={handleRetry}
					/>
				{/if}
			</ErrorBoundary>
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
				oneditcomplete={handleEditComplete}
				oneditcancel={handleEditCancel}
				disconnected={isDisconnected}
				{rateLimitSeconds}
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
		<div class="right-panel" class:overlay={!isDesktop} class:visible={!isDesktop && showMembers}>
			<MemberList onmention={handleMemberMention} />
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
	}

	/* Below 900px: sidebar becomes an overlay that slides in from left */
	.left-panel.overlay {
		position: fixed;
		top: 0;
		left: 0;
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
		width: 240px;
		min-width: 240px;
		height: 100%;
		background: var(--surface-low);
		border-left: 1px solid var(--surface-lowest);
		overflow-y: auto;
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
		padding: 8px 16px;
		background: var(--danger);
		color: #fff;
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
	}

	.voice-error-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 6px 16px;
		background: rgba(224, 64, 64, 0.15);
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
		color: #fff;
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-delete:hover {
		filter: brightness(1.1);
	}
</style>
