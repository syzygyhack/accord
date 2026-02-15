<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { userState, logout } from '$lib/state/user.svelte';
	import { clearToken } from '$lib/api/auth';
	import { formatMessage } from '$lib/irc/parser';
	import { audioSettings, type VideoQuality } from '$lib/state/audioSettings.svelte';
	import { appSettings, type ZoomLevel } from '$lib/state/appSettings.svelte';
	import type { IRCConnection } from '$lib/irc/connection';

	interface Props {
		onclose: () => void;
		connection?: IRCConnection | null;
	}

	let { onclose, connection = null }: Props = $props();

	let activeTab: 'account' | 'voice' | 'appearance' | 'about' = $state('account');

	// Display name editing
	let editingNick = $state(false);
	let nickInput = $state('');
	let nickError: string | null = $state(null);

	// Voice & Audio device lists (enumerated at runtime)
	let audioInputDevices: MediaDeviceInfo[] = $state([]);
	let audioOutputDevices: MediaDeviceInfo[] = $state([]);
	let videoInputDevices: MediaDeviceInfo[] = $state([]);

	// PTT keybind capture state
	let capturingPTTKey = $state(false);

	let initial = $derived((userState.nick ?? '?')[0].toUpperCase());

	let tabTitle = $derived(
		activeTab === 'account' ? 'My Account' :
		activeTab === 'voice' ? 'Voice & Video' :
		activeTab === 'appearance' ? 'Appearance' :
		'About'
	);

	const videoQualityOptions: { value: VideoQuality; label: string; resolution: string }[] = [
		{ value: '360', label: '360p', resolution: '640 x 360' },
		{ value: '720', label: '720p', resolution: '1280 x 720' },
		{ value: '1080', label: '1080p', resolution: '1920 x 1080' },
		{ value: '1440', label: '1440p', resolution: '2560 x 1440' },
	];

	const zoomOptions: { value: ZoomLevel; label: string; desc: string }[] = [
		{ value: 100, label: 'Spacious', desc: 'Most room for content' },
		{ value: 125, label: 'Default', desc: 'Balanced zoom level' },
		{ value: 150, label: 'Compact', desc: 'Zoomed in, tighter layout' },
	];

	function handleKeydown(e: KeyboardEvent): void {
		// PTT keybind capture mode
		if (capturingPTTKey) {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === 'Escape') {
				capturingPTTKey = false;
				return;
			}
			audioSettings.pttKey = e.code;
			capturingPTTKey = false;
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		}
	}

	/** Human-readable key name for display. */
	function formatKeyName(code: string): string {
		// Strip "Key" prefix for letter keys (KeyA → A)
		if (code.startsWith('Key')) return code.slice(3);
		// Strip "Digit" prefix (Digit1 → 1)
		if (code.startsWith('Digit')) return code.slice(5);
		// Common renames
		const names: Record<string, string> = {
			Space: 'Space',
			ControlLeft: 'Left Ctrl',
			ControlRight: 'Right Ctrl',
			ShiftLeft: 'Left Shift',
			ShiftRight: 'Right Shift',
			AltLeft: 'Left Alt',
			AltRight: 'Right Alt',
			MetaLeft: 'Left Meta',
			MetaRight: 'Right Meta',
			Backquote: '`',
			Minus: '-',
			Equal: '=',
			BracketLeft: '[',
			BracketRight: ']',
			Backslash: '\\',
			Semicolon: ';',
			Quote: "'",
			Comma: ',',
			Period: '.',
			Slash: '/',
		};
		return names[code] ?? code;
	}

	async function handleLogout(): Promise<void> {
		logout();
		clearToken();
		await goto('/login');
	}

	function startEditingNick(): void {
		nickInput = userState.nick ?? '';
		nickError = null;
		editingNick = true;
	}

	function cancelEditingNick(): void {
		editingNick = false;
		nickError = null;
	}

	function submitNick(): void {
		const trimmed = nickInput.trim();
		if (!trimmed) {
			nickError = 'Display name cannot be empty';
			return;
		}
		if (trimmed === userState.nick) {
			editingNick = false;
			return;
		}
		if (!connection) {
			nickError = 'Not connected to server';
			return;
		}
		connection.send(formatMessage('NICK', trimmed));
		editingNick = false;
		nickError = null;
	}

	function handleNickKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			submitNick();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			cancelEditingNick();
		}
	}

	async function loadDevices(): Promise<void> {
		try {
			if (!navigator.mediaDevices?.enumerateDevices) return;
			// Request mic permission first — enumerateDevices returns empty labels
			// and sometimes empty deviceIds until getUserMedia has been granted.
			try {
				const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
				for (const track of tempStream.getTracks()) track.stop();
			} catch {
				// Permission denied — still enumerate what we can
			}
			const devices = await navigator.mediaDevices.enumerateDevices();
			audioInputDevices = devices.filter(d => d.kind === 'audioinput');
			audioOutputDevices = devices.filter(d => d.kind === 'audiooutput');
			videoInputDevices = devices.filter(d => d.kind === 'videoinput');
		} catch (err) {
			console.error('[virc] Device enumeration failed:', err);
		}
	}

	function deviceLabel(device: MediaDeviceInfo, index: number): string {
		if (device.label) return device.label;
		if (device.kind === 'audioinput') return `Microphone ${index + 1}`;
		if (device.kind === 'videoinput') return `Camera ${index + 1}`;
		return `Speaker ${index + 1}`;
	}

	// Mic tester state
	let micTesting = $state(false);
	let micLevel = $state(0);
	let micTestError: string | null = $state(null);
	let micTestStream: MediaStream | null = null;
	let micTestCtx: AudioContext | null = null;
	let micTestAnimFrame: number = 0;

	async function startMicTest(): Promise<void> {
		micTestError = null;
		try {
			const deviceId = audioSettings.inputDeviceId;
			// Mirror the constraints LiveKit will use so the test is representative.
			// Disable echoCancellation so the loopback isn't cancelled by AEC.
			const audioConstraints: MediaTrackConstraints = {
				echoCancellation: false,
				noiseSuppression: audioSettings.noiseSuppression,
				autoGainControl: true,
			};
			if (deviceId !== 'default') {
				audioConstraints.deviceId = { exact: deviceId };
			}
			const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
			micTestStream = stream;

			// Route output device via AudioContext sinkId (Chromium 110+).
			const ctxOptions: AudioContextOptions = {};
			const outId = audioSettings.outputDeviceId;
			if (outId !== 'default') {
				(ctxOptions as any).sinkId = outId;
			}
			const ctx = new AudioContext(ctxOptions);
			await Promise.race([
				ctx.resume(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('AudioContext failed to start')), 3000)
				),
			]);
			if (ctx.state !== 'running') {
				throw new Error(`AudioContext stuck in "${ctx.state}" state`);
			}
			micTestCtx = ctx;

			const source = ctx.createMediaStreamSource(stream);

			// Analyser for level metering
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);

			// Loopback: route to speakers with a small delay to avoid feedback.
			// Microphones produce mono audio — upmix to stereo so both
			// speakers/earpieces play the signal, not just the left channel.
			const delay = ctx.createDelay();
			delay.delayTime.value = 0.05;
			analyser.connect(delay);

			const splitter = ctx.createChannelSplitter(1);
			const merger = ctx.createChannelMerger(2);
			delay.connect(splitter);
			splitter.connect(merger, 0, 0); // mono -> left
			splitter.connect(merger, 0, 1); // mono -> right
			merger.connect(ctx.destination);

			micTesting = true;

			// Animate level meter using time-domain amplitude
			const dataArray = new Uint8Array(analyser.fftSize);
			function updateLevel(): void {
				analyser.getByteTimeDomainData(dataArray);
				let sumSq = 0;
				for (let i = 0; i < dataArray.length; i++) {
					const v = (dataArray[i] - 128) / 128;
					sumSq += v * v;
				}
				const rms = Math.sqrt(sumSq / dataArray.length);
				micLevel = Math.min(100, Math.round(rms * 300));
				micTestAnimFrame = requestAnimationFrame(updateLevel);
			}
			updateLevel();
		} catch (err) {
			console.error('[virc] Mic test failed:', err);
			stopMicTest();
			if (err instanceof DOMException && err.name === 'NotAllowedError') {
				micTestError = 'Microphone access denied. Check your system permissions.';
			} else if (err instanceof DOMException && err.name === 'NotFoundError') {
				micTestError = 'No microphone found. Check your device connections.';
			} else {
				micTestError = err instanceof Error ? err.message : 'Failed to start mic test';
			}
		}
	}

	function stopMicTest(): void {
		if (micTestAnimFrame) {
			cancelAnimationFrame(micTestAnimFrame);
			micTestAnimFrame = 0;
		}
		if (micTestStream) {
			for (const track of micTestStream.getTracks()) track.stop();
			micTestStream = null;
		}
		if (micTestCtx) {
			micTestCtx.close();
			micTestCtx = null;
		}
		micTesting = false;
		micLevel = 0;
	}

	function toggleMicTest(): void {
		if (micTesting) {
			stopMicTest();
		} else {
			startMicTest();
		}
	}

	// Stop mic test when switching away from voice tab
	$effect(() => {
		if (activeTab !== 'voice' && micTesting) {
			stopMicTest();
		}
	});

	// Restart mic test when noise suppression is toggled so the user hears the difference.
	let prevNS: boolean | undefined;
	$effect(() => {
		const ns = audioSettings.noiseSuppression; // tracked dependency
		if (prevNS !== undefined && ns !== prevNS) {
			untrack(() => {
				if (micTesting) {
					stopMicTest();
					startMicTest();
				}
			});
		}
		prevNS = ns;
	});

	onMount(() => {
		loadDevices();

		// Re-enumerate when devices change (plug/unplug)
		navigator.mediaDevices?.addEventListener?.('devicechange', loadDevices);
		return () => {
			navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices);
			stopMicTest();
		};
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="settings-overlay" role="dialog" aria-modal="true" aria-label="User Settings" tabindex="-1" onkeydown={handleKeydown}>
	<div class="settings-container">
		<!-- Left: navigation -->
		<nav class="settings-nav">
			<div class="nav-section">
				<span class="nav-section-title">User Settings</span>
				<button class="nav-item" class:active={activeTab === 'account'} onclick={() => activeTab = 'account'}>
					Account
				</button>
			</div>
			<div class="nav-section">
				<span class="nav-section-title">App Settings</span>
				<button class="nav-item" class:active={activeTab === 'appearance'} onclick={() => activeTab = 'appearance'}>
					Appearance
				</button>
				<button class="nav-item" class:active={activeTab === 'voice'} onclick={() => activeTab = 'voice'}>
					Voice & Video
				</button>
				<button class="nav-item disabled" disabled>
					Notifications
				</button>
				<button class="nav-item disabled" disabled>
					Keybinds
				</button>
			</div>
			<div class="nav-divider"></div>
			<div class="nav-section">
				<button class="nav-item" class:active={activeTab === 'about'} onclick={() => activeTab = 'about'}>
					About
				</button>
			</div>
			<div class="nav-divider"></div>
			<div class="nav-section">
				<button class="nav-item danger" onclick={handleLogout}>
					Log Out
					<svg class="logout-icon" width="14" height="14" viewBox="0 0 24 24">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14l5-5-5-5m5 5H9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			</div>
		</nav>

		<!-- Right: content -->
		<div class="settings-content">
			<div class="content-header">
				<h2 class="content-title">{tabTitle}</h2>
				<button class="close-btn" onclick={onclose} aria-label="Close settings">
					<svg width="18" height="18" viewBox="0 0 24 24">
						<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					</svg>
					<span class="close-hint">ESC</span>
				</button>
			</div>

			<div class="content-body">
				{#if activeTab === 'account'}
					<div class="account-card">
						<div class="account-avatar">
							<span class="avatar-letter-lg">{initial}</span>
						</div>
						<div class="account-details">
							<div class="account-field">
								<span class="field-label">Display Name</span>
								{#if editingNick}
									<div class="nick-edit-row">
										<!-- svelte-ignore a11y_autofocus -->
										<input
											type="text"
											class="nick-input"
											bind:value={nickInput}
											onkeydown={handleNickKeydown}
											autofocus
											maxlength="30"
										/>
										<button class="nick-save-btn" onclick={submitNick}>Save</button>
										<button class="nick-cancel-btn" onclick={cancelEditingNick}>Cancel</button>
									</div>
									{#if nickError}
										<span class="nick-error">{nickError}</span>
									{/if}
								{:else}
									<div class="nick-display-row">
										<span class="field-value">{userState.nick ?? 'Unknown'}</span>
										<button class="nick-edit-btn" onclick={startEditingNick}>Edit</button>
									</div>
								{/if}
							</div>
							<div class="account-field">
								<span class="field-label">Account</span>
								<span class="field-value">{userState.account ?? ''}</span>
							</div>
						</div>
					</div>
					<div class="section-divider"></div>
					<div class="account-actions">
						<button class="logout-btn" onclick={handleLogout}>Log Out</button>
					</div>
				{:else if activeTab === 'voice'}
					<div class="settings-section">
						<h3 class="section-title">Input Device</h3>
						<select class="device-select" bind:value={audioSettings.inputDeviceId}>
							<option value="default">Default</option>
							{#each audioInputDevices as device, i (device.deviceId)}
								<option value={device.deviceId}>{deviceLabel(device, i)}</option>
							{/each}
						</select>
					</div>

					<div class="settings-section">
						<h3 class="section-title">Output Device</h3>
						<select class="device-select" bind:value={audioSettings.outputDeviceId}>
							<option value="default">Default</option>
							{#each audioOutputDevices as device, i (device.deviceId)}
								<option value={device.deviceId}>{deviceLabel(device, i)}</option>
							{/each}
						</select>
					</div>

					<div class="settings-section">
						<h3 class="section-title">Camera</h3>
						<select class="device-select" bind:value={audioSettings.videoDeviceId}>
							<option value="default">Default</option>
							{#each videoInputDevices as device, i (device.deviceId)}
								<option value={device.deviceId}>{deviceLabel(device, i)}</option>
							{/each}
						</select>
					</div>

					<div class="settings-section">
						<h3 class="section-title">Video Quality</h3>
						<p class="setting-hint">Resolution for your camera stream. Higher values use more bandwidth.</p>
						<div class="quality-options">
							{#each videoQualityOptions as opt (opt.value)}
								<button
									class="quality-option"
									class:active={audioSettings.videoQuality === opt.value}
									onclick={() => audioSettings.videoQuality = opt.value}
								>
									<span class="quality-label">{opt.label}</span>
									<span class="quality-res">{opt.resolution}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="settings-section">
						<h3 class="section-title">Noise Suppression</h3>
						<p class="setting-hint">Reduces background noise during voice chat. Disable for music or high-fidelity audio.</p>
						<label class="toggle-row">
							<input type="checkbox" class="toggle-checkbox" bind:checked={audioSettings.noiseSuppression} />
							<span class="toggle-label">{audioSettings.noiseSuppression ? 'Enabled' : 'Disabled'}</span>
						</label>
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Input Mode</h3>
						<div class="input-mode-row">
							<button
								class="mode-btn"
								class:active={!audioSettings.pushToTalk}
								onclick={() => audioSettings.pushToTalk = false}
							>
								Voice Activity
							</button>
							<button
								class="mode-btn"
								class:active={audioSettings.pushToTalk}
								onclick={() => audioSettings.pushToTalk = true}
							>
								Push to Talk
							</button>
						</div>
						{#if audioSettings.pushToTalk}
							<div class="ptt-keybind-row">
								<span class="ptt-label">Keybind</span>
								{#if capturingPTTKey}
									<button class="ptt-key-btn capturing">Press a key...</button>
								{:else}
									<button class="ptt-key-btn" onclick={() => capturingPTTKey = true}>
										{formatKeyName(audioSettings.pttKey)}
									</button>
								{/if}
							</div>
						{/if}
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Mic Test</h3>
						<p class="mic-test-hint">Test your microphone. Audio is looped back through your output device.</p>
						<div class="mic-test-row">
							<button
								class="mic-test-btn"
								class:active={micTesting}
								onclick={toggleMicTest}
							>
								{micTesting ? 'Stop Test' : 'Test Microphone'}
							</button>
						</div>
						{#if micTestError}
							<p class="mic-test-error">{micTestError}</p>
						{/if}
						{#if micTesting}
							<div class="gain-meter">
								{#each Array(20) as _, i}
									<div
										class="gain-segment"
										class:active={micLevel > i * 5}
										class:green={i < 12}
										class:yellow={i >= 12 && i < 16}
										class:red={i >= 16}
									></div>
								{/each}
							</div>
						{/if}
					</div>

					{#if audioInputDevices.length === 0 && audioOutputDevices.length === 0 && videoInputDevices.length === 0}
						<p class="device-hint">No media devices detected. Join a voice channel first to grant microphone permission, then reopen settings.</p>
					{/if}
				{:else if activeTab === 'appearance'}
					<div class="settings-section">
						<h3 class="section-title">Zoom Level</h3>
						<p class="setting-hint">Controls the overall UI scale. Higher values zoom in for a more compact feel.</p>
						<div class="zoom-options">
							{#each zoomOptions as opt (opt.value)}
								<button
									class="zoom-option"
									class:active={appSettings.zoom === opt.value}
									onclick={() => appSettings.zoom = opt.value}
								>
									<div class="zoom-option-header">
										<span class="zoom-option-label">{opt.label}</span>
										<span class="zoom-option-pct">{opt.value}%</span>
									</div>
									<span class="zoom-option-desc">{opt.desc}</span>
								</button>
							{/each}
						</div>
					</div>
				{:else if activeTab === 'about'}
					<div class="about-section">
						<div class="about-logo">virc</div>
						<div class="about-version">Version 0.1.0</div>
						<div class="about-desc">A modern, Discord-like chat client built on IRC.</div>
						<div class="about-stack">
							<span class="stack-item">Svelte 5</span>
							<span class="stack-sep">&bull;</span>
							<span class="stack-item">IRCv3</span>
							<span class="stack-sep">&bull;</span>
							<span class="stack-item">LiveKit</span>
							<span class="stack-sep">&bull;</span>
							<span class="stack-item">Tauri</span>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.settings-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		background: var(--surface-lowest);
		display: flex;
		align-items: stretch;
		justify-content: center;
	}

	.settings-container {
		display: flex;
		width: 100%;
		max-width: 1200px;
		height: 100%;
	}

	/* ---- Navigation ---- */

	.settings-nav {
		width: 220px;
		min-width: 220px;
		background: var(--surface-low);
		padding: 60px 8px 20px 20px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-section {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nav-section-title {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 8px 12px 4px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 12px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-secondary);
		font-size: var(--font-base);
		font-family: var(--font-primary);
		text-align: left;
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.nav-item:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	.nav-item.active {
		background: var(--accent-bg);
		color: var(--text-primary);
		font-weight: var(--weight-medium);
	}

	.nav-item.danger {
		color: var(--danger);
	}

	.nav-item.danger:hover {
		background: var(--danger-bg);
		color: var(--danger);
	}

	.logout-icon {
		margin-left: auto;
	}

	.nav-divider {
		height: 1px;
		background: var(--surface-highest);
		margin: 8px 12px;
	}

	/* ---- Content ---- */

	.settings-content {
		flex: 1;
		max-width: 740px;
		padding: 60px 40px 20px 40px;
		overflow-y: auto;
		position: relative;
	}

	.content-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.content-title {
		font-size: var(--font-lg);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 2px solid var(--surface-highest);
		border-radius: 50%;
		width: 36px;
		height: 36px;
		cursor: pointer;
		color: var(--text-muted);
		transition: color var(--duration-channel), border-color var(--duration-channel);
		position: relative;
	}

	.close-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	.close-hint {
		position: absolute;
		top: 40px;
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-weight: var(--weight-semibold);
		letter-spacing: 0.04em;
	}

	.content-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* ---- Account Tab ---- */

	.account-card {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px;
		background: var(--surface-low);
		border-radius: 8px;
	}

	.account-avatar {
		flex-shrink: 0;
	}

	.avatar-letter-lg {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--accent-primary);
		color: var(--text-inverse, #fff);
		font-size: var(--font-xl);
		font-weight: var(--weight-bold);
		line-height: 1;
	}

	.account-details {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.account-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.field-label {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.field-value {
		font-size: var(--font-base);
		color: var(--text-primary);
	}

	.nick-display-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.nick-edit-btn {
		padding: 2px 10px;
		background: var(--surface-high);
		color: var(--text-secondary);
		border: none;
		border-radius: 3px;
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		cursor: pointer;
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.nick-edit-btn:hover {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.nick-edit-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.nick-input {
		padding: 4px 8px;
		background: var(--surface-lowest);
		color: var(--text-primary);
		border: 1px solid var(--surface-highest);
		border-radius: 3px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		outline: none;
		width: 160px;
	}

	.nick-input:focus {
		border-color: var(--accent-primary);
	}

	.nick-save-btn {
		padding: 4px 12px;
		background: var(--accent-primary);
		color: #fff;
		border: none;
		border-radius: 3px;
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		cursor: pointer;
	}

	.nick-save-btn:hover {
		opacity: 0.9;
	}

	.nick-cancel-btn {
		padding: 4px 12px;
		background: none;
		color: var(--text-secondary);
		border: none;
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		cursor: pointer;
	}

	.nick-cancel-btn:hover {
		color: var(--text-primary);
	}

	.nick-error {
		font-size: var(--font-xs);
		color: var(--danger);
		margin-top: 2px;
	}

	.section-divider {
		height: 1px;
		background: var(--surface-high);
	}

	.account-actions {
		display: flex;
	}

	.logout-btn {
		padding: 8px 24px;
		background: var(--danger);
		color: #fff;
		border: none;
		border-radius: 4px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background var(--duration-channel);
	}

	.logout-btn:hover {
		filter: brightness(0.85);
	}

	/* ---- Voice & Audio Tab ---- */

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-title {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0;
	}

	.device-select {
		width: 100%;
		padding: 8px 12px;
		background: var(--surface-low);
		color: var(--text-primary);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3e%3cpath d='M3 4.5l3 3 3-3' stroke='%239a9da3' fill='none' stroke-width='1.5' stroke-linecap='round'/%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
	}

	.device-select:hover {
		border-color: var(--text-muted);
	}

	.device-select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.quality-options {
		display: flex;
		gap: 8px;
	}

	.quality-option {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 4px;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--font-primary);
		transition: background var(--duration-channel), border-color var(--duration-channel);
	}

	.quality-option:hover {
		background: var(--surface-high);
	}

	.quality-option.active {
		border-color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.quality-label {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.quality-res {
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.device-hint {
		font-size: var(--font-sm);
		color: var(--text-muted);
		font-style: italic;
		margin: 0;
	}

	.setting-hint {
		font-size: var(--font-xs);
		color: var(--text-muted);
		margin: 0;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
	}

	.toggle-checkbox {
		width: 36px;
		height: 20px;
		appearance: none;
		background: var(--surface-highest);
		border-radius: 10px;
		position: relative;
		cursor: pointer;
		transition: background var(--duration-channel);
		flex-shrink: 0;
	}

	.toggle-checkbox::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text-muted);
		transition: transform var(--duration-channel), background var(--duration-channel);
	}

	.toggle-checkbox:checked {
		background: var(--accent-primary);
	}

	.toggle-checkbox:checked::after {
		transform: translateX(16px);
		background: #fff;
	}

	.toggle-label {
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.mic-test-hint {
		font-size: var(--font-sm);
		color: var(--text-muted);
		margin: 0;
	}

	.mic-test-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.mic-test-btn {
		padding: 6px 16px;
		background: var(--surface-high);
		color: var(--text-primary);
		border: none;
		border-radius: 4px;
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background var(--duration-channel);
		flex-shrink: 0;
	}

	.mic-test-btn:hover {
		background: var(--surface-highest);
	}

	.mic-test-btn.active {
		background: var(--danger);
		color: #fff;
	}

	.mic-test-btn.active:hover {
		filter: brightness(0.85);
	}

	.mic-test-error {
		font-size: var(--font-xs);
		color: var(--danger);
		margin: 0;
	}

	.gain-meter {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 20px;
	}

	.gain-segment {
		flex: 1;
		height: 100%;
		border-radius: 2px;
		background: var(--surface-high);
		transition: background 0.06s linear;
	}

	.gain-segment.active.green {
		background: var(--success);
	}

	.gain-segment.active.yellow {
		background: var(--warning);
	}

	.gain-segment.active.red {
		background: var(--danger);
	}

	/* ---- Input Mode (PTT) ---- */

	.input-mode-row {
		display: flex;
		gap: 8px;
	}

	.mode-btn {
		flex: 1;
		padding: 8px 12px;
		background: var(--surface-low);
		color: var(--text-secondary);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background var(--duration-channel), color var(--duration-channel), border-color var(--duration-channel);
	}

	.mode-btn:hover {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	.mode-btn.active {
		background: var(--accent-bg);
		color: var(--accent-primary);
		border-color: var(--accent-primary);
	}

	.ptt-keybind-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 4px;
	}

	.ptt-label {
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.ptt-key-btn {
		padding: 4px 16px;
		background: var(--surface-low);
		color: var(--text-primary);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-size: var(--font-sm);
		font-family: var(--font-mono);
		cursor: pointer;
		transition: border-color var(--duration-channel);
		min-width: 80px;
		text-align: center;
	}

	.ptt-key-btn:hover {
		border-color: var(--text-muted);
	}

	.ptt-key-btn.capturing {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
		animation: pulse-border 1s ease-in-out infinite;
	}

	@keyframes pulse-border {
		0%, 100% { border-color: var(--accent-primary); }
		50% { border-color: transparent; }
	}

	/* ---- Disabled nav items (scaffolded) ---- */

	.nav-item.disabled {
		color: var(--text-muted);
		cursor: default;
		opacity: 0.5;
	}

	.nav-item.disabled:hover {
		background: none;
		color: var(--text-muted);
	}

	/* ---- Appearance Tab ---- */

	.zoom-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.zoom-option {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 16px;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		font-family: var(--font-primary);
		transition: background var(--duration-channel), border-color var(--duration-channel);
	}

	.zoom-option:hover {
		background: var(--surface-high);
	}

	.zoom-option.active {
		border-color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.zoom-option-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.zoom-option-label {
		font-size: var(--font-base);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}

	.zoom-option-pct {
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.zoom-option-desc {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

	/* ---- About Tab ---- */

	.about-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 40px 0;
	}

	.about-logo {
		font-size: calc(var(--font-xl) * 2);
		font-weight: var(--weight-bold);
		color: var(--accent-primary);
		letter-spacing: -0.02em;
	}

	.about-version {
		font-size: var(--font-sm);
		color: var(--text-muted);
	}

	.about-desc {
		font-size: var(--font-base);
		color: var(--text-secondary);
		text-align: center;
		max-width: 400px;
	}

	.about-stack {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}

	.stack-item {
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-weight: var(--weight-medium);
	}

	.stack-sep {
		color: var(--text-muted);
		font-size: var(--font-xs);
	}

	/* ---- Responsive ---- */

	@media (max-width: 768px) {
		.settings-nav {
			width: 180px;
			min-width: 180px;
			padding: 20px 8px 20px 12px;
		}

		.settings-content {
			padding: 20px 16px;
		}
	}

	@media (max-width: 600px) {
		.settings-container {
			flex-direction: column;
		}

		.settings-nav {
			width: 100%;
			min-width: unset;
			flex-direction: row;
			flex-wrap: wrap;
			padding: 12px;
			gap: 4px;
			overflow-y: visible;
			overflow-x: auto;
		}

		.nav-section {
			flex-direction: row;
			gap: 4px;
		}

		.nav-section-title {
			display: none;
		}

		.nav-divider {
			display: none;
		}

		.settings-content {
			flex: 1;
			overflow-y: auto;
		}
	}
</style>
