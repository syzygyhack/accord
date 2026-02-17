<script lang="ts">
	interface Props {
		serverName: string;
		message: string;
		suggestedChannels?: string[];
		ondismiss: () => void;
		onjoin?: (channel: string) => void;
	}

	let { serverName, message, suggestedChannels = [], ondismiss, onjoin }: Props = $props();

	function handleChannelClick(channel: string) {
		onjoin?.(channel);
		ondismiss();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			ondismiss();
		}
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			ondismiss();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="welcome-overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="welcome-title"
	onclick={handleOverlayClick}
	onkeydown={handleKeydown}
>
	<div class="welcome-dialog">
		<h2 id="welcome-title" class="welcome-title">Welcome to {serverName}</h2>
		<p class="welcome-message">{message}</p>

		{#if suggestedChannels.length > 0}
			<div class="welcome-channels">
				<span class="welcome-channels-label">Suggested channels</span>
				<div class="channel-pills">
					{#each suggestedChannels as channel (channel)}
						<button
							class="channel-pill"
							onclick={() => handleChannelClick(channel)}
						>
							<span class="channel-hash">#</span>{channel.replace(/^#/, '')}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<button class="welcome-dismiss" onclick={ondismiss}>Got it</button>
	</div>
</div>

<style>
	.welcome-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.welcome-dialog {
		background: var(--surface-low);
		border-radius: 8px;
		padding: 32px;
		max-width: 440px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		text-align: center;
	}

	.welcome-title {
		margin: 0 0 12px;
		font-size: var(--font-xl);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.welcome-message {
		margin: 0 0 20px;
		font-size: var(--font-base);
		color: var(--text-secondary);
		line-height: 1.5;
		white-space: pre-line;
	}

	.welcome-channels {
		margin-bottom: 24px;
	}

	.welcome-channels-label {
		display: block;
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 8px;
	}

	.channel-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
	}

	.channel-pill {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		padding: 4px 12px;
		border: 1px solid var(--surface-highest);
		border-radius: 16px;
		background: var(--surface-high);
		color: var(--text-link);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background 150ms ease, border-color 150ms ease;
	}

	.channel-pill:hover {
		background: var(--accent-bg);
		border-color: var(--accent-primary);
	}

	.channel-hash {
		color: var(--text-muted);
		font-weight: var(--weight-normal, 400);
	}

	.welcome-dismiss {
		padding: 10px 32px;
		border: none;
		border-radius: 4px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		font-family: var(--font-primary);
		font-size: var(--font-base);
		font-weight: var(--weight-semibold);
		cursor: pointer;
		transition: background 150ms ease;
	}

	.welcome-dismiss:hover {
		background: var(--accent-secondary);
	}
</style>
