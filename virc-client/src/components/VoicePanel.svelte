<script lang="ts">
	import { voiceState } from '$lib/state/voice.svelte';
	import { toggleMute, toggleDeafen, toggleVideo, toggleScreenShare, disconnectVoice } from '$lib/voice/room';
	import type { Room } from 'livekit-client';

	interface Props {
		voiceRoom?: Room | null;
		onexpand?: () => void;
	}

	let { voiceRoom = null, onexpand }: Props = $props();

	/** Format seconds into MM:SS. */
	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	function handleMute(): void {
		if (voiceRoom) toggleMute(voiceRoom);
	}

	function handleDeafen(): void {
		if (voiceRoom) toggleDeafen(voiceRoom);
	}

	function handleVideo(): void {
		if (voiceRoom) toggleVideo(voiceRoom);
	}

	function handleScreenShare(): void {
		if (voiceRoom) toggleScreenShare(voiceRoom);
	}

	async function handleDisconnect(): Promise<void> {
		if (!voiceRoom) return;
		try {
			await disconnectVoice(voiceRoom);
		} catch (e) {
			console.error('Disconnect failed:', e);
		}
	}
</script>

<div class="voice-panel" aria-label="Voice Connected">
	<button class="voice-info" onclick={() => onexpand?.()} title="Expand voice overlay">
		<svg class="voice-info-icon" width="14" height="14" viewBox="0 0 16 16">
			<path
				d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
				fill="currentColor"
			/>
		</svg>
		<span class="voice-channel-name">{voiceState.currentRoom?.replace(/^#/, '') ?? ''}</span>
	</button>
	<div class="voice-status">
		<span class="voice-status-text">Connected</span>
		<span class="voice-status-sep">&bull;</span>
		<span class="voice-status-timer">{formatDuration(voiceState.connectDuration)}</span>
	</div>

	{#if voiceRoom}
		<div class="voice-controls">
			<button
				class="ctl-btn"
				class:ctl-danger={voiceState.localMuted}
				onclick={handleMute}
				aria-label={voiceState.localMuted ? 'Unmute' : 'Mute'}
				title={voiceState.localMuted ? 'Unmute' : 'Mute'}
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					{#if voiceState.localMuted}
						<path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 7.46 2.05L12 9.59V5a2 2 0 0 1 4 0v3.59l2 2V5a4 4 0 0 0-6-3.46z" fill="currentColor" opacity="0.5" />
						<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" />
					{:else}
						<path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" fill="currentColor" />
						<path d="M6 11a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-2.07A8 8 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0z" fill="currentColor" />
					{/if}
				</svg>
			</button>

			<button
				class="ctl-btn"
				class:ctl-danger={voiceState.localDeafened}
				onclick={handleDeafen}
				aria-label={voiceState.localDeafened ? 'Undeafen' : 'Deafen'}
				title={voiceState.localDeafened ? 'Undeafen' : 'Deafen'}
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					{#if voiceState.localDeafened}
						<path d="M3 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a9 9 0 0 0-18 0z" fill="currentColor" opacity="0.5" />
						<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" />
					{:else}
						<path d="M3 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a9 9 0 0 0-18 0z" fill="currentColor" />
					{/if}
				</svg>
			</button>

			<button
				class="ctl-btn"
				class:ctl-active={voiceState.localVideoEnabled}
				onclick={handleVideo}
				aria-label={voiceState.localVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
				title={voiceState.localVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					{#if voiceState.localVideoEnabled}
						<path d="M15 8v8H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2zm6-1.8L17 9v6l4 2.8V6.2z" fill="currentColor" />
					{:else}
						<path d="M15 8v8H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2zm6-1.8L17 9v6l4 2.8V6.2z" fill="currentColor" opacity="0.5" />
						<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" />
					{/if}
				</svg>
			</button>

			<button
				class="ctl-btn"
				class:ctl-active={voiceState.localScreenShareEnabled}
				onclick={handleScreenShare}
				aria-label={voiceState.localScreenShareEnabled ? 'Stop Sharing' : 'Share Screen'}
				title={voiceState.localScreenShareEnabled ? 'Stop Sharing' : 'Share Screen'}
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					{#if voiceState.localScreenShareEnabled}
						<path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" />
						<path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
						<path d="M12 16v4" stroke="var(--surface-lowest)" stroke-width="2" stroke-linecap="round" />
					{:else}
						<path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.5" />
						<path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
						<path d="M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					{/if}
				</svg>
			</button>

			<button
				class="ctl-btn"
				onclick={() => onexpand?.()}
				aria-label="Expand voice overlay"
				title="Expand voice overlay"
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					<path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 4h-4v2h6v-6h-2v4z" fill="currentColor" />
				</svg>
			</button>

			<button
				class="ctl-btn ctl-disconnect"
				onclick={handleDisconnect}
				aria-label="Disconnect"
				title="Disconnect"
			>
				<svg width="16" height="16" viewBox="0 0 24 24">
					<rect x="2" y="8" width="20" height="8" rx="4" fill="currentColor" />
					<line x1="9" y1="10" x2="15" y2="14" stroke="var(--surface-lowest)" stroke-width="2" stroke-linecap="round" />
					<line x1="15" y1="10" x2="9" y2="14" stroke="var(--surface-lowest)" stroke-width="2" stroke-linecap="round" />
				</svg>
			</button>
		</div>
	{/if}
</div>

<style>
	.voice-panel {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 10px;
		background: var(--surface-lowest);
		border-top: 1px solid var(--surface-highest);
	}

	.voice-info {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		padding: 2px 0;
		cursor: pointer;
		font-family: var(--font-primary);
		text-align: left;
		border-radius: 4px;
		transition: opacity 0.1s;
	}

	.voice-info:hover {
		opacity: 0.8;
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
		justify-content: center;
		gap: 2px;
		padding-top: 4px;
		border-top: 1px solid var(--surface-high);
		margin-top: 4px;
	}

	.ctl-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.ctl-btn:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	/* Active state for video/screenshare (accent) */
	.ctl-btn.ctl-active {
		color: var(--accent-primary);
	}

	.ctl-btn.ctl-active:hover {
		background: var(--accent-bg);
	}

	/* Danger state for mute/deafen (red) */
	.ctl-btn.ctl-danger {
		color: var(--danger);
	}

	.ctl-btn.ctl-danger:hover {
		background: var(--danger-bg);
	}

	.ctl-btn.ctl-disconnect {
		color: var(--danger);
	}

	.ctl-btn.ctl-disconnect:hover {
		background: var(--danger-bg);
	}
</style>
