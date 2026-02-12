<script lang="ts">
	import { voiceState } from '$lib/state/voice.svelte';
	import { toggleMute, toggleDeafen, disconnectVoice } from '$lib/voice/room';
	import type { Room } from 'livekit-client';

	interface Props {
		room: Room;
	}

	let { room }: Props = $props();

	/** Format seconds into MM:SS. */
	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	function handleMute(): void {
		toggleMute(room);
	}

	function handleDeafen(): void {
		toggleDeafen(room);
	}

	async function handleDisconnect(): Promise<void> {
		try {
			await disconnectVoice(room);
		} catch (e) {
			console.error('Disconnect failed:', e);
		}
	}
</script>

<div class="voice-panel" aria-label="Voice Connected">
	<div class="voice-info">
		<svg class="voice-info-icon" width="14" height="14" viewBox="0 0 16 16">
			<path
				d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
				fill="currentColor"
			/>
		</svg>
		<span class="voice-channel-name">{voiceState.currentRoom?.replace(/^#/, '') ?? ''}</span>
	</div>
	<div class="voice-status">
		<span class="voice-status-text">Connected</span>
		<span class="voice-status-sep">&bull;</span>
		<span class="voice-status-timer">{formatDuration(voiceState.connectDuration)}</span>
	</div>

	<div class="voice-controls">
		<button
			class="voice-btn"
			class:active={voiceState.localMuted}
			onclick={handleMute}
			aria-label={voiceState.localMuted ? 'Unmute' : 'Mute'}
			title={voiceState.localMuted ? 'Unmute' : 'Mute'}
		>
			<svg width="18" height="18" viewBox="0 0 24 24">
				{#if voiceState.localMuted}
					<!-- Mic with red slash -->
					<path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 7.46 2.05L12 9.59V5a2 2 0 0 1 4 0v3.59l2 2V5a4 4 0 0 0-6-3.46z" fill="currentColor" opacity="0.5" />
					<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" />
				{:else}
					<path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" fill="currentColor" />
					<path d="M6 11a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-2.07A8 8 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0z" fill="currentColor" />
				{/if}
			</svg>
		</button>

		<button
			class="voice-btn"
			class:active={voiceState.localDeafened}
			onclick={handleDeafen}
			aria-label={voiceState.localDeafened ? 'Undeafen' : 'Deafen'}
			title={voiceState.localDeafened ? 'Undeafen' : 'Deafen'}
		>
			<svg width="18" height="18" viewBox="0 0 24 24">
				{#if voiceState.localDeafened}
					<!-- Headphones with red slash -->
					<path d="M3 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a9 9 0 0 0-18 0z" fill="currentColor" opacity="0.5" />
					<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" />
				{:else}
					<path d="M3 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a9 9 0 0 0-18 0z" fill="currentColor" />
				{/if}
			</svg>
		</button>

		<button
			class="voice-btn disconnect"
			onclick={handleDisconnect}
			aria-label="Disconnect"
			title="Disconnect"
		>
			<svg width="18" height="18" viewBox="0 0 24 24">
				<path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z" fill="currentColor" />
				<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
	</div>
</div>

<style>
	.voice-panel {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 10px;
		background: var(--surface-lowest);
		border-top: 1px solid var(--surface-highest);
	}

	.voice-info {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.voice-info-icon {
		color: var(--success);
		flex-shrink: 0;
	}

	.voice-channel-name {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--success);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.voice-status {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-left: 20px; /* align under channel name */
	}

	.voice-status-text {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

	.voice-status-sep {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

	.voice-status-timer {
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.voice-controls {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-top: 4px;
	}

	.voice-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--surface-high);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.voice-btn:hover {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.voice-btn.active {
		background: rgba(224, 64, 64, 0.15);
		color: var(--danger);
	}

	.voice-btn.active:hover {
		background: rgba(224, 64, 64, 0.25);
	}

	.voice-btn.disconnect {
		background: rgba(224, 64, 64, 0.15);
		color: var(--danger);
		margin-left: auto;
	}

	.voice-btn.disconnect:hover {
		background: rgba(224, 64, 64, 0.3);
	}
</style>
