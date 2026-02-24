<script lang="ts">
	import { tick } from 'svelte';
	import { getThread, getMessage, type Message } from '$lib/state/messages.svelte';
	import { nickColor } from '$lib/irc/format';
	import { themeState } from '$lib/state/theme.svelte';
	import MessageComponent from './Message.svelte';

	interface Props {
		rootMsgId: string;
		target: string;
		onclose: () => void;
		onreply?: (msgid: string) => void;
		onreact?: (msgid: string, anchor?: { x: number; y: number }) => void;
		onmore?: (msgid: string, event: MouseEvent) => void;
		onpin?: (msgid: string) => void;
		onedit?: (msgid: string) => void;
		oncopytext?: (text: string) => void;
		oncopylink?: (msgid: string) => void;
		onmarkunread?: (msgid: string) => void;
		ontogglereaction?: (msgid: string, emoji: string) => void;
		onscrolltomessage?: (msgid: string) => void;
		onretry?: (msgid: string) => void;
		onnickclick?: (nick: string, account: string, event: MouseEvent) => void;
		onsendreply?: (rootMsgId: string, text: string) => void;
		isOp?: boolean;
	}

	let {
		rootMsgId,
		target,
		onclose,
		onreply,
		onreact,
		onmore,
		onpin,
		onedit,
		oncopytext,
		oncopylink,
		onmarkunread,
		ontogglereaction,
		onscrolltomessage,
		onretry,
		onnickclick,
		onsendreply,
		isOp = false,
	}: Props = $props();

	let replyText = $state('');
	let replyInput: HTMLTextAreaElement | undefined = $state(undefined);
	let scrollContainer: HTMLDivElement | undefined = $state(undefined);

	let rootMessage = $derived(getMessage(target, rootMsgId));
	let threadMessages = $derived(getThread(target, rootMsgId));

	/** Root message preview text (truncated). */
	let rootPreview = $derived.by(() => {
		if (!rootMessage) return 'Thread';
		const text = rootMessage.text;
		return text.length > 50 ? text.slice(0, 50) + '...' : text;
	});

	/** Auto-scroll to bottom when thread messages change. */
	$effect(() => {
		// Touch threadMessages to subscribe
		void threadMessages.length;
		tick().then(() => {
			if (scrollContainer) {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			}
		});
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	function handleReplyKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendReply();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	function sendReply() {
		const text = replyText.trim();
		if (!text) return;
		onsendreply?.(rootMsgId, text);
		replyText = '';
		tick().then(() => replyInput?.focus());
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="thread-panel" role="complementary" aria-label="Thread" onkeydown={handleKeydown}>
	<div class="thread-header">
		<div class="thread-header-text">
			<span class="thread-title">Thread</span>
			{#if rootMessage}
				<span class="thread-preview" style="color: {nickColor(rootMessage.account, themeState.current)}">
					{rootMessage.nick}:
				</span>
				<span class="thread-preview-text">{rootPreview}</span>
			{/if}
		</div>
		<button class="thread-close" title="Close thread" aria-label="Close thread" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
				<path d="M4.11 3.05a.75.75 0 0 0-1.06 1.06L6.94 8l-3.89 3.89a.75.75 0 1 0 1.06 1.06L8 9.06l3.89 3.89a.75.75 0 1 0 1.06-1.06L9.06 8l3.89-3.89a.75.75 0 0 0-1.06-1.06L8 6.94 4.11 3.05z" />
			</svg>
		</button>
	</div>

	<div class="thread-messages" bind:this={scrollContainer}>
		{#each threadMessages as msg, i (msg.msgid)}
			<MessageComponent
				message={msg}
				isGrouped={false}
				isFirstInGroup={true}
				{isOp}
				{onreply}
				{onreact}
				{onmore}
				{onpin}
				{onedit}
				{oncopytext}
				{oncopylink}
				{onmarkunread}
				{ontogglereaction}
				{onscrolltomessage}
				{onretry}
				{onnickclick}
			/>
		{/each}

		{#if threadMessages.length === 0}
			<div class="thread-empty">Thread messages not found</div>
		{/if}
	</div>

	<div class="thread-reply-area">
		<textarea
			bind:this={replyInput}
			bind:value={replyText}
			class="thread-reply-input"
			placeholder="Reply to thread..."
			rows="1"
			onkeydown={handleReplyKeydown}
		></textarea>
		<button
			class="thread-reply-send"
			disabled={!replyText.trim()}
			onclick={sendReply}
			aria-label="Send reply"
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
				<path d="M1.7 1.4a.6.6 0 01.8-.2l12 6a.6.6 0 010 1.1l-12 6a.6.6 0 01-.8-.8L4.6 8 1.7 2.5a.6.6 0 010-1.1z"/>
			</svg>
		</button>
	</div>
</div>

<style>
	.thread-panel {
		position: absolute;
		top: 0;
		right: 0;
		width: 400px;
		max-width: 100%;
		height: 100%;
		background: var(--surface-low);
		border-left: 1px solid var(--surface-highest);
		box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
		z-index: 100;
		display: flex;
		flex-direction: column;
	}

	.thread-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--surface-highest);
		flex-shrink: 0;
	}

	.thread-header-text {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 6px;
		overflow: hidden;
	}

	.thread-title {
		font-weight: var(--weight-semibold);
		font-size: var(--font-base);
		color: var(--text-primary);
		flex-shrink: 0;
	}

	.thread-preview {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		flex-shrink: 0;
	}

	.thread-preview-text {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.thread-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: color var(--duration-channel), background var(--duration-channel);
	}

	.thread-close:hover {
		color: var(--text-primary);
		background: var(--surface-high);
	}

	.thread-messages {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
	}

	.thread-empty {
		padding: 32px 16px;
		text-align: center;
		color: var(--text-muted);
		font-size: var(--font-sm);
	}

	.thread-reply-area {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--surface-highest);
		flex-shrink: 0;
	}

	.thread-reply-input {
		flex: 1;
		border: 1px solid var(--surface-highest);
		border-radius: 8px;
		background: var(--surface-high);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-base);
		padding: 8px 12px;
		resize: none;
		min-height: 38px;
		max-height: 120px;
		outline: none;
		transition: border-color var(--duration-channel);
	}

	.thread-reply-input:focus {
		border-color: var(--accent-primary);
	}

	.thread-reply-input::placeholder {
		color: var(--text-muted);
	}

	.thread-reply-send {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		border-radius: 8px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		cursor: pointer;
		flex-shrink: 0;
		transition: opacity var(--duration-channel);
	}

	.thread-reply-send:hover {
		opacity: 0.9;
	}

	.thread-reply-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Mobile: full-screen overlay */
	@media (max-width: 768px) {
		.thread-panel {
			width: 100%;
			position: fixed;
			inset: 0;
			z-index: 200;
		}
	}
</style>
