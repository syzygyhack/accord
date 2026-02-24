/**
 * Keyboard shortcut registration for the chat page.
 *
 * Extracted from +page.svelte — registers all keyboard shortcuts and
 * push-to-talk handlers. The component passes callbacks so this module
 * never touches reactive (Svelte) state directly.
 */

import { tick } from 'svelte';
import type { Room } from 'livekit-client';
import { installGlobalHandler, registerKeybindings } from '$lib/keybindings';
import { navigateChannel, navigateUnreadChannel, navigateServer } from '$lib/navigation/channelNav';
import { toggleMute as toggleMuteRoom, toggleDeafen as toggleDeafenRoom, toggleVideo as toggleVideoRoom, toggleScreenShare as toggleScreenShareRoom } from '$lib/voice/room';
import { voiceState, updateParticipant } from '$lib/state/voice.svelte';
import { audioSettings } from '$lib/state/audioSettings.svelte';

// ---- Types ----------------------------------------------------------------

/** Callbacks the component provides for shortcut handlers. */
export interface ShortcutCallbacks {
	// --- Toggles (return current value after toggle) ---

	toggleQuickSwitcher(): void;
	toggleSettings(): void;
	toggleSearch(): void;
	openSearch(): void;
	focusSearchInput(): void;

	// --- Escape chain (each returns true if it handled the escape) ---
	dismissWelcome(): boolean;
	closeProfilePopout(): boolean;
	closeVoiceOverlay(): boolean;
	closeSettings(): boolean;
	closeServerSettings(): boolean;
	closeAdminPanel(): boolean;
	closeQuickSwitcher(): boolean;
	closeSearch(): boolean;
	closeThread(): boolean;
	closeDeleteTarget(): boolean;
	closeEmojiPicker(): boolean;
	cancelReply(): boolean;
	closeSidebarOverlay(): boolean;
	closeMembersOverlay(): boolean;

	// --- Actions ---
	markActiveChannelRead(): void;
	scrollMessageList(action: 'pageup' | 'pagedown' | 'home' | 'end'): void;
	openInputEmojiPicker(): void;

	// --- Voice room accessor ---
	getVoiceRoom(): Room | null;
}

/** Return value from setupShortcuts — call cleanup to tear everything down. */
export interface ShortcutHandle {
	cleanup(): void;
}

// ---- Shortcut registration ------------------------------------------------

/**
 * Register all chat keyboard shortcuts and push-to-talk handlers.
 * Returns a handle whose `cleanup()` removes all listeners.
 */
export function setupShortcuts(callbacks: ShortcutCallbacks): ShortcutHandle {
	// Keybinding system (Ctrl+K, Escape, etc.)
	const cleanupGlobalHandler = installGlobalHandler();

	const cleanupKeybindings = registerKeybindings([
		// Ctrl+K — Quick switcher
		{
			key: 'k',
			ctrl: true,
			handler: () => {
				callbacks.toggleQuickSwitcher();
				return true;
			},
			description: 'Open quick channel switcher',
		},
		// Ctrl+, — User settings
		{
			key: ',',
			ctrl: true,
			handler: () => {
				callbacks.toggleSettings();
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
				callbacks.openSearch();
				// Focus the search input after panel renders
				tick().then(() => callbacks.focusSearchInput());
				return true;
			},
			description: 'Search messages',
		},
		// Escape — Close modals, cancel reply, close emoji picker
		{
			key: 'Escape',
			handler: () => {
				if (callbacks.dismissWelcome()) return true;
				if (callbacks.closeProfilePopout()) return true;
				if (callbacks.closeVoiceOverlay()) return true;
				if (callbacks.closeSettings()) return true;
				if (callbacks.closeServerSettings()) return true;
				if (callbacks.closeAdminPanel()) return true;
				if (callbacks.closeQuickSwitcher()) return true;
				if (callbacks.closeSearch()) return true;
				if (callbacks.closeThread()) return true;
				if (callbacks.closeDeleteTarget()) return true;
				if (callbacks.closeEmojiPicker()) return true;
				if (callbacks.cancelReply()) return true;
				if (callbacks.closeSidebarOverlay()) return true;
				if (callbacks.closeMembersOverlay()) return true;
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
				const room = callbacks.getVoiceRoom();
				if (voiceState.isConnected && room) {
					toggleMuteRoom(room);
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
				const room = callbacks.getVoiceRoom();
				if (voiceState.isConnected && room) {
					toggleDeafenRoom(room);
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
				const room = callbacks.getVoiceRoom();
				if (voiceState.isConnected && room) {
					toggleVideoRoom(room);
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
				const room = callbacks.getVoiceRoom();
				if (voiceState.isConnected && room) {
					toggleScreenShareRoom(room);
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
				callbacks.openInputEmojiPicker();
				return true;
			},
			description: 'Toggle emoji picker',
		},
		// Shift+Escape — Mark channel as read
		{
			key: 'Escape',
			shift: true,
			handler: () => {
				callbacks.markActiveChannelRead();
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
				callbacks.scrollMessageList('pageup');
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
				callbacks.scrollMessageList('pagedown');
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
				callbacks.scrollMessageList('home');
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
				callbacks.scrollMessageList('end');
				return true;
			},
			description: 'Jump to newest message',
		},
	]);

	// --- Push-to-talk ---

	let pttActive = false;

	function handlePTTKeyDown(e: KeyboardEvent): void {
		const room = callbacks.getVoiceRoom();
		if (!audioSettings.pushToTalk || !voiceState.isConnected || !room) return;
		if (e.code !== audioSettings.pttKey) return;
		if (pttActive) return; // Key repeat
		// Don't capture when typing in inputs
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		e.preventDefault();
		pttActive = true;
		room.localParticipant.setMicrophoneEnabled(true);
		voiceState.localMuted = false;
		updateParticipant(room.localParticipant.identity, { isMuted: false });
	}

	function handlePTTKeyUp(e: KeyboardEvent): void {
		const room = callbacks.getVoiceRoom();
		if (!audioSettings.pushToTalk || !room) return;
		if (e.code !== audioSettings.pttKey) return;
		if (!pttActive) return;
		releasePTT();
	}

	/** Release PTT — shared by keyup and window blur. */
	function releasePTT(): void {
		const room = callbacks.getVoiceRoom();
		if (!pttActive || !room) return;
		pttActive = false;
		room.localParticipant.setMicrophoneEnabled(false);
		voiceState.localMuted = true;
		updateParticipant(room.localParticipant.identity, { isMuted: true });
	}

	/** Release PTT when window loses focus (keyup won't fire). */
	function handleWindowBlur(): void {
		if (pttActive) releasePTT();
	}

	// Register DOM listeners
	document.addEventListener('keydown', handlePTTKeyDown);
	document.addEventListener('keyup', handlePTTKeyUp);
	window.addEventListener('blur', handleWindowBlur);

	return {
		cleanup() {
			cleanupKeybindings();
			cleanupGlobalHandler();
			document.removeEventListener('keydown', handlePTTKeyDown);
			document.removeEventListener('keyup', handlePTTKeyUp);
			window.removeEventListener('blur', handleWindowBlur);
		},
	};
}
