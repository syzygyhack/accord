<script lang="ts">
	import { tick, onDestroy } from 'svelte';
	import { channelUIState } from '$lib/state/channels.svelte';
	import { searchMessages, type Message } from '$lib/state/messages.svelte';
	import { nickColor } from '$lib/irc/format';
	import { themeState } from '$lib/state/theme.svelte';

	interface Props {
		onclose: () => void;
		onscrolltomessage?: (msgid: string) => void;
	}

	let { onclose, onscrolltomessage }: Props = $props();

	let query = $state('');
	let inputEl: HTMLInputElement | undefined = $state(undefined);
	let selectedIndex = $state(0);

	/** Debounced copy of query — updated 300ms after the last keystroke. */
	let debouncedQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const q = query;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedQuery = q;
		}, 300);
	});

	onDestroy(() => clearTimeout(debounceTimer));

	/** Search results derived from the debounced query. */
	let results = $derived.by((): Message[] => {
		const q = debouncedQuery.trim();
		if (!q) return [];
		const channel = channelUIState.activeChannel;
		if (!channel) return [];
		return searchMessages(channel, q);
	});

	/** Clamp selected index when results change. */
	$effect(() => {
		const r = results;
		if (selectedIndex >= r.length) {
			selectedIndex = Math.max(0, r.length - 1);
		}
	});

	/** Focus input on mount. */
	$effect(() => {
		tick().then(() => inputEl?.focus());
	});

	/** Focus the search input (called externally via bind:this or event). */
	export function focusInput(): void {
		inputEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (results.length > 0) {
				selectedIndex = (selectedIndex + 1) % results.length;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (results.length > 0) {
				selectedIndex = (selectedIndex - 1 + results.length) % results.length;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const msg = results[selectedIndex];
			if (msg) {
				selectResult(msg);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	function selectResult(msg: Message): void {
		onscrolltomessage?.(msg.msgid);
		onclose();
	}

	/** Format a timestamp for display. */
	function formatTime(date: Date): string {
		return date.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	/** Truncate text to a max length. */
	function truncate(text: string, max: number): string {
		return text.length > max ? text.slice(0, max) + '...' : text;
	}
</script>

<div class="search-panel">
	<div class="search-header">
		<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
			<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
			<path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:this={inputEl}
			bind:value={query}
			class="search-input"
			type="text"
			placeholder="Search messages... (from:user, in:#channel)"
			autofocus
			onkeydown={handleKeydown}
		/>
		<button class="search-close" title="Close search" aria-label="Close search" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
				<path d="M4.11 3.05a.75.75 0 0 0-1.06 1.06L6.94 8l-3.89 3.89a.75.75 0 1 0 1.06 1.06L8 9.06l3.89 3.89a.75.75 0 1 0 1.06-1.06L9.06 8l3.89-3.89a.75.75 0 0 0-1.06-1.06L8 6.94 4.11 3.05z" />
			</svg>
		</button>
	</div>

	<div class="search-results" role="listbox">
		{#if debouncedQuery.trim() && results.length === 0}
			<div class="search-empty">No messages matched your search</div>
		{:else}
			{#each results as msg, i (msg.msgid)}
				<button
					class="search-result"
					class:selected={i === selectedIndex}
					role="option"
					aria-selected={i === selectedIndex}
					onclick={() => selectResult(msg)}
					onmouseenter={() => (selectedIndex = i)}
				>
					<span class="result-nick" style="color: {nickColor(msg.account, themeState.current)}">{msg.nick}</span>
					<span class="result-text">{truncate(msg.text, 100)}</span>
					<span class="result-time">{formatTime(msg.time)}</span>
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.search-panel {
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

	.search-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--surface-highest);
		flex-shrink: 0;
	}

	.search-icon {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.search-input {
		flex: 1;
		border: none;
		outline: none;
		background: none;
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-base);
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	.search-close {
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

	.search-close:hover {
		color: var(--text-primary);
		background: var(--surface-high);
	}

	.search-results {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
	}

	.search-empty {
		padding: 32px 16px;
		text-align: center;
		color: var(--text-muted);
		font-size: var(--font-sm);
	}

	.search-result {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 8px 16px;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		font-family: var(--font-primary);
		transition: background var(--duration-channel);
	}

	.search-result:hover,
	.search-result.selected {
		background: var(--surface-high);
	}

	.result-nick {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
	}

	.result-text {
		font-size: var(--font-sm);
		color: var(--text-primary);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-time {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}
</style>
