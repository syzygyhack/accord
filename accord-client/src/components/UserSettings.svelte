<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { useTrapFocus, handleTablistKeydown } from '$lib/utils/a11y';
	import { userState } from '$lib/state/user.svelte';
	import { clearToken, clearCredentials } from '$lib/api/auth';
	import { audioSettings, type VideoQuality } from '$lib/state/audioSettings.svelte';
	import { appSettings, type ZoomLevel, type SystemMessageDisplay } from '$lib/state/appSettings.svelte';
	import {
		themeState,
		setTheme,
		setServerThemesDisabled,
		setServerThemeDisabled,
		isServerThemeDisabled,
		dismissContrastWarning,
		type Theme,
	} from '$lib/state/theme.svelte';
	import {
		getRegisteredBindings,
		setCustomBinding,
		resetAllBindings,
		hasCustomBindings,
		formatCombo,
		comboFromEvent,
		type BindingInfo,
		type KeyCombo,
	} from '$lib/keybindings';
	import { channelState } from '$lib/state/channels.svelte';
	import { getNotificationLevel, setNotificationLevel, type NotificationLevel } from '$lib/state/notifications.svelte';
	import { getNotificationPermission, requestNotificationPermission } from '$lib/notifications';
	import { getToken } from '$lib/api/auth';
	import { getActiveServer, serverState } from '$lib/state/servers.svelte';
	import { changePassword, changeEmail, type AccountApiResult } from '$lib/api/account';
	import {
		getProfile,
		updateProfile,
		uploadAvatar,
		resolveAvatarUrl,
		fetchProfile,
	} from '$lib/state/profiles.svelte';
	import Avatar from './Avatar.svelte';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let activeTab: 'account' | 'voice' | 'appearance' | 'notifications' | 'keybindings' | 'advanced' | 'about' = $state('account');

	// Voice & Audio device lists (enumerated at runtime)
	let audioInputDevices: MediaDeviceInfo[] = $state([]);
	let audioOutputDevices: MediaDeviceInfo[] = $state([]);
	let videoInputDevices: MediaDeviceInfo[] = $state([]);

	// PTT keybind capture state
	let capturingPTTKey = $state(false);

	// Keybindings state
	let keybindingsList: BindingInfo[] = $state([]);
	let recordingAction: string | null = $state(null);

	function refreshKeybindings(): void {
		keybindingsList = getRegisteredBindings();
	}

	function startRecording(description: string): void {
		recordingAction = description;
	}

	function cancelRecording(): void {
		recordingAction = null;
	}

	function handleKeybindingCapture(e: KeyboardEvent): void {
		if (!recordingAction) return;
		e.preventDefault();
		e.stopPropagation();

		if (e.key === 'Escape') {
			recordingAction = null;
			return;
		}

		const combo = comboFromEvent(e);
		if (!combo) return; // Bare modifier press — keep recording

		setCustomBinding(recordingAction, combo);
		recordingAction = null;
		refreshKeybindings();
	}

	function handleResetAllBindings(): void {
		resetAllBindings();
		refreshKeybindings();
	}

	let initial = $derived((userState.nick ?? '?')[0].toUpperCase());

	// --- Notifications state ---
	let notifPermission = $state(getNotificationPermission());

	async function handleRequestNotifPermission(): Promise<void> {
		notifPermission = await requestNotificationPermission();
	}

	const notificationLevelOptions: { value: NotificationLevel; label: string; desc: string }[] = [
		{ value: 'all', label: 'All Messages', desc: 'Get notified for every message' },
		{ value: 'mentions', label: 'Only @Mentions', desc: 'Only notify when you are mentioned' },
		{ value: 'nothing', label: 'Nothing', desc: 'No notifications, but still track unreads' },
		{ value: 'mute', label: 'Mute', desc: 'Suppress all unreads except @mentions' },
	];

	/** Derive the list of joined channels for per-channel notification overrides. */
	let joinedChannels = $derived(
		Array.from(channelState.channels.keys()).sort()
	);

	// --- Account: email change state ---
	let emailInput = $state('');
	let emailError: string | null = $state(null);
	let emailSuccess: string | null = $state(null);
	let emailSubmitting = $state(false);

	// --- Account: password change state ---
	let currentPasswordInput = $state('');
	let newPasswordInput = $state('');
	let confirmPasswordInput = $state('');
	let passwordError: string | null = $state(null);
	let passwordSuccess: string | null = $state(null);
	let passwordSubmitting = $state(false);

	// --- Profile editing state ---
	let profileBio = $state('');
	let profileSaving = $state(false);
	let profileError: string | null = $state(null);
	let profileSuccess: string | null = $state(null);
	let avatarUploading = $state(false);
	let avatarError: string | null = $state(null);
	let avatarFileInput: HTMLInputElement | undefined = $state();

	let currentProfile = $derived(getProfile(userState.account ?? ''));
	let currentAvatarUrl = $derived(resolveAvatarUrl(currentProfile?.avatar));

	/** True when Bio differs from the saved server profile. */
	let profileDirty = $derived(
		profileBio.trim() !== (currentProfile?.bio ?? '')
	);

	async function submitEmail(): Promise<void> {
		const trimmed = emailInput.trim();
		emailError = null;
		emailSuccess = null;
		if (!trimmed) {
			emailError = 'Email cannot be empty';
			return;
		}
		if (!trimmed.includes('@') || !trimmed.includes('.')) {
			emailError = 'Invalid email address';
			return;
		}
		const server = getActiveServer();
		const token = getToken();
		if (!server?.filesUrl || !token) {
			emailError = 'Not connected to server';
			return;
		}
		emailSubmitting = true;
		const result: AccountApiResult = await changeEmail(server.filesUrl, token, { email: trimmed });
		emailSubmitting = false;
		if (result.success) {
			emailSuccess = 'Email updated successfully';
			emailInput = '';
		} else {
			emailError = result.error ?? 'Failed to update email';
		}
	}

	async function submitProfile(): Promise<void> {
		profileError = null;
		profileSuccess = null;
		profileSaving = true;
		const { profile, error } = await updateProfile({
			bio: profileBio.trim() || undefined,
		});
		profileSaving = false;
		if (profile) {
			profileSuccess = 'Profile updated';
		} else {
			profileError = error ?? 'Failed to update profile';
		}
	}

	function resetProfile(): void {
		profileBio = currentProfile?.bio ?? '';
		profileError = null;
		profileSuccess = null;
	}

	async function handleAvatarUpload(): Promise<void> {
		const file = avatarFileInput?.files?.[0];
		if (!file) return;
		avatarError = null;

		// Validate file type
		const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
		if (!allowed.includes(file.type)) {
			avatarError = 'Only PNG, JPEG, GIF, or WebP images are allowed';
			return;
		}
		// Validate file size (2MB)
		if (file.size > 2 * 1024 * 1024) {
			avatarError = 'Avatar must be under 2 MB';
			return;
		}

		avatarUploading = true;
		const result = await uploadAvatar(file);
		avatarUploading = false;
		if (result.url) {
			// Re-fetch profile to update the cached avatar URL
			if (userState.account) {
				await fetchProfile(userState.account);
			}
		} else {
			avatarError = result.error ?? 'Failed to upload avatar';
		}
	}

	function triggerAvatarUpload(): void {
		avatarFileInput?.click();
	}

	async function submitPasswordChange(): Promise<void> {
		passwordError = null;
		passwordSuccess = null;
		if (!currentPasswordInput) {
			passwordError = 'Current password is required';
			return;
		}
		if (!newPasswordInput) {
			passwordError = 'New password is required';
			return;
		}
		if (newPasswordInput !== confirmPasswordInput) {
			passwordError = 'New passwords do not match';
			return;
		}
		if (newPasswordInput === currentPasswordInput) {
			passwordError = 'New password must be different from current';
			return;
		}
		const server = getActiveServer();
		const token = getToken();
		if (!server?.filesUrl || !token) {
			passwordError = 'Not connected to server';
			return;
		}
		passwordSubmitting = true;
		const result: AccountApiResult = await changePassword(server.filesUrl, token, {
			currentPassword: currentPasswordInput,
			newPassword: newPasswordInput,
		});
		passwordSubmitting = false;
		if (result.success) {
			passwordSuccess = 'Password changed successfully';
			currentPasswordInput = '';
			newPasswordInput = '';
			confirmPasswordInput = '';
		} else {
			passwordError = result.error ?? 'Failed to change password';
		}
	}

	let tabTitle = $derived(
		activeTab === 'account' ? 'My Account' :
		activeTab === 'voice' ? 'Voice & Video' :
		activeTab === 'appearance' ? 'Appearance' :
		activeTab === 'notifications' ? 'Notifications' :
		activeTab === 'keybindings' ? 'Keybindings' :
		activeTab === 'advanced' ? 'Advanced' :
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

	const themeOptions: { value: Theme; label: string; desc: string }[] = [
		{ value: 'dark', label: 'Dark', desc: 'Default dark theme' },
		{ value: 'light', label: 'Light', desc: 'Light backgrounds, dark text' },
		{ value: 'amoled', label: 'AMOLED', desc: 'True black for OLED screens' },
		{ value: 'compact', label: 'Compact', desc: 'IRC-style dense layout' },
	];

	const systemMsgOptions: { value: SystemMessageDisplay; label: string; desc: string }[] = [
		{ value: 'all', label: 'All', desc: 'Show every join, part, quit, nick, and mode event' },
		{ value: 'smart', label: 'Smart', desc: 'Only show events for users who spoke recently' },
		{ value: 'none', label: 'None', desc: 'Hide all system messages' },
	];

	function handleKeydown(e: KeyboardEvent): void {
		// Keybinding recording mode
		if (recordingAction) {
			handleKeybindingCapture(e);
			return;
		}
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

	function handleLogout(): void {
		// Best-effort credential cleanup (async, but localStorage clears synchronously)
		void clearCredentials();
		localStorage.removeItem('accord:serverUrl');
		localStorage.removeItem('accord:filesUrl');
		clearToken();
		// Hard navigate — bypasses SvelteKit lifecycle
		window.location.href = '/login';
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
			console.error('[accord] Device enumeration failed:', err);
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
			console.error('[accord] Mic test failed:', err);
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

	// Refresh keybindings list when switching to keybindings tab; cancel recording when leaving
	$effect(() => {
		if (activeTab === 'keybindings') {
			refreshKeybindings();
		} else if (recordingAction) {
			recordingAction = null;
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

	// Populate profile fields when profile loads / tab opens
	$effect(() => {
		if (activeTab === 'account' && currentProfile) {
			profileBio = currentProfile.bio ?? '';
		}
	});

	// Fetch own profile if not cached
	$effect(() => {
		if (activeTab === 'account' && userState.account && !getProfile(userState.account)) {
			fetchProfile(userState.account);
		}
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
<div class="settings-overlay" role="dialog" aria-modal="true" aria-label="User Settings" tabindex="-1" onkeydown={handleKeydown} use:useTrapFocus>
	<div class="settings-container">
		<!-- Left: navigation -->
		<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
		<nav class="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings tabs" onkeydown={(e) => handleTablistKeydown(e, e.currentTarget)}>
			<div class="nav-section">
				<span class="nav-section-title">User Settings</span>
				<button class="nav-item" class:active={activeTab === 'account'} role="tab" aria-selected={activeTab === 'account'} aria-controls="tabpanel-account" onclick={() => activeTab = 'account'}>
					Account
				</button>
			</div>
			<div class="nav-section">
				<span class="nav-section-title">App Settings</span>
				<button class="nav-item" class:active={activeTab === 'appearance'} role="tab" aria-selected={activeTab === 'appearance'} aria-controls="tabpanel-appearance" onclick={() => activeTab = 'appearance'}>
					Appearance
				</button>
				<button class="nav-item" class:active={activeTab === 'voice'} role="tab" aria-selected={activeTab === 'voice'} aria-controls="tabpanel-voice" onclick={() => activeTab = 'voice'}>
					Voice & Video
				</button>
				<button class="nav-item" class:active={activeTab === 'notifications'} role="tab" aria-selected={activeTab === 'notifications'} aria-controls="tabpanel-notifications" onclick={() => activeTab = 'notifications'}>
					Notifications
				</button>
				<button class="nav-item" class:active={activeTab === 'keybindings'} role="tab" aria-selected={activeTab === 'keybindings'} aria-controls="tabpanel-keybindings" onclick={() => activeTab = 'keybindings'}>
					Keybinds
				</button>
				<button class="nav-item" class:active={activeTab === 'advanced'} role="tab" aria-selected={activeTab === 'advanced'} aria-controls="tabpanel-advanced" onclick={() => activeTab = 'advanced'}>
					Advanced
				</button>
			</div>
			<div class="nav-divider"></div>
			<div class="nav-section">
				<button class="nav-item" class:active={activeTab === 'about'} role="tab" aria-selected={activeTab === 'about'} aria-controls="tabpanel-about" onclick={() => activeTab = 'about'}>
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

			<div class="content-body" role="tabpanel" id="tabpanel-{activeTab}" aria-label="{tabTitle}">
				{#if activeTab === 'account'}
					<div class="account-card">
						<div class="account-avatar">
							<Avatar account={userState.account ?? ''} nick={userState.nick ?? '?'} size="lg" />
						</div>
						<div class="account-details">
							<div class="account-field">
								<span class="field-label">Display Name</span>
								<span class="field-value">{currentProfile?.displayName || (userState.nick ?? 'Unknown')}</span>
							</div>
							<div class="account-field">
								<span class="field-label">Account</span>
								<span class="field-value">{userState.account ?? ''}</span>
							</div>
						</div>
					</div>
					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Profile</h3>
						<p class="setting-hint">Customize how others see you on this server.</p>

						<div class="profile-edit-avatar-row">
							<div class="profile-edit-avatar-preview">
								{#if currentAvatarUrl}
									<img class="profile-edit-avatar-img" src={currentAvatarUrl} alt="Your avatar" />
								{:else}
									<Avatar account={userState.account ?? ''} nick={userState.nick ?? '?'} size="lg" />
								{/if}
							</div>
							<div class="profile-edit-avatar-actions">
								<button class="settings-save-btn" onclick={triggerAvatarUpload} disabled={avatarUploading}>
									{avatarUploading ? 'Uploading...' : 'Upload Avatar'}
								</button>
								<input
									type="file"
									accept="image/png,image/jpeg,image/gif,image/webp"
									class="hidden-file-input"
									bind:this={avatarFileInput}
									onchange={handleAvatarUpload}
								/>
								{#if avatarError}
									<span class="form-error">{avatarError}</span>
								{/if}
							</div>
						</div>

						<label class="form-field">
							<span class="field-label">Bio</span>
							<textarea
								class="settings-textarea"
								placeholder="Tell others about yourself"
								bind:value={profileBio}
								maxlength="500"
								rows="3"
							></textarea>
						</label>

						{#if profileError}
							<span class="form-error">{profileError}</span>
						{/if}
						{#if profileSuccess}
							<span class="form-success">{profileSuccess}</span>
						{/if}
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Email</h3>
						<p class="setting-hint">Set or change the email associated with your account.</p>
						<div class="account-form-row">
							<input
								type="email"
								class="settings-input"
								placeholder="you@example.com"
								bind:value={emailInput}
								onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); submitEmail(); } }}
							/>
							<button class="settings-save-btn" onclick={submitEmail} disabled={emailSubmitting}>
								{emailSubmitting ? 'Saving...' : 'Save'}
							</button>
						</div>
						{#if emailError}
							<span class="form-error">{emailError}</span>
						{/if}
						{#if emailSuccess}
							<span class="form-success">{emailSuccess}</span>
						{/if}
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Change Password</h3>
						<div class="password-form">
							<label class="form-field">
								<span class="field-label">Current Password</span>
								<input
									type="password"
									class="settings-input"
									bind:value={currentPasswordInput}
									autocomplete="current-password"
								/>
							</label>
							<label class="form-field">
								<span class="field-label">New Password</span>
								<input
									type="password"
									class="settings-input"
									bind:value={newPasswordInput}
									autocomplete="new-password"
								/>
							</label>
							<label class="form-field">
								<span class="field-label">Confirm New Password</span>
								<input
									type="password"
									class="settings-input"
									bind:value={confirmPasswordInput}
									autocomplete="new-password"
									onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); submitPasswordChange(); } }}
								/>
							</label>
							<button class="settings-save-btn" onclick={submitPasswordChange} disabled={passwordSubmitting}>
								{passwordSubmitting ? 'Changing...' : 'Change Password'}
							</button>
						</div>
						{#if passwordError}
							<span class="form-error">{passwordError}</span>
						{/if}
						{#if passwordSuccess}
							<span class="form-success">{passwordSuccess}</span>
						{/if}
					</div>

					<div class="section-divider"></div>
					<div class="account-actions">
						<button class="logout-btn" onclick={handleLogout}>Log Out</button>
					</div>

					{#if profileDirty}
						<div class="save-bar">
							<span class="save-bar-hint">You have unsaved changes</span>
							<button class="save-bar-reset" onclick={resetProfile}>Reset</button>
							<button class="save-bar-save" onclick={submitProfile} disabled={profileSaving}>
								{profileSaving ? 'Saving...' : 'Save Changes'}
							</button>
						</div>
					{/if}
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
				{:else if activeTab === 'notifications'}
					<div class="settings-section">
						<h3 class="section-title">Notification Sounds</h3>
						<label class="toggle-row">
							<input type="checkbox" class="toggle-checkbox" bind:checked={appSettings.notificationSoundsEnabled} />
							<div class="toggle-info">
								<span class="toggle-label">Enable notification sounds</span>
								<span class="toggle-hint">Play a sound when you receive mentions, DMs, or messages.</span>
							</div>
						</label>
						{#if appSettings.notificationSoundsEnabled}
							<div class="volume-row">
								<span class="volume-label">Volume</span>
								<input
									type="range"
									class="volume-slider"
									min="0"
									max="100"
									step="1"
									bind:value={appSettings.notificationVolume}
								/>
								<span class="volume-value">{appSettings.notificationVolume}%</span>
							</div>
						{/if}
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Desktop Notifications</h3>
						<label class="toggle-row">
							<input type="checkbox" class="toggle-checkbox" bind:checked={appSettings.desktopNotificationsEnabled} />
							<div class="toggle-info">
								<span class="toggle-label">Enable desktop notifications</span>
								<span class="toggle-hint">Show system notifications when the window is unfocused.</span>
							</div>
						</label>
						{#if appSettings.desktopNotificationsEnabled && notifPermission !== 'granted'}
							<div class="notif-permission-row">
								{#if notifPermission === 'denied'}
									<p class="setting-hint" style="color: var(--danger)">Notification permission was denied. Please enable it in your browser settings.</p>
								{:else}
									<button class="settings-save-btn" onclick={handleRequestNotifPermission}>
										Allow Notifications
									</button>
									<p class="setting-hint">Browser permission is required for desktop notifications.</p>
								{/if}
							</div>
						{/if}
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Default Notification Level</h3>
						<p class="setting-hint">Controls notifications for all channels unless overridden below.</p>
						<div class="notif-level-options">
							{#each notificationLevelOptions as opt (opt.value)}
								<button
									class="notif-level-option"
									class:active={getNotificationLevel('*') === opt.value}
									onclick={() => setNotificationLevel('*', opt.value)}
								>
									<span class="notif-level-label">{opt.label}</span>
									<span class="notif-level-desc">{opt.desc}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Per-Channel Overrides</h3>
						<p class="setting-hint">Override the default notification level for specific channels.</p>
						{#if joinedChannels.length === 0}
							<p class="setting-hint" style="font-style: italic;">No channels joined yet.</p>
						{:else}
							<div class="notif-channel-list">
								{#each joinedChannels as channel (channel)}
									<div class="notif-channel-row">
										<span class="notif-channel-name">{channel}</span>
										<select
											class="notif-channel-select"
											value={getNotificationLevel(channel)}
											onchange={(e: Event) => {
												const target = e.target as HTMLSelectElement;
												setNotificationLevel(channel, target.value as NotificationLevel);
											}}
										>
											{#each notificationLevelOptions as opt (opt.value)}
												<option value={opt.value}>{opt.label}</option>
											{/each}
										</select>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{:else if activeTab === 'appearance'}
					<div class="settings-section">
						<h3 class="section-title">Theme</h3>
						<p class="setting-hint">Choose how accord looks. Your theme is the base; server themes layer on top.</p>
						<div class="theme-options">
							{#each themeOptions as opt (opt.value)}
								<button
									class="theme-option"
									class:active={themeState.current === opt.value}
									onclick={() => setTheme(opt.value)}
								>
									<span class="theme-option-label">{opt.label}</span>
									<span class="theme-option-desc">{opt.desc}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">Server Themes</h3>
						<p class="setting-hint">Servers can customize colors. Disable server themes if you prefer your own.</p>

						{#if themeState.contrastWarning}
							<div class="contrast-warning">
								<span class="contrast-warning-text">{themeState.contrastWarning}</span>
								<div class="contrast-warning-actions">
									<button class="contrast-warning-btn" onclick={() => dismissContrastWarning()}>Dismiss</button>
									<button class="contrast-warning-btn danger" onclick={() => setServerThemesDisabled(true)}>Disable Server Themes</button>
								</div>
							</div>
						{/if}

						<label class="toggle-row">
							<input
								type="checkbox"
								class="toggle-checkbox"
								checked={themeState.serverThemesDisabled}
								onchange={(e) => setServerThemesDisabled(e.currentTarget.checked)}
							/>
							<div class="toggle-info">
								<span class="toggle-label">Disable all server themes</span>
								<span class="toggle-hint">Ignore color customizations from all servers.</span>
							</div>
						</label>

						{#if !themeState.serverThemesDisabled && serverState.servers.length > 0}
							<div class="per-server-toggles">
								<p class="setting-hint">Disable themes for specific servers:</p>
								{#each serverState.servers as server (server.id)}
									<label class="toggle-row">
										<input
											type="checkbox"
											class="toggle-checkbox"
											checked={isServerThemeDisabled(server.id)}
											onchange={(e) => setServerThemeDisabled(server.id, e.currentTarget.checked)}
										/>
										<div class="toggle-info">
											<span class="toggle-label">{server.name || server.id}</span>
										</div>
									</label>
								{/each}
							</div>
						{/if}
					</div>

					<div class="section-divider"></div>

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

					<div class="section-divider"></div>

					<div class="settings-section">
						<h3 class="section-title">System Messages</h3>
						<p class="setting-hint">Controls visibility of join, part, quit, nick, and mode events. 3+ consecutive events are collapsed automatically.</p>
						<div class="sysmsg-options">
							{#each systemMsgOptions as opt (opt.value)}
								<button
									class="sysmsg-option"
									class:active={appSettings.systemMessageDisplay === opt.value}
									onclick={() => appSettings.systemMessageDisplay = opt.value}
								>
									<span class="sysmsg-option-label">{opt.label}</span>
									<span class="sysmsg-option-desc">{opt.desc}</span>
								</button>
							{/each}
						</div>
					</div>
				{:else if activeTab === 'keybindings'}
				<div class="settings-section">
					<p class="setting-hint">Click Edit to rebind a shortcut. Press a new key combination, or Escape to cancel.</p>
					<table class="keybindings-table">
						<thead>
							<tr>
								<th class="kb-col-action">Action</th>
								<th class="kb-col-shortcut">Shortcut</th>
								<th class="kb-col-edit"></th>
							</tr>
						</thead>
						<tbody>
							{#each keybindingsList as binding (binding.description)}
								<tr class="kb-row" class:recording={recordingAction === binding.description}>
									<td class="kb-action">{binding.description}</td>
									<td class="kb-shortcut">
										{#if recordingAction === binding.description}
											<span class="kb-recording-label">Press a key combo...</span>
										{:else}
											<kbd class="kb-key">{formatCombo(binding.currentCombo)}</kbd>
											{#if binding.currentCombo.key !== binding.defaultCombo.key || binding.currentCombo.ctrl !== binding.defaultCombo.ctrl || binding.currentCombo.alt !== binding.defaultCombo.alt || binding.currentCombo.shift !== binding.defaultCombo.shift}
												<span class="kb-custom-badge">custom</span>
											{/if}
										{/if}
									</td>
									<td class="kb-edit-cell">
										{#if recordingAction === binding.description}
											<button class="kb-cancel-btn" onclick={cancelRecording}>Cancel</button>
										{:else}
											<button class="kb-edit-btn" onclick={() => startRecording(binding.description)}>Edit</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				{#if keybindingsList.length === 0}
					<p class="setting-hint">No keyboard shortcuts registered. Open a chat channel first to load shortcuts.</p>
				{/if}

				<div class="section-divider"></div>

				<div class="settings-section">
					<button
						class="reset-defaults-btn"
						onclick={handleResetAllBindings}
						disabled={!hasCustomBindings()}
					>
						Reset to Defaults
					</button>
				</div>
			{:else if activeTab === 'advanced'}
				<div class="settings-section">
					<h3 class="section-title">Debug</h3>
					<label class="toggle-row">
						<input type="checkbox" class="toggle-checkbox" bind:checked={appSettings.showRawIrc} />
						<div class="toggle-info">
							<span class="toggle-label">Show Raw IRC Messages</span>
							<span class="toggle-hint">Display a debug panel showing raw IRC protocol lines as they are sent and received.</span>
						</div>
					</label>
				</div>

				<div class="section-divider"></div>

				<div class="settings-section">
					<h3 class="section-title">Developer</h3>
					<label class="toggle-row">
						<input type="checkbox" class="toggle-checkbox" bind:checked={appSettings.developerMode} />
						<div class="toggle-info">
							<span class="toggle-label">Enable Developer Mode</span>
							<span class="toggle-hint">Show message IDs in tooltips and other internal details.</span>
						</div>
					</label>
				</div>
			{:else if activeTab === 'about'}
					<div class="about-section">
						<div class="about-logo">accord</div>
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
		display: flex;
		align-items: center;
		justify-content: center;
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
		color: var(--text-inverse);
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

	/* ---- Save Bar (sticky unsaved-changes banner) ---- */

	.save-bar {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: var(--surface-high);
		border-top: 1px solid var(--surface-highest);
		border-radius: 0 0 8px 8px;
		animation: save-bar-slide-up 150ms ease-out;
	}

	@keyframes save-bar-slide-up {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.save-bar-hint {
		flex: 1;
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.save-bar-reset {
		padding: 6px 16px;
		background: none;
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		color: var(--text-secondary);
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		cursor: pointer;
	}

	.save-bar-reset:hover {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	.save-bar-save {
		padding: 6px 16px;
		background: var(--accent-primary);
		border: none;
		border-radius: 4px;
		color: var(--text-inverse);
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background var(--duration-channel);
	}

	.save-bar-save:hover:not(:disabled) {
		filter: brightness(0.9);
	}

	.save-bar-save:disabled {
		opacity: 0.6;
		cursor: default;
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
		background: var(--text-inverse);
	}

	.toggle-label {
		font-size: var(--font-sm);
		color: var(--text-secondary);
	}

	.toggle-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.toggle-hint {
		font-size: var(--font-xs);
		color: var(--text-muted);
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
		color: var(--text-inverse);
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

	/* ---- Keybindings Tab ---- */

	.keybindings-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-sm);
	}

	.keybindings-table th {
		text-align: left;
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 6px 8px;
		border-bottom: 1px solid var(--surface-highest);
	}

	.kb-col-action {
		width: 50%;
	}

	.kb-col-shortcut {
		width: 35%;
	}

	.kb-col-edit {
		width: 15%;
		text-align: right;
	}

	.kb-row {
		border-bottom: 1px solid var(--surface-high);
		transition: background var(--duration-channel);
	}

	.kb-row:hover {
		background: var(--surface-high);
	}

	.kb-row.recording {
		background: var(--accent-bg);
	}

	.kb-action {
		padding: 10px 8px;
		color: var(--text-primary);
	}

	.kb-shortcut {
		padding: 10px 8px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.kb-key {
		display: inline-block;
		padding: 2px 8px;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-family: var(--font-mono);
		font-size: var(--font-xs);
		color: var(--text-primary);
	}

	.kb-custom-badge {
		font-size: 10px;
		color: var(--accent-primary);
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.kb-recording-label {
		color: var(--accent-primary);
		font-style: italic;
		animation: pulse-border 1s ease-in-out infinite;
	}

	.kb-edit-cell {
		padding: 10px 8px;
		text-align: right;
	}

	.kb-edit-btn {
		padding: 2px 12px;
		background: var(--surface-high);
		color: var(--text-secondary);
		border: none;
		border-radius: 3px;
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		cursor: pointer;
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.kb-edit-btn:hover {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.kb-cancel-btn {
		padding: 2px 12px;
		background: none;
		color: var(--text-muted);
		border: none;
		border-radius: 3px;
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		cursor: pointer;
	}

	.kb-cancel-btn:hover {
		color: var(--text-primary);
	}

	.reset-defaults-btn {
		padding: 8px 20px;
		background: var(--surface-high);
		color: var(--text-secondary);
		border: none;
		border-radius: 4px;
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.reset-defaults-btn:hover:not(:disabled) {
		background: var(--surface-highest);
		color: var(--text-primary);
	}

	.reset-defaults-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* ---- Account Tab: Email & Password Forms ---- */

	.account-form-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.settings-input {
		flex: 1;
		padding: 8px 12px;
		background: var(--surface-lowest);
		color: var(--text-primary);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		outline: none;
	}

	.settings-input:focus {
		border-color: var(--accent-primary);
	}

	.settings-save-btn {
		padding: 8px 20px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		border: none;
		border-radius: 4px;
		font-size: var(--font-sm);
		font-family: var(--font-primary);
		font-weight: var(--weight-medium);
		cursor: pointer;
		flex-shrink: 0;
	}

	.settings-save-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.settings-save-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.password-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-error {
		font-size: var(--font-xs);
		color: var(--danger);
	}

	.form-success {
		font-size: var(--font-xs);
		color: var(--success);
	}

	/* ---- Notifications Tab: Sound & Desktop ---- */

	.volume-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.volume-label {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		min-width: 48px;
	}

	.volume-slider {
		flex: 1;
		height: 4px;
		appearance: none;
		background: var(--surface-highest);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--accent-primary);
		cursor: pointer;
	}

	.volume-slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--accent-primary);
		border: none;
		cursor: pointer;
	}

	.volume-value {
		font-size: var(--font-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
		min-width: 36px;
		text-align: right;
	}

	.notif-permission-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* ---- Notifications Tab ---- */

	.notif-level-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.notif-level-option {
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

	.notif-level-option:hover {
		background: var(--surface-high);
	}

	.notif-level-option.active {
		border-color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.notif-level-label {
		font-size: var(--font-base);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}

	.notif-level-desc {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

	.notif-channel-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.notif-channel-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--surface-low);
		border-radius: 4px;
	}

	.notif-channel-name {
		font-size: var(--font-sm);
		color: var(--text-primary);
		font-family: var(--font-mono);
	}

	.notif-channel-select {
		padding: 4px 8px;
		background: var(--surface-lowest);
		color: var(--text-primary);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3e%3cpath d='M3 4.5l3 3 3-3' stroke='%239a9da3' fill='none' stroke-width='1.5' stroke-linecap='round'/%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 6px center;
		padding-right: 24px;
	}

	.notif-channel-select:hover {
		border-color: var(--text-muted);
	}

	.notif-channel-select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	/* ---- Appearance Tab ---- */

	.theme-options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.theme-option {
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

	.theme-option:hover {
		background: var(--surface-high);
	}

	.theme-option.active {
		border-color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.theme-option-label {
		font-size: var(--font-base);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}

	.theme-option-desc {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

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

	/* ---- System Messages ---- */

	.sysmsg-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sysmsg-option {
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

	.sysmsg-option:hover {
		background: var(--surface-high);
	}

	.sysmsg-option.active {
		border-color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.sysmsg-option-label {
		font-size: var(--font-base);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}

	.sysmsg-option-desc {
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

	/* ---- Profile Edit ---- */

	.profile-edit-avatar-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.profile-edit-avatar-preview {
		flex-shrink: 0;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.profile-edit-avatar-img {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
	}

	.profile-edit-avatar-actions {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.hidden-file-input {
		display: none;
	}

	.settings-textarea {
		width: 100%;
		padding: 8px 12px;
		background: var(--surface-lowest);
		color: var(--text-primary);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		outline: none;
		resize: vertical;
		min-height: 60px;
	}

	.settings-textarea:focus {
		border-color: var(--accent-primary);
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

	/* ---- Server theme toggles ---- */

	.contrast-warning {
		background: color-mix(in srgb, var(--warning) 15%, var(--surface-base));
		border: 1px solid var(--warning);
		border-radius: var(--radius-md);
		padding: 10px 14px;
		margin-bottom: 12px;
	}

	.contrast-warning-text {
		font-size: var(--font-sm);
		color: var(--text-primary);
		display: block;
		margin-bottom: 8px;
	}

	.contrast-warning-actions {
		display: flex;
		gap: 8px;
	}

	.contrast-warning-btn {
		padding: 4px 12px;
		font-size: var(--font-xs);
		border-radius: var(--radius-sm);
		border: 1px solid var(--interactive-muted);
		background: var(--surface-high);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.contrast-warning-btn:hover {
		background: var(--surface-highest);
	}

	.contrast-warning-btn.danger {
		background: var(--danger);
		color: var(--text-inverse);
		border-color: var(--danger);
	}

	.contrast-warning-btn.danger:hover {
		filter: brightness(1.1);
	}

	.per-server-toggles {
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
