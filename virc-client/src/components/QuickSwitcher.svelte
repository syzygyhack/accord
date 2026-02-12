<script lang="ts">
	import { tick } from 'svelte';
	import {
		channelUIState,
		setActiveChannel,
		type ChannelCategory,
	} from '$lib/state/channels.svelte';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let query = $state('');
	let selectedIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state(undefined);

	interface SwitcherItem {
		name: string;
		displayName: string;
		icon: string;
		type: 'text' | 'voice' | 'dm';
	}

	/** Build the full list of switchable targets. */
	let allItems = $derived((): SwitcherItem[] => {
		const items: SwitcherItem[] = [];

		// DM conversations
		for (const dm of channelUIState.dmConversations) {
			items.push({
				name: dm.nick,
				displayName: dm.nick,
				icon: '@',
				type: 'dm',
			});
		}

		// Channels from categories
		for (const cat of channelUIState.categories) {
			for (const ch of cat.channels) {
				if (cat.voice) {
					items.push({
						name: ch,
						displayName: ch.replace(/^#/, ''),
						icon: '\uD83D\uDD0A',
						type: 'voice',
					});
				} else {
					items.push({
						name: ch,
						displayName: ch.replace(/^#/, ''),
						icon: '#',
						type: 'text',
					});
				}
			}
		}

		return items;
	});

	/** Filtered results based on query. */
	let results = $derived((): SwitcherItem[] => {
		const items = allItems();
		if (!query.trim()) return items;
		const q = query.toLowerCase().trim();
		return items.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				item.displayName.toLowerCase().includes(q)
		);
	});

	/** Clamp selected index when results change. */
	$effect(() => {
		const r = results();
		if (selectedIndex >= r.length) {
			selectedIndex = Math.max(0, r.length - 1);
		}
	});

	/** Focus input on mount. */
	$effect(() => {
		tick().then(() => inputEl?.focus());
	});

	function handleKeydown(e: KeyboardEvent): void {
		const r = results();

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = (selectedIndex + 1) % Math.max(1, r.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = (selectedIndex - 1 + Math.max(1, r.length)) % Math.max(1, r.length);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = r[selectedIndex];
			if (item) {
				selectItem(item);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	function selectItem(item: SwitcherItem): void {
		// Only switch to text channels and DMs (voice channels need special handling)
		if (item.type !== 'voice') {
			setActiveChannel(item.name);
		}
		onclose();
	}

	function handleOverlayClick(e: MouseEvent): void {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}
</script>

<div class="quick-switcher-overlay" role="dialog" aria-modal="true" aria-label="Quick channel switcher" tabindex="-1" onclick={handleOverlayClick} onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}>
	<div class="quick-switcher">
		<input
			bind:this={inputEl}
			bind:value={query}
			class="switcher-input"
			type="text"
			placeholder="Where would you like to go?"
			role="combobox"
			aria-expanded="true"
			aria-controls="switcher-listbox"
			aria-activedescendant={results().length > 0 ? `switcher-item-${selectedIndex}` : undefined}
			onkeydown={handleKeydown}
		/>

		<div class="switcher-results" id="switcher-listbox" role="listbox">
			{#each results() as item, i (item.name)}
				<div
					id="switcher-item-{i}"
					class="switcher-item"
					class:selected={i === selectedIndex}
					role="option"
					tabindex="-1"
					aria-selected={i === selectedIndex}
					onclick={() => selectItem(item)}
					onkeydown={(e) => { if (e.key === 'Enter') selectItem(item); }}
					onmouseenter={() => (selectedIndex = i)}
				>
					<span class="switcher-icon" class:dm-icon={item.type === 'dm'} class:voice-icon={item.type === 'voice'}>
						{item.icon}
					</span>
					<span class="switcher-name">{item.displayName}</span>
					{#if item.name === channelUIState.activeChannel}
						<span class="switcher-current">current</span>
					{/if}
				</div>
			{:else}
				<div class="switcher-empty">No results found</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.quick-switcher-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 15vh;
		background: rgba(0, 0, 0, 0.6);
	}

	.quick-switcher {
		width: 540px;
		max-width: 90vw;
		background: var(--surface-low);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	.switcher-input {
		width: 100%;
		padding: 16px 20px;
		border: none;
		outline: none;
		background: var(--surface-high);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-md);
		box-sizing: border-box;
	}

	.switcher-input::placeholder {
		color: var(--text-muted);
	}

	.switcher-results {
		max-height: 360px;
		overflow-y: auto;
		padding: 8px;
	}

	.switcher-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: 4px;
		cursor: pointer;
		transition: background var(--duration-channel);
	}

	.switcher-item.selected {
		background: var(--accent-bg);
	}

	.switcher-icon {
		flex-shrink: 0;
		width: 20px;
		text-align: center;
		color: var(--text-muted);
		font-size: var(--font-md);
		font-weight: var(--weight-medium);
		line-height: 1;
	}

	.switcher-icon.dm-icon {
		font-size: var(--font-sm);
		font-weight: var(--weight-bold);
	}

	.switcher-icon.voice-icon {
		font-size: var(--font-sm);
	}

	.switcher-name {
		flex: 1;
		min-width: 0;
		color: var(--text-primary);
		font-size: var(--font-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.switcher-current {
		flex-shrink: 0;
		font-size: var(--font-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.switcher-empty {
		padding: 16px;
		text-align: center;
		color: var(--text-muted);
		font-size: var(--font-sm);
	}
</style>
