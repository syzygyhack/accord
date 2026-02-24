/**
 * Connection lifecycle management.
 *
 * Extracted from +page.svelte — handles the full connect/authenticate/configure
 * sequence and reconnection recovery. The component passes callbacks so this
 * module never touches reactive (Svelte) state directly.
 */

import { IRCConnection } from '$lib/irc/connection';
import { negotiateCaps } from '$lib/irc/cap';
import { authenticateSASL } from '$lib/irc/sasl';
import { registerHandler, resetHandlerState, setSuppressSelfJoins } from '$lib/irc/handler';
import { join, chathistory, markread, monitor, who } from '$lib/irc/commands';
import { getCredentials, getToken, fetchToken, startTokenRefresh } from '$lib/api/auth';
import {
	setConnecting,
	setConnected,
	setDisconnected,
	setReconnecting,
} from '$lib/state/connection.svelte';
import { rehydrate } from '$lib/state/user.svelte';
import {
	channelUIState,
	channelState,
	setActiveChannel,
	setCategories,
	isDMTarget,
	restoreDMConversations,
} from '$lib/state/channels.svelte';
import { addServer } from '$lib/state/servers.svelte';
import { getCursors } from '$lib/state/messages.svelte';
import { applyServerTheme, parseServerTheme } from '$lib/state/theme.svelte';
import { setServerConfig, getCachedConfig, setCachedConfig } from '$lib/state/serverConfig.svelte';
import type { AccordConfig } from '$lib/state/serverConfig.svelte';
import { setCustomEmoji } from '$lib/emoji';
import { fetchAllProfiles } from '$lib/state/profiles.svelte';

// ---- Types ----------------------------------------------------------------

/** Callbacks the component provides so lifecycle can communicate state changes. */
export interface LifecycleCallbacks {
	/** Called when the IRC connection instance is created. */
	onConnection(conn: IRCConnection): void;
	/** Called when a non-fatal error should be displayed (null to clear). */
	onError(message: string | null): void;
	/** Called to flag that initialisation is complete (success or failure). */
	onInitDone(): void;
	/** Called when the auth token has expired. */
	onAuthExpired(): void;
	/** Called when the server has a welcome config to show. */
	onWelcome(config: { serverName: string; message: string; suggestedChannels: string[] }): void;
	/** Called on reconnect — lets the component clear channel members. */
	clearChannelMembers(channel: string): void;
	/** Called on reconnect — lets the component refresh voice. */
	handleVoiceReconnect(): Promise<void>;
	/** Called on reconnect — updates MONITOR for a channel. */
	updateMonitorForChannel(channel: string): void;
	/** Called on reconnect — clears the component's monitored nicks set. */
	clearMonitoredNicks(): void;
	/** Called on reconnect — adds nicks to the component's monitored nicks set. */
	addMonitoredNicks(nicks: string[]): void;
}

// ---- Helpers ---------------------------------------------------------------

/**
 * Fetch accord.json from the files server.
 * Sends If-None-Match with cached ETag when available.
 * On 304 Not Modified, returns the cached config from localStorage.
 * Returns parsed config or null on failure.
 */
async function fetchAccordConfig(filesUrl: string): Promise<AccordConfig | null> {
	try {
		const token = getToken();
		const headers: Record<string, string> = {};
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		// Send cached ETag for conditional request
		const cached = getCachedConfig();
		if (cached) {
			headers['If-None-Match'] = cached.etag;
		}

		const res = await fetch(`${filesUrl}/.well-known/accord.json`, { headers });

		// 304 Not Modified — use cached config
		if (res.status === 304 && cached) {
			return cached.config;
		}

		if (!res.ok) return null;

		const config = (await res.json()) as AccordConfig;

		// Store ETag and config in cache for future conditional requests
		const etag = res.headers.get('ETag');
		if (etag) {
			setCachedConfig(config, etag);
		}

		return config;
	} catch {
		return null;
	}
}

/**
 * Apply accord.json configuration: server state, theme, emoji, categories.
 * Returns the categories array and first text channel name.
 */
function applyConfig(
	conn: IRCConnection,
	config: AccordConfig | null,
	serverUrl: string,
	filesUrl: string | null,
	callbacks: LifecycleCallbacks,
): { firstChannel: string | undefined } {
	// Store config for ServerSettings modal
	if (config) {
		setServerConfig(config);
	}

	// Register server in state
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

	// Load custom emoji from accord.json
	if (config?.emoji && typeof config.emoji === 'object') {
		const resolved: Record<string, string> = {};
		for (const [name, url] of Object.entries(config.emoji)) {
			if (typeof url !== 'string') continue;
			if (url.startsWith('http://') || url.startsWith('https://')) {
				resolved[name] = url;
			} else if (url.startsWith('/') && filesUrl) {
				// Relative path — resolve against files server
				resolved[name] = `${filesUrl}${url}`;
			}
			// Skip non-http(s) URLs (javascript:, data:, etc.) and relative
			// paths when no filesUrl is configured
		}
		setCustomEmoji(resolved);
	}

	// Populate categories from accord.json
	type Category = { name: string; channels: string[]; voice?: boolean; readonly?: boolean };
	const categories: Category[] = config?.channels?.categories ?? [
		{ name: 'Channels', channels: ['#general'] },
	];
	setCategories(categories);

	// Auto-join all channels from categories
	const allChannels = categories.flatMap((cat) => cat.channels);
	if (allChannels.length > 0) {
		join(conn, allChannels);
	}

	// Fetch initial message history for all text channels
	const textChannels = categories
		.filter((cat) => !cat.voice)
		.flatMap((cat) => cat.channels);
	for (const channel of textChannels) {
		chathistory(conn, 'LATEST', channel, '*', '50');
	}

	// First text channel
	const firstTextCategory = categories.find((cat) => !cat.voice);
	const firstChannel = firstTextCategory?.channels[0] ?? allChannels[0];

	// Show welcome modal on first join (once per server)
	if (config?.welcome?.message) {
		const dismissKey = `accord:welcome-dismissed:${serverUrl}`;
		if (!localStorage.getItem(dismissKey)) {
			callbacks.onWelcome({
				serverName: config.name ?? 'IRC Server',
				message: config.welcome.message,
				suggestedChannels: config.welcome.suggested_channels ?? [],
			});
		}
	}

	return { firstChannel };
}

// ---- Main entry points -----------------------------------------------------

/**
 * Connect to IRC, authenticate, fetch accord.json, populate state,
 * and auto-join channels.
 */
export async function initConnection(callbacks: LifecycleCallbacks): Promise<void> {
	const creds = await getCredentials();
	if (!creds) {
		callbacks.onError('No saved credentials. Please log in.');
		callbacks.onInitDone();
		return;
	}

	// Rehydrate user state from localStorage
	rehydrate();

	// Determine server URLs from localStorage (set during login)
	const serverUrl = localStorage.getItem('accord:serverUrl')
		?? (import.meta.env.DEV ? `ws://${window.location.hostname}:8097` : null);
	if (!serverUrl) {
		callbacks.onError('No server URL configured. Please log in again.');
		callbacks.onInitDone();
		return;
	}
	const filesUrl = localStorage.getItem('accord:filesUrl') ?? null;

	try {
		// 1. Create and connect
		const conn = new IRCConnection({ url: serverUrl });
		callbacks.onConnection(conn);
		setConnecting();
		await conn.connect();
		setConnected();

		// 2. Register message handler (before sending any commands)
		registerHandler(conn);

		// 3. CAP negotiation + NICK/USER
		const capPromise = negotiateCaps(conn);
		conn.send(`NICK ${creds.account}`);
		conn.send(`USER ${creds.account} 0 * :${creds.account}`);
		await capPromise;

		// 4. SASL authentication
		await authenticateSASL(conn, creds.account, creds.password);

		// 4b. Fetch initial JWT and start refresh loop
		if (filesUrl) {
			try {
				await fetchToken(filesUrl, creds.account, creds.password);
				startTokenRefresh(filesUrl, () => {
					callbacks.onAuthExpired();
				});
			} catch {
				// JWT fetch failure at startup is not fatal
			}
		}

		// 5. Fetch and apply accord.json
		const config = filesUrl ? await fetchAccordConfig(filesUrl) : null;
		const { firstChannel } = applyConfig(conn, config, serverUrl, filesUrl, callbacks);

		// 5a. Fetch all user profiles (non-blocking)
		if (filesUrl) {
			fetchAllProfiles().catch(() => {});
		}

		// 5b. Restore persisted DM conversations and MONITOR their nicks
		restoreDMConversations();
		const dmNicks = channelUIState.dmConversations.map((dm) => dm.nick);
		if (dmNicks.length > 0) {
			monitor(conn, '+', dmNicks);
			callbacks.addMonitoredNicks(dmNicks);
		}

		// 6. Set first text channel as active
		if (firstChannel) {
			setActiveChannel(firstChannel);
		}

		// 7. Register reconnect event handlers
		conn.on('reconnecting', (attempt: number) => {
			setReconnecting(attempt);
		});

		conn.on('reconnected', () => {
			handleReconnect(conn, filesUrl, callbacks);
		});

		callbacks.onInitDone();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		callbacks.onError(msg);
		setDisconnected(msg);
		callbacks.onInitDone();
	}
}

/** Guard against overlapping reconnect attempts. */
let _reconnecting = false;

/**
 * Handle a successful WebSocket reconnect.
 * Re-authenticates, rejoins channels, fills message gaps, and refreshes JWT.
 */
async function handleReconnect(
	conn: IRCConnection,
	filesUrl: string | null,
	callbacks: LifecycleCallbacks,
): Promise<void> {
	if (_reconnecting) return;
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

		// 4. Refresh accord-files JWT
		if (filesUrl) {
			try {
				await fetchToken(filesUrl, creds.account, creds.password);
				startTokenRefresh(filesUrl, () => {
					callbacks.onAuthExpired();
				});
			} catch {
				// Non-fatal
			}
		}

		// 4a. Refresh profiles on reconnect (non-blocking)
		if (filesUrl) {
			fetchAllProfiles().catch(() => {});
		}

		// 5. Re-join all previously joined channels (suppress self-JOIN system messages)
		const joinedChannels = Array.from(channelState.channels.keys()).filter(
			(ch) => ch.startsWith('#') || ch.startsWith('&')
		);

		// Clear stale member lists before re-joining
		for (const ch of joinedChannels) {
			callbacks.clearChannelMembers(ch);
		}

		setSuppressSelfJoins(joinedChannels.length);
		if (joinedChannels.length > 0) {
			join(conn, joinedChannels);
		}

		// 6. Fill message gaps or load initial history for each channel
		for (const channel of joinedChannels) {
			const cursors = getCursors(channel);
			if (cursors.newestMsgid) {
				chathistory(conn, 'AFTER', channel, `msgid=${cursors.newestMsgid}`, '50');
			} else {
				chathistory(conn, 'LATEST', channel, '*', '50');
			}
		}

		// 7. Re-establish MONITOR for presence tracking
		callbacks.clearMonitoredNicks();
		const dmNicks = channelUIState.dmConversations.map((dm) => dm.nick);
		if (dmNicks.length > 0) {
			monitor(conn, '+', dmNicks);
			callbacks.addMonitoredNicks(dmNicks);
		}
		const activeChannel = channelUIState.activeChannel;
		if (activeChannel && !isDMTarget(activeChannel)) {
			callbacks.updateMonitorForChannel(activeChannel);
		}

		// 8. Refresh voice connection if was in a voice channel
		await callbacks.handleVoiceReconnect();

		// 9. Mark connected and clear any previous error
		setConnected();
		callbacks.onError(null);
	} catch (e) {
		console.error('Reconnect recovery failed:', e);
	} finally {
		_reconnecting = false;
	}
}

/** Re-export AccordConfig so the component can import it from here if needed. */
export type { AccordConfig };
