<script lang="ts">
	import { getTypingUsers } from '$lib/state/typing.svelte';
	import { typingState } from '$lib/state/typing.svelte';

	interface Props {
		channel: string;
	}

	let { channel }: Props = $props();

	// Re-poll typing users periodically to catch expirations.
	// Only runs the interval when someone is actually typing.
	let tick = $state(0);

	$effect(() => {
		// Subscribe to changes on the channel's typing map
		const hasTypers = typingState.channels.has(channel);
		if (!hasTypers) {
			tick = 0;
			return;
		}

		const interval = setInterval(() => {
			tick++;
		}, 1_000);

		return () => clearInterval(interval);
	});

	let typingUsers = $derived.by(() => {
		// Reference tick to trigger re-evaluation every second when active
		void tick;
		return getTypingUsers(channel);
	});

	let displayText = $derived.by(() => {
		const users = typingUsers;
		if (users.length === 0) return '';
		if (users.length === 1) return `${users[0]} is typing...`;
		if (users.length === 2) return `${users[0]} and ${users[1]} are typing...`;
		return 'Several people are typing...';
	});
</script>

{#if displayText}
	<div class="typing-indicator" role="status" aria-live="polite">
		<span class="typing-dots">
			<span class="dot"></span>
			<span class="dot"></span>
			<span class="dot"></span>
		</span>
		<span class="typing-text">{displayText}</span>
	</div>
{/if}

<style>
	.typing-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 16px 4px;
		font-size: var(--font-xs);
		color: var(--text-secondary);
		height: 20px;
	}

	.typing-dots {
		display: flex;
		gap: 2px;
		align-items: center;
	}

	.dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--text-secondary);
		animation: typing-bounce 1.4s infinite ease-in-out;
	}

	.dot:nth-child(1) {
		animation-delay: 0s;
	}

	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing-bounce {
		0%, 60%, 100% {
			opacity: 0.4;
			transform: translateY(0);
		}
		30% {
			opacity: 1;
			transform: translateY(-2px);
		}
	}

	.typing-text {
		line-height: 1;
	}
</style>
