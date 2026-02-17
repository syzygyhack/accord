<script lang="ts">
	import { voiceState, type VideoTrackInfo } from '$lib/state/voice.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { toggleMute, toggleDeafen, toggleVideo, toggleScreenShare, disconnectVoice } from '$lib/voice/room';
	import type { Room } from 'livekit-client';

	interface Props {
		voiceRoom: Room;
		onclose: () => void;
	}

	let { voiceRoom, onclose }: Props = $props();

	// ---------------------------------------------------------------------------
	// Video grid
	// ---------------------------------------------------------------------------

	function gridLayout(count: number): { cols: number; rows: number } {
		if (count <= 1) return { cols: 1, rows: 1 };
		if (count <= 2) return { cols: 2, rows: 1 };
		if (count <= 4) return { cols: 2, rows: 2 };
		if (count <= 6) return { cols: 3, rows: 2 };
		if (count <= 9) return { cols: 3, rows: 3 };
		const cols = Math.ceil(Math.sqrt(count));
		const rows = Math.ceil(count / cols);
		return { cols, rows };
	}

	let tracks = $derived.by((): readonly VideoTrackInfo[] => {
		const raw = voiceState.videoTracks;
		if (raw.length <= 1) return raw;
		return [...raw].sort((a, b) => {
			if (a.source === 'screen' && b.source !== 'screen') return -1;
			if (b.source === 'screen' && a.source !== 'screen') return 1;
			const aSpeaking = voiceState.participants.get(a.nick)?.isSpeaking ?? false;
			const bSpeaking = voiceState.participants.get(b.nick)?.isSpeaking ?? false;
			if (aSpeaking && !bSpeaking) return -1;
			if (bSpeaking && !aSpeaking) return 1;
			return 0;
		});
	});

	let layout = $derived(gridLayout(tracks.length));

	/** Nicks that have video — used to skip them in the avatar row. */
	let nicksWithVideo = $derived(new Set(tracks.map((t) => t.nick)));

	/** Participants without any video track — shown as avatars. */
	let avatarParticipants = $derived(
		Array.from(voiceState.participants.values()).filter((p) => !nicksWithVideo.has(p.nick))
	);

	function attachTrack(video: HTMLVideoElement, track: MediaStreamTrack) {
		const stream = new MediaStream([track]);
		video.srcObject = stream;
		return {
			update(newTrack: MediaStreamTrack) {
				if (newTrack !== track) {
					track = newTrack;
					video.srcObject = new MediaStream([newTrack]);
				}
			},
			destroy() {
				video.srcObject = null;
			},
		};
	}

	// ---------------------------------------------------------------------------
	// Controls
	// ---------------------------------------------------------------------------

	function handleMute(): void { toggleMute(voiceRoom); }
	function handleDeafen(): void { toggleDeafen(voiceRoom); }
	function handleVideo(): void { toggleVideo(voiceRoom); }
	function handleScreenShare(): void { toggleScreenShare(voiceRoom); }

	async function handleDisconnect(): Promise<void> {
		try {
			await disconnectVoice(voiceRoom);
			onclose();
		} catch (e) {
			console.error('Disconnect failed:', e);
		}
	}

	function handleBackdropClick(): void {
		onclose();
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="overlay-backdrop" role="dialog" aria-modal="true" aria-label="Voice overlay" tabindex="-1" onclick={handleBackdropClick} onkeydown={handleKeydown}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay-panel" onclick={(e) => e.stopPropagation()}>
		<!-- Header -->
		<div class="overlay-header">
			<svg class="overlay-icon" width="16" height="16" viewBox="0 0 16 16">
				<path
					d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
					fill="currentColor"
				/>
			</svg>
			<span class="overlay-title">{voiceState.currentRoom?.replace(/^#/, '') ?? ''}</span>
			<button class="overlay-close" onclick={onclose} aria-label="Close overlay" title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24">
					<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					<line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
				</svg>
			</button>
		</div>

		<!-- Content area: video grid + avatar participants -->
		<div class="overlay-content">
			{#if tracks.length > 0}
				<div
					class="video-grid"
					style="--grid-cols: {layout.cols}; --grid-rows: {layout.rows};"
				>
					{#each tracks as info, idx (info.sid)}
						{@const participant = voiceState.participants.get(info.nick)}
						{@const isSpeaking = participant?.isSpeaking ?? false}
						{@const isPrimary = idx === 0 && tracks.length > 1 && (info.source === 'screen' || isSpeaking)}
						<div
							class="video-tile"
							class:screen={info.source === 'screen'}
							class:primary={isPrimary}
							class:speaking={isSpeaking}
						>
							<!-- svelte-ignore a11y_media_has_caption -->
							<video
								autoplay
								playsinline
								muted={info.nick === userState.nick}
								use:attachTrack={info.track}
							></video>
							<div class="video-label">
								<span class="video-nick">{info.nick}</span>
								{#if info.source === 'screen'}
									<span class="video-source">Screen</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Avatar row: participants without video -->
			{#if avatarParticipants.length > 0}
				<div class="participant-avatars">
					{#each avatarParticipants as p (p.nick)}
						<div class="participant-card" class:speaking={p.isSpeaking}>
							<div class="participant-avatar" class:speaking-ring={p.isSpeaking}>
								<span class="avatar-letter">{p.nick[0]?.toUpperCase() ?? '?'}</span>
							</div>
							<span class="participant-nick">{p.nick}</span>
							<div class="participant-indicators">
								{#if p.isDeafened}
									<svg class="indicator-icon deafened" width="14" height="14" viewBox="0 0 24 24">
										<path d="M3 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a9 9 0 0 0-18 0z" fill="currentColor" opacity="0.5" />
										<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
									</svg>
								{:else if p.isMuted}
									<svg class="indicator-icon muted" width="14" height="14" viewBox="0 0 24 24">
										<path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" fill="currentColor" opacity="0.5" />
										<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
									</svg>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if tracks.length === 0 && avatarParticipants.length === 0}
				<div class="empty-state">No participants</div>
			{/if}
		</div>

		<!-- Controls bar -->
		<div class="overlay-controls">
			<button
				class="ctl-btn"
				class:ctl-danger={voiceState.localMuted}
				onclick={handleMute}
				aria-label={voiceState.localMuted ? 'Unmute' : 'Mute'}
				title={voiceState.localMuted ? 'Unmute' : 'Mute'}
			>
				<svg width="20" height="20" viewBox="0 0 24 24">
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
				<svg width="20" height="20" viewBox="0 0 24 24">
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
				<svg width="20" height="20" viewBox="0 0 24 24">
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
				<svg width="20" height="20" viewBox="0 0 24 24">
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
				class="ctl-btn ctl-disconnect"
				onclick={handleDisconnect}
				aria-label="Disconnect"
				title="Disconnect"
			>
				<svg width="20" height="20" viewBox="0 0 24 24">
					<rect x="2" y="8" width="20" height="8" rx="4" fill="currentColor" />
					<line x1="9" y1="10" x2="15" y2="14" stroke="var(--surface-lowest)" stroke-width="2" stroke-linecap="round" />
					<line x1="15" y1="10" x2="9" y2="14" stroke="var(--surface-lowest)" stroke-width="2" stroke-linecap="round" />
				</svg>
			</button>
		</div>
	</div>
</div>

<style>
	.overlay-backdrop {
		position: fixed;
		inset: 0;
		z-index: 500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
	}

	.overlay-panel {
		display: flex;
		flex-direction: column;
		width: 90vw;
		max-width: 720px;
		max-height: 80vh;
		background: var(--surface-low);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	.overlay-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--surface-highest);
		flex-shrink: 0;
	}

	.overlay-icon {
		color: var(--success);
		flex-shrink: 0;
	}

	.overlay-title {
		flex: 1;
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.overlay-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-muted);
		flex-shrink: 0;
		transition: background 0.1s, color 0.1s;
	}

	.overlay-close:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	/* Content area */
	.overlay-content {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
		min-height: 120px;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 80px;
		color: var(--text-muted);
		font-size: var(--font-sm);
	}

	/* Video grid */
	.video-grid {
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), 1fr);
		grid-template-rows: repeat(var(--grid-rows), 1fr);
		gap: 4px;
		margin-bottom: 12px;
	}

	.video-tile {
		position: relative;
		background: var(--surface-base);
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		aspect-ratio: 16 / 9;
	}

	.video-tile.screen,
	.video-tile.primary {
		grid-column: 1 / -1;
	}

	.video-tile.speaking {
		outline: 2px solid var(--success, #3ba55d);
		outline-offset: -2px;
	}

	.video-tile video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
		border-radius: 8px;
	}

	.video-label {
		position: absolute;
		bottom: 6px;
		left: 6px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 4px;
		pointer-events: none;
	}

	.video-nick {
		font-size: var(--font-xs);
		color: var(--text-inverse);
		font-weight: var(--weight-medium);
	}

	.video-source {
		font-size: var(--font-xs);
		color: rgba(255, 255, 255, 0.7);
	}

	/* Participant avatars (no video) */
	.participant-avatars {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		justify-content: center;
		padding: 8px 0;
	}

	.participant-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 72px;
	}

	.participant-avatar {
		position: relative;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--surface-high);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: box-shadow 0.15s;
	}

	.participant-avatar.speaking-ring {
		box-shadow: 0 0 0 3px var(--success, #3ba55d);
	}

	.avatar-letter {
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		line-height: 1;
	}

	.participant-nick {
		font-size: var(--font-xs);
		color: var(--text-secondary);
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.participant-card.speaking .participant-nick {
		color: var(--text-primary);
	}

	.participant-indicators {
		display: flex;
		gap: 2px;
		min-height: 14px;
	}

	.indicator-icon {
		color: var(--text-muted);
	}

	.indicator-icon.muted,
	.indicator-icon.deafened {
		color: var(--danger);
	}

	/* Controls bar */
	.overlay-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--surface-highest);
		flex-shrink: 0;
		background: var(--surface-lowest);
	}

	.ctl-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background: var(--surface-high);
		border: none;
		border-radius: 50%;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background 0.1s, color 0.1s;
	}

	.ctl-btn:hover {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.ctl-btn.ctl-active {
		color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.ctl-btn.ctl-active:hover {
		background: var(--accent-bg);
		filter: brightness(1.1);
	}

	.ctl-btn.ctl-danger {
		color: var(--danger);
		background: var(--danger-bg);
	}

	.ctl-btn.ctl-danger:hover {
		background: var(--danger-bg);
		filter: brightness(1.1);
	}

	.ctl-btn.ctl-disconnect {
		color: var(--text-inverse);
		background: var(--danger);
	}

	.ctl-btn.ctl-disconnect:hover {
		filter: brightness(1.1);
	}
</style>
