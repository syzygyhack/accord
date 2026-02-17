<script lang="ts">
	import { markdownToIRC } from '$lib/irc/format';
	import type { IRCConnection } from '$lib/irc/connection';
	import { join, privmsg, tagmsg, part, topic, escapeTagValue } from '$lib/irc/commands';
	import { formatMessage } from '$lib/irc/parser';
	import SlashCommandMenu from './SlashCommandMenu.svelte';
	import { filterCommands, type CommandDef } from './SlashCommandMenu.svelte';
	import AutocompleteMenu from './AutocompleteMenu.svelte';
	import type { CompletionItem } from './AutocompleteMenu.svelte';
	import { getMember, getMembers } from '$lib/state/members.svelte';
	import { channelUIState } from '$lib/state/channels.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { addMessage, generateLocalMsgid, updateSendState } from '$lib/state/messages.svelte';
	import { uploadFile } from '$lib/files/upload';
	import { getToken } from '$lib/api/auth';
	import { searchEmoji, searchCustomEmoji } from '$lib/emoji';

	interface ReplyContext {
		msgid: string;
		nick: string;
		text: string;
	}

	import { onMount, onDestroy } from 'svelte';

	interface Props {
		target: string;
		connection: IRCConnection | null;
		reply?: ReplyContext | null;
		oncancelreply?: () => void;
		oneditlast?: () => void;
		editing?: boolean;
		editMsgid?: string | null;
		oneditcomplete?: () => void;
		oneditcancel?: () => void;
		disconnected?: boolean;
		rateLimitSeconds?: number;
		filesUrl?: string | null;
		onemojipicker?: () => void;
	}

	let { target, connection, reply = null, oncancelreply, oneditlast, editing = false, editMsgid = null, oneditcomplete, oneditcancel, disconnected = false, rateLimitSeconds = 0, filesUrl = null, onemojipicker }: Props = $props();

	let text = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	let inputDisabled = $derived(disconnected || rateLimitSeconds > 0);

	// --- Staged file attachments ---

	interface StagedFile {
		file: File;
		preview?: string;
	}

	let stagedFiles: StagedFile[] = $state([]);
	let uploading = $state(false);
	let uploadError: string | null = $state(null);
	let fileInput: HTMLInputElement | undefined = $state();
	let dragOver = $state(false);

	/** Format bytes into a human-readable size string. */
	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const MAX_CLIENT_FILE_SIZE = 25 * 1024 * 1024; // 25 MB — matches server default

	/** Stage files for upload, generating image previews where applicable. */
	function stageFiles(files: FileList | File[]): void {
		uploadError = null;
		for (const file of files) {
			if (file.size > MAX_CLIENT_FILE_SIZE) {
				uploadError = `File "${file.name}" is too large (${formatSize(file.size)} > ${formatSize(MAX_CLIENT_FILE_SIZE)})`;
				return;
			}
			const staged: StagedFile = { file };
			if (file.type.startsWith('image/')) {
				staged.preview = URL.createObjectURL(file);
			}
			stagedFiles = [...stagedFiles, staged];
		}
	}

	/** Remove a staged file by index. */
	function removeStagedFile(index: number): void {
		const removed = stagedFiles[index];
		if (removed?.preview) {
			URL.revokeObjectURL(removed.preview);
		}
		stagedFiles = stagedFiles.filter((_, i) => i !== index);
	}

	/** Clear all staged files. */
	function clearStagedFiles(): void {
		for (const sf of stagedFiles) {
			if (sf.preview) URL.revokeObjectURL(sf.preview);
		}
		stagedFiles = [];
	}

	/** Handle the [+] button click. */
	function openFilePicker(): void {
		fileInput?.click();
	}

	/** Handle file input change. */
	function handleFileInputChange(event: Event): void {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			stageFiles(input.files);
		}
		// Reset the input so the same file can be selected again
		input.value = '';
	}

	// --- Drag and drop ---

	function handleDragEnter(event: DragEvent): void {
		event.preventDefault();
		dragOver = true;
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		dragOver = true;
	}

	function handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		// Only clear dragOver if we're leaving the container (not entering a child)
		const related = event.relatedTarget as Node | null;
		const container = event.currentTarget as HTMLElement;
		if (!related || !container.contains(related)) {
			dragOver = false;
		}
	}

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		dragOver = false;
		if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
			stageFiles(event.dataTransfer.files);
		}
	}

	// --- Paste handler for images ---

	function handlePaste(event: ClipboardEvent): void {
		if (!event.clipboardData) return;

		const items = event.clipboardData.items;
		const imageFiles: File[] = [];
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) imageFiles.push(file);
			}
		}

		if (imageFiles.length > 0) {
			event.preventDefault();
			stageFiles(imageFiles);
		}
	}

	// --- Slash command menu state ---

	let slashFilter = $derived.by(() => {
		const match = text.match(/^\/(\S*)$/);
		return match ? match[1] : null;
	});

	let myHighestMode = $derived(
		target.startsWith('#') && userState.nick
			? getMember(target, userState.nick)?.highestMode ?? null
			: null
	);
	let filteredCommands = $derived(slashFilter !== null ? filterCommands(slashFilter, myHighestMode) : []);
	let showSlashMenu = $derived(slashFilter !== null && filteredCommands.length > 0);
	let slashSelectedIndex = $state(0);

	// Reset selection when filter changes
	$effect(() => {
		void slashFilter;
		slashSelectedIndex = 0;
	});

	function handleSlashSelect(cmd: CommandDef): void {
		text = `/${cmd.name} `;
		requestAnimationFrame(() => {
			textarea?.focus();
			if (textarea) {
				textarea.selectionStart = textarea.selectionEnd = text.length;
			}
		});
	}

	function handleSlashMenuKeydown(event: KeyboardEvent): boolean {
		if (!showSlashMenu || filteredCommands.length === 0) return false;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			slashSelectedIndex = (slashSelectedIndex + 1) % filteredCommands.length;
			return true;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			slashSelectedIndex = (slashSelectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
			return true;
		}
		if (event.key === 'Tab' || event.key === 'Enter') {
			event.preventDefault();
			handleSlashSelect(filteredCommands[slashSelectedIndex]);
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			// Add space to break the menu match
			text = text + ' ';
			return true;
		}
		return false;
	}

	// --- Tab completion (@user, #channel, :emoji:) ---

	const MAX_COMPLETIONS = 10;

	/** Extract the trigger word at the cursor position. Returns trigger type and query. */
	function getCompletionContext(): { type: '@' | '#' | ':'; query: string; start: number } | null {
		if (!textarea) return null;
		const cursor = textarea.selectionStart;
		const before = text.slice(0, cursor);
		// Match @query, #query, or :query at the end (possibly after a space or start of line)
		const match = before.match(/(?:^|\s)(@|#|:)(\S*)$/);
		if (!match) return null;
		const trigger = match[1] as '@' | '#' | ':';
		const query = match[2];
		const start = cursor - query.length - 1; // position of the trigger char
		return { type: trigger, query, start };
	}

	let acContext = $derived.by(() => getCompletionContext());

	let acItems = $derived.by((): CompletionItem[] => {
		if (!acContext || showSlashMenu) return [];
		const { type, query } = acContext;
		const q = query.toLowerCase();

		if (type === '@') {
			const members = target.startsWith('#') ? getMembers(target) : [];
			return members
				.filter((m) => m.nick.toLowerCase().startsWith(q))
				.slice(0, MAX_COMPLETIONS)
				.map((m) => ({ label: `@${m.nick}`, value: `@${m.nick} `, detail: m.account || undefined }));
		}

		if (type === '#') {
			const allChannels = channelUIState.categories
				.filter((c) => !c.voice)
				.flatMap((c) => c.channels);
			return allChannels
				.filter((ch) => ch.toLowerCase().startsWith(`#${q}`))
				.slice(0, MAX_COMPLETIONS)
				.map((ch) => ({ label: ch, value: `${ch} ` }));
		}

		if (type === ':' && q.length >= 2) {
			const custom = searchCustomEmoji(q).slice(0, 5)
				.map((e) => ({ label: `:${e.name}:`, value: `:${e.name}: `, detail: 'custom' }));
			const unicode = searchEmoji(q).slice(0, MAX_COMPLETIONS - custom.length)
				.map((e) => ({ label: `${e.emoji} ${e.name}`, value: `${e.emoji} ` }));
			return [...custom, ...unicode];
		}

		return [];
	});

	let showAutocomplete = $derived(acItems.length > 0);
	let acSelectedIndex = $state(0);

	// Reset selection when completion list changes
	$effect(() => {
		void acItems;
		acSelectedIndex = 0;
	});

	function handleAcSelect(item: CompletionItem): void {
		if (!acContext || !textarea) return;
		const before = text.slice(0, acContext.start);
		const after = text.slice(textarea.selectionStart);
		text = before + item.value + after;
		requestAnimationFrame(() => {
			textarea?.focus();
			if (textarea) {
				const pos = before.length + item.value.length;
				textarea.selectionStart = textarea.selectionEnd = pos;
			}
		});
	}

	function handleAcKeydown(event: KeyboardEvent): boolean {
		if (!showAutocomplete || acItems.length === 0) return false;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			acSelectedIndex = (acSelectedIndex + 1) % acItems.length;
			return true;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			acSelectedIndex = (acSelectedIndex - 1 + acItems.length) % acItems.length;
			return true;
		}
		if (event.key === 'Tab' || event.key === 'Enter') {
			event.preventDefault();
			handleAcSelect(acItems[acSelectedIndex]);
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			text = text + ' ';
			return true;
		}
		return false;
	}

	// Listen for programmatic edit-message events (from keyboard shortcut: Up arrow)
	function handleEditMessage(e: Event): void {
		const detail = (e as CustomEvent<{ text: string }>).detail;
		if (detail?.text) {
			text = detail.text;
			requestAnimationFrame(() => {
				adjustHeight();
				textarea?.focus();
				// Place cursor at end
				if (textarea) {
					textarea.selectionStart = textarea.selectionEnd = text.length;
				}
			});
		}
	}

	// Listen for mention insertion events (from MemberList context menu)
	function handleInsertMention(e: Event): void {
		const detail = (e as CustomEvent<{ nick: string }>).detail;
		if (detail?.nick) {
			const mention = `@${detail.nick} `;
			text += mention;
			requestAnimationFrame(() => {
				adjustHeight();
				textarea?.focus();
				if (textarea) {
					textarea.selectionStart = textarea.selectionEnd = text.length;
				}
			});
		}
	}

	// Listen for emoji insertion from the emoji picker
	function handleInsertEmoji(e: Event): void {
		const detail = (e as CustomEvent<{ emoji: string }>).detail;
		if (detail?.emoji) {
			text += detail.emoji;
			requestAnimationFrame(() => {
				adjustHeight();
				textarea?.focus();
				if (textarea) {
					textarea.selectionStart = textarea.selectionEnd = text.length;
				}
			});
		}
	}

	onMount(() => {
		window.addEventListener('accord:edit-message', handleEditMessage);
		window.addEventListener('accord:insert-mention', handleInsertMention);
		window.addEventListener('accord:insert-emoji', handleInsertEmoji);
	});

	onDestroy(() => {
		window.removeEventListener('accord:edit-message', handleEditMessage);
		window.removeEventListener('accord:insert-mention', handleInsertMention);
		window.removeEventListener('accord:insert-emoji', handleInsertEmoji);
		clearTypingTimer();
		// Clean up object URLs for staged file previews
		for (const sf of stagedFiles) {
			if (sf.preview) URL.revokeObjectURL(sf.preview);
		}
	});

	let statusMessage = $derived.by(() => {
		if (disconnected) return "You're offline. Reconnecting...";
		if (rateLimitSeconds > 0) return `Slow down! You can send another message in ${rateLimitSeconds}s.`;
		return null;
	});

	// --- Auto-growing textarea ---

	function adjustHeight(): void {
		if (!textarea) return;
		textarea.style.height = 'auto';
		const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22;
		const maxHeight = lineHeight * 10;
		textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
	}

	// --- Typing indicator throttle ---

	let lastTypingSent = 0;
	let typingDoneTimer: ReturnType<typeof setTimeout> | null = null;
	const TYPING_THROTTLE_MS = 3_000;
	const TYPING_DONE_DELAY_MS = 5_000;

	function sendTypingActive(): void {
		if (!connection) return;
		const now = Date.now();
		if (now - lastTypingSent >= TYPING_THROTTLE_MS) {
			tagmsg(connection, target, { '+typing': 'active' });
			lastTypingSent = now;
		}

		// Reset the done timer
		if (typingDoneTimer !== null) {
			clearTimeout(typingDoneTimer);
		}
		typingDoneTimer = setTimeout(() => {
			if (connection) {
				tagmsg(connection, target, { '+typing': 'done' });
			}
			typingDoneTimer = null;
		}, TYPING_DONE_DELAY_MS);
	}

	function clearTypingTimer(): void {
		if (typingDoneTimer !== null) {
			clearTimeout(typingDoneTimer);
			typingDoneTimer = null;
		}
	}

	// --- Slash command handling ---

	function handleSlashCommand(input: string): boolean {
		if (!connection) return false;
		const match = input.match(/^\/(\S+)\s*(.*)/);
		if (!match) return false;

		const [, cmd, args] = match;
		const command = cmd.toLowerCase();

		switch (command) {
			case 'join': {
				const channel = args.trim();
				if (channel) {
					join(connection, [channel]);
				}
				return true;
			}
			case 'me':
				// ACTION: send as CTCP ACTION
				connection.send(formatMessage('PRIVMSG', target, `\x01ACTION ${args}\x01`));
				return true;
			case 'msg': {
				const msgMatch = args.match(/^(\S+)\s+(.*)/);
				if (msgMatch) {
					privmsg(connection, msgMatch[1], msgMatch[2]);
				}
				return true;
			}
			case 'nick':
				if (args.trim()) {
					connection.send(formatMessage('NICK', args.trim()));
				}
				return true;
			case 'part': {
				const partArgs = args.trim();
				let partTarget: string;
				let reason: string | undefined;
				if (!partArgs) {
					// /part — leave current channel
					partTarget = target;
				} else if (partArgs.startsWith('#') || partArgs.startsWith('&')) {
					// /part #channel [reason] — leave specified channel
					const spaceIdx = partArgs.indexOf(' ');
					if (spaceIdx === -1) {
						partTarget = partArgs;
					} else {
						partTarget = partArgs.slice(0, spaceIdx);
						reason = partArgs.slice(spaceIdx + 1).trim() || undefined;
					}
				} else {
					// /part reason — leave current channel with reason
					partTarget = target;
					reason = partArgs;
				}
				part(connection, partTarget, reason);
				return true;
			}
			case 'topic':
				if (args.trim()) {
					topic(connection, target, args.trim());
				} else {
					topic(connection, target);
				}
				return true;
			case 'invite': {
				const inviteParts = args.trim().split(/\s+/);
				const inviteUser = inviteParts[0];
				const inviteChannel = inviteParts[1] || target;
				if (inviteUser) {
					connection.send(formatMessage('INVITE', inviteUser, inviteChannel));
				}
				return true;
			}
			case 'whois': {
				const whoisUser = args.trim();
				if (whoisUser) {
					connection.send(formatMessage('WHOIS', whoisUser));
				}
				return true;
			}
			case 'mute': {
				// Mute = set +q (quiet) on the user's hostmask
				const muteUser = args.trim();
				if (muteUser) {
					connection.send(formatMessage('MODE', target, '+q', `${muteUser}!*@*`));
				}
				return true;
			}
			case 'kick': {
				const kickMatch = args.match(/^(\S+)\s*(.*)/);
				if (kickMatch) {
					const reason = kickMatch[2] || undefined;
					if (reason) {
						connection.send(formatMessage('KICK', target, kickMatch[1], reason));
					} else {
						connection.send(formatMessage('KICK', target, kickMatch[1]));
					}
				}
				return true;
			}
			case 'ban': {
				const banUser = args.trim();
				if (banUser) {
					connection.send(formatMessage('MODE', target, '+b', `${banUser}!*@*`));
				}
				return true;
			}
			case 'unban': {
				const unbanUser = args.trim();
				if (unbanUser) {
					connection.send(formatMessage('MODE', target, '-b', `${unbanUser}!*@*`));
				}
				return true;
			}
			case 'mode':
				if (args.trim()) {
					const modeArgs = args.trim().split(/\s+/);
					connection.send(formatMessage('MODE', target, ...modeArgs));
				}
				return true;
			default:
				return false;
		}
	}

	// --- Formatting shortcuts ---

	function wrapSelection(wrapper: string): void {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;

		if (start === end) return; // No selection

		const before = text.slice(0, start);
		const selected = text.slice(start, end);
		const after = text.slice(end);

		text = before + wrapper + selected + wrapper + after;

		// Restore cursor after the wrapped text
		requestAnimationFrame(() => {
			if (!textarea) return;
			textarea.setSelectionRange(start + wrapper.length, end + wrapper.length);
			textarea.focus();
		});
	}

	// --- Send message ---

	async function send(): Promise<void> {
		const trimmed = text.trim();
		const hasFiles = stagedFiles.length > 0;

		if ((!trimmed && !hasFiles) || !connection || inputDisabled) return;

		// Check for slash commands (// escapes to send a literal /message)
		if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !hasFiles) {
			if (handleSlashCommand(trimmed)) {
				text = '';
				cancelReply();
				clearTypingTimer();
				requestAnimationFrame(adjustHeight);
				return;
			}
		}

		// Upload staged files first
		let fileUrls: string[] = [];
		if (hasFiles) {
			const token = getToken();
			if (!token || !filesUrl) {
				uploadError = 'Not authenticated for file uploads';
				return;
			}

			uploading = true;
			uploadError = null;

			try {
				for (const staged of stagedFiles) {
					const result = await uploadFile(staged.file, token, filesUrl);
					// Build full URL from the server's relative path and the discovered filesUrl.
					// filesUrl is derived from the WS connection URL (or virc.json override),
					// so it already points to the correct public server address.
					const fullUrl = `${filesUrl.replace(/\/+$/, '')}${result.url}`;
					fileUrls.push(fullUrl);
				}
			} catch (e) {
				uploading = false;
				uploadError = e instanceof Error ? e.message : 'Upload failed';
				return;
			}

			uploading = false;
			clearStagedFiles();
		}

		// Build the final message text (message text + file URLs)
		let rawMessage = trimmed;
		if (trimmed.startsWith('//')) {
			rawMessage = trimmed.slice(1);
		}

		if (fileUrls.length > 0) {
			const urlSuffix = fileUrls.join(' ');
			rawMessage = rawMessage ? `${rawMessage} ${urlSuffix}` : urlSuffix;
		}

		if (!rawMessage) return;

		// Convert markdown to mIRC codes
		const ircText = markdownToIRC(rawMessage);

		if (editing && editMsgid) {
			oneditcomplete?.();
			privmsg(connection, target, ircText, editMsgid);
		} else {
			// Add optimistic message immediately so it appears without waiting for server echo
			const localMsgid = generateLocalMsgid();
			addMessage(target, {
				msgid: localMsgid,
				nick: userState.nick ?? '',
				account: userState.account ?? '',
				target,
				text: ircText,
				time: new Date(),
				tags: {},
				replyTo: reply?.msgid,
				reactions: new Map(),
				isRedacted: false,
				type: 'privmsg',
				sendState: 'sending',
			});

			let sent: boolean;
			if (reply) {
				const tags = `@+draft/reply=${escapeTagValue(reply.msgid)}`;
				sent = connection.send(`${tags} PRIVMSG ${target} :${ircText}`);
			} else {
				sent = privmsg(connection, target, ircText);
			}

			if (!sent) {
				updateSendState(target, localMsgid, 'failed');
			}
		}

		text = '';
		cancelReply();
		clearTypingTimer();

		// Send typing=done since we just sent a message
		if (connection) {
			tagmsg(connection, target, { '+typing': 'done' });
		}

		requestAnimationFrame(adjustHeight);
	}

	function cancelReply(): void {
		oncancelreply?.();
	}

	// --- Key handling ---

	function handleKeydown(event: KeyboardEvent): void {
		// Let slash command menu handle navigation keys when open
		if (handleSlashMenuKeydown(event)) return;
		// Let autocomplete menu handle navigation keys when open
		if (handleAcKeydown(event)) return;

		// Formatting shortcuts
		if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
			if (event.key === 'b') {
				event.preventDefault();
				wrapSelection('**');
				return;
			}
			if (event.key === 'i') {
				event.preventDefault();
				wrapSelection('*');
				return;
			}
		}

		if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'C') {
			// Ctrl+Shift+C for code (uppercase C because shift is held)
			event.preventDefault();
			wrapSelection('`');
			return;
		}

		// Up arrow in empty input — edit last message
		if (event.key === 'ArrowUp' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
			if (text.trim() === '') {
				event.preventDefault();
				oneditlast?.();
				return;
			}
		}

		// Escape cancels staged files, reply, or edit
		if (event.key === 'Escape') {
			if (stagedFiles.length > 0) {
				event.preventDefault();
				clearStagedFiles();
				uploadError = null;
				return;
			}
			if (editing) {
				event.preventDefault();
				text = '';
				oneditcancel?.();
				requestAnimationFrame(adjustHeight);
				return;
			}
			if (reply) {
				event.preventDefault();
				cancelReply();
				return;
			}
		}

		// Enter sends, Shift+Enter inserts newline
		if (event.key === 'Enter' && !event.shiftKey) {
			// If slash menu is open, it already handled Enter above
			event.preventDefault();
			send();
			return;
		}
	}

	function handleInput(): void {
		requestAnimationFrame(adjustHeight);
		if (text.trim().length > 0) {
			sendTypingActive();
		}
	}

	// Focus the textarea when a reply context is set or channel changes
	$effect(() => {
		if (reply) {
			requestAnimationFrame(() => textarea?.focus());
		}
	});

	$effect(() => {
		void target; // re-run when target (channel) changes
		// Send typing=done to the previous channel if we were typing
		if (typingDoneTimer !== null && connection) {
			// The timer callback would send to the new target, so cancel it
			// and send done explicitly (the old target is already gone from
			// the closure, so we just cancel — the 6s server timeout handles it)
			clearTypingTimer();
		}
		lastTypingSent = 0;
		text = '';
		requestAnimationFrame(() => {
			adjustHeight();
			textarea?.focus();
		});
	});

	let placeholder = $derived(
		target.startsWith('#')
			? `Message ${target}`
			: `Message @${target}`
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="message-input-container"
	class:drag-over={dragOver}
	ondragenter={handleDragEnter}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>
	{#if statusMessage}
		<div class="input-status-bar" class:input-status-warning={rateLimitSeconds > 0} class:input-status-offline={disconnected} role="status" aria-live="polite">
			{statusMessage}
		</div>
	{/if}

	{#if reply}
		<div class="reply-bar">
			<span class="reply-label">
				Replying to <strong>{reply.nick}</strong>:
				<span class="reply-preview-text">
					{reply.text.slice(0, 100)}{reply.text.length > 100 ? '...' : ''}
				</span>
			</span>
			<button class="reply-cancel" title="Cancel reply" onclick={cancelReply}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
				</svg>
			</button>
		</div>
	{/if}

	{#if stagedFiles.length > 0}
		<div class="attachment-bar">
			{#each stagedFiles as staged, i}
				<div class="attachment-item" class:attachment-uploading={uploading}>
					{#if staged.preview}
						<img class="attachment-thumb" src={staged.preview} alt={staged.file.name} />
					{:else}
						<span class="attachment-icon">
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3z"/>
							</svg>
						</span>
					{/if}
					<span class="attachment-name">{staged.file.name}</span>
					<span class="attachment-size">({formatSize(staged.file.size)})</span>
					{#if uploading}
						<span class="attachment-status">uploading...</span>
					{/if}
					<button class="attachment-remove" title="Remove file" onclick={() => removeStagedFile(i)}>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
						</svg>
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if uploadError}
		<div class="upload-error" role="alert">{uploadError}</div>
	{/if}

	<div class="input-row" class:input-disabled={inputDisabled}>
		{#if showSlashMenu}
			<SlashCommandMenu
				commands={filteredCommands}
				selectedIndex={slashSelectedIndex}
				onselect={handleSlashSelect}
				onhover={(i) => slashSelectedIndex = i}
			/>
		{:else if showAutocomplete}
			<AutocompleteMenu
				items={acItems}
				selectedIndex={acSelectedIndex}
				onselect={handleAcSelect}
				onhover={(i) => acSelectedIndex = i}
			/>
		{/if}
		<button
			class="file-upload-btn"
			title="Attach file"
			onclick={openFilePicker}
			disabled={inputDisabled || !filesUrl}
			aria-label="Attach file"
		>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
				<path d="M10 4a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2h-4v4a1 1 0 1 1-2 0v-4H5a1 1 0 1 1 0-2h4V5a1 1 0 0 1 1-1z"/>
			</svg>
		</button>
		<textarea
			bind:this={textarea}
			bind:value={text}
			placeholder={inputDisabled ? '' : placeholder}
			rows="1"
			disabled={inputDisabled}
			onkeydown={handleKeydown}
			oninput={handleInput}
			onpaste={handlePaste}
		></textarea>
		<button
			class="emoji-btn"
			title="Emoji picker"
			onclick={() => onemojipicker?.()}
			disabled={inputDisabled}
			aria-label="Emoji picker"
		>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm0-1.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM7.5 8.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM6.75 11.25a.75.75 0 0 1 1.06.02A2.5 2.5 0 0 0 10 12.25a2.5 2.5 0 0 0 2.19-.98.75.75 0 1 1 1.12 1A4 4 0 0 1 10 13.75a4 4 0 0 1-3.27-1.44.75.75 0 0 1 .02-1.06z" clip-rule="evenodd"/>
			</svg>
		</button>
	</div>
	<input
		bind:this={fileInput}
		type="file"
		multiple
		class="file-input-hidden"
		onchange={handleFileInputChange}
		tabindex="-1"
	/>
</div>

<style>
	.message-input-container {
		padding: 0 16px 16px;
		flex-shrink: 0;
	}

	.reply-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--surface-high);
		border-radius: 8px 8px 0 0;
		font-size: var(--font-sm);
		color: var(--text-secondary);
		gap: 8px;
	}

	.reply-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.reply-label strong {
		color: var(--text-primary);
	}

	.reply-preview-text {
		color: var(--text-muted);
	}

	.reply-cancel {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--interactive-normal);
		cursor: pointer;
		border-radius: 4px;
		flex-shrink: 0;
		transition: color var(--duration-message) ease, background var(--duration-message) ease;
	}

	.reply-cancel:hover {
		color: var(--interactive-hover);
		background: var(--surface-highest);
	}

	.input-row {
		display: flex;
		align-items: flex-end;
		background: var(--surface-high);
		border-radius: 8px;
		padding: 8px 12px;
		position: relative;
	}

	.reply-bar + .input-row,
	.reply-bar + .attachment-bar + .input-row {
		border-radius: 0 0 8px 8px;
		border-top: 1px solid var(--surface-highest);
	}

	textarea {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--font-base);
		line-height: 1.375;
		resize: none;
		overflow-y: auto;
		min-height: 22px;
		max-height: calc(22px * 10);
		padding: 0;
	}

	textarea:focus-visible {
		outline: 2px solid var(--accent-primary);
		outline-offset: -2px;
		border-radius: 2px;
	}

	textarea::placeholder {
		color: var(--text-muted);
	}

	textarea:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	/* Input status bar */
	.input-status-bar {
		padding: 6px 12px;
		font-size: var(--font-xs);
		font-weight: var(--weight-medium);
		border-radius: 8px 8px 0 0;
		text-align: center;
	}

	.input-status-offline {
		background: var(--danger-bg);
		color: var(--danger);
	}

	.input-status-warning {
		background: var(--warning-bg);
		color: var(--warning);
	}

	.input-status-bar + .reply-bar {
		border-radius: 0;
	}

	.input-status-bar + .input-row,
	.input-status-bar + .reply-bar + .input-row {
		border-radius: 0 0 8px 8px;
		border-top: 1px solid var(--surface-highest);
	}

	.input-disabled {
		opacity: 0.6;
	}

	/* File upload button */
	.file-upload-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--interactive-normal);
		cursor: pointer;
		border-radius: 4px;
		flex-shrink: 0;
		margin-right: 6px;
		transition: color 0.1s ease, background 0.1s ease;
	}

	.file-upload-btn:hover:not(:disabled) {
		color: var(--interactive-hover);
		background: var(--surface-highest);
	}

	.file-upload-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Emoji picker button */
	.emoji-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--interactive-normal);
		cursor: pointer;
		border-radius: 4px;
		flex-shrink: 0;
		margin-left: 6px;
		transition: color 0.1s ease, background 0.1s ease;
	}

	.emoji-btn:hover:not(:disabled) {
		color: var(--interactive-hover);
		background: var(--surface-highest);
	}

	.emoji-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Hidden file input */
	.file-input-hidden {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
	}

	/* Attachment preview bar */
	.attachment-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 12px;
		background: var(--surface-high);
		border-radius: 8px 8px 0 0;
		border-bottom: 1px solid var(--surface-highest);
	}

	.reply-bar + .attachment-bar {
		border-radius: 0;
	}

	.input-status-bar + .attachment-bar {
		border-radius: 0;
	}

	.attachment-bar + .input-row {
		border-radius: 0 0 8px 8px;
		border-top: none;
	}

	.attachment-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: var(--surface-base);
		border-radius: 4px;
		font-size: var(--font-sm);
		color: var(--text-secondary);
		max-width: 100%;
	}

	.attachment-uploading {
		opacity: 0.7;
	}

	.attachment-thumb {
		width: 24px;
		height: 24px;
		object-fit: cover;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.attachment-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.attachment-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		color: var(--text-primary);
	}

	.attachment-size {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.attachment-status {
		flex-shrink: 0;
		color: var(--accent-primary);
		font-style: italic;
	}

	.attachment-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--interactive-normal);
		cursor: pointer;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.attachment-remove:hover {
		color: var(--danger);
		background: var(--surface-highest);
	}

	/* Upload error */
	.upload-error {
		padding: 4px 12px;
		font-size: var(--font-xs);
		color: var(--danger);
		background: var(--danger-bg);
	}

	/* Drag-and-drop visual feedback */
	.drag-over {
		outline: 2px dashed var(--accent-primary);
		outline-offset: -2px;
		border-radius: 8px;
	}
</style>
