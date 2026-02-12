<script lang="ts">
	import { goto } from '$app/navigation';
	import { IRCConnection } from '$lib/irc/connection';
	import { negotiateCaps } from '$lib/irc/cap';
	import { authenticateSASL } from '$lib/irc/sasl';
	import { parseMessage } from '$lib/irc/parser';
	import { login } from '$lib/state/user.svelte';
	import { fetchToken, startTokenRefresh } from '$lib/api/auth';
	import {
		setConnecting,
		setConnected,
		setDisconnected,
	} from '$lib/state/connection.svelte';

	let mode: 'login' | 'register' = $state('login');
	let serverUrl = $state('ws://localhost:8097');
	let filesUrl = $state('http://localhost:8080');
	let username = $state('');
	let password = $state('');
	let loading = $state(false);
	let error: string | null = $state(null);
	let statusMessage: string | null = $state(null);

	/**
	* Perform SASL login: connect, negotiate caps, authenticate, store creds,
	* fetch JWT, start refresh, navigate to /chat.
	*/
	async function handleLogin(): Promise<void> {
		if (!username.trim() || !password.trim()) {
			error = 'Username and password are required.';
			return;
		}

		loading = true;
		error = null;
		statusMessage = 'Connecting to server...';

		let conn: IRCConnection | null = null;

		try {
			// 1. Connect via WebSocket
			conn = new IRCConnection({ url: serverUrl });
			setConnecting();
			await conn.connect();
			setConnected();

			// 2. CAP negotiation
			statusMessage = 'Negotiating capabilities...';
			conn.send(`NICK ${username}`);
			conn.send(`USER ${username} 0 * :${username}`);
			await negotiateCaps(conn);

			// 3. SASL PLAIN authentication
			statusMessage = 'Authenticating...';
			await authenticateSASL(conn, username, password);

			// 4. Store credentials in session
			login(username, password);

			// 5. Fetch JWT from virc-files
			statusMessage = 'Fetching session token...';
			await fetchToken(filesUrl, username, password);

			// 6. Start JWT refresh timer
			startTokenRefresh(filesUrl);

			// 7. Store server URLs for chat page reconnect
			sessionStorage.setItem('virc:serverUrl', serverUrl);
			sessionStorage.setItem('virc:filesUrl', filesUrl);

			// 8. Disconnect this temporary connection (chat page will create its own)
			conn.disconnect();

			// 9. Navigate to /chat
			await goto('/chat');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			statusMessage = null;
			setDisconnected(msg);

			if (conn) {
				try {
					conn.disconnect();
				} catch {
					// ignore cleanup errors
				}
			}
		} finally {
			loading = false;
		}
	}

	/**
	* Register flow: connect, negotiate caps, send NS REGISTER, wait for
	* confirmation, then perform SASL login with the new account.
	*/
	async function handleRegister(): Promise<void> {
		if (!username.trim() || !password.trim()) {
			error = 'Username and password are required.';
			return;
		}

		loading = true;
		error = null;
		statusMessage = 'Connecting to server...';

		let conn: IRCConnection | null = null;

		try {
			// 1. Connect via WebSocket
			conn = new IRCConnection({ url: serverUrl });
			setConnecting();
			await conn.connect();
			setConnected();

			// 2. CAP negotiation + NICK/USER registration
			statusMessage = 'Negotiating capabilities...';
			conn.send(`NICK ${username}`);
			conn.send(`USER ${username} 0 * :${username}`);
			await negotiateCaps(conn);

			// 3. End CAP negotiation (no SASL yet for registration)
			conn.send('CAP END');

			// 4. Wait for welcome (001) before sending NickServ command
			statusMessage = 'Waiting for server welcome...';
			await waitForWelcome(conn);

			// 5. Register via NickServ
			statusMessage = 'Registering account...';
			conn.send(`NS REGISTER ${password}`);
			await waitForRegistration(conn);

			// 6. Disconnect and reconnect for SASL login
			statusMessage = 'Registration successful. Logging in...';
			conn.disconnect();

			// 7. Now do the normal SASL login flow
			conn = new IRCConnection({ url: serverUrl });
			setConnecting();
			await conn.connect();
			setConnected();

			statusMessage = 'Negotiating capabilities...';
			conn.send(`NICK ${username}`);
			conn.send(`USER ${username} 0 * :${username}`);
			await negotiateCaps(conn);

			statusMessage = 'Authenticating...';
			await authenticateSASL(conn, username, password);

			login(username, password);

			statusMessage = 'Fetching session token...';
			await fetchToken(filesUrl, username, password);
			startTokenRefresh(filesUrl);

			sessionStorage.setItem('virc:serverUrl', serverUrl);
			sessionStorage.setItem('virc:filesUrl', filesUrl);

			conn.disconnect();
			await goto('/chat');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			statusMessage = null;
			setDisconnected(msg);

			if (conn) {
				try {
					conn.disconnect();
				} catch {
					// ignore cleanup errors
				}
			}
		} finally {
			loading = false;
		}
	}

	/**
	* Wait for RPL_WELCOME (001) from the server, indicating connection registration
	* is complete and we can send NickServ commands.
	*/
	function waitForWelcome(conn: IRCConnection): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				conn.off('message', handler);
				reject(new Error('Timed out waiting for server welcome'));
			}, 15_000);

			function handler(line: string): void {
				const msg = parseMessage(line);

				// 001 = RPL_WELCOME
				if (msg.command === '001') {
					clearTimeout(timeout);
					conn.off('message', handler);
					resolve();
				}

				// 432 = ERR_ERRONEUSNICKNAME, 433 = ERR_NICKNAMEINUSE, 436 = ERR_NICKCOLLISION
				if (msg.command === '432' || msg.command === '433' || msg.command === '436') {
					clearTimeout(timeout);
					conn.off('message', handler);
					const reason = msg.params[msg.params.length - 1] || 'Nickname error';
					reject(new Error(reason));
				}
			}

			conn.on('message', handler);
		});
	}

	/**
	* Wait for NickServ registration confirmation or failure.
	* Ergo sends a NOTICE from NickServ with the result.
	*/
	function waitForRegistration(conn: IRCConnection): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				conn.off('message', handler);
				reject(new Error('Timed out waiting for registration confirmation'));
			}, 15_000);

			function handler(line: string): void {
				const msg = parseMessage(line);

				// NickServ responses come as NOTICE from NickServ
				if (msg.command !== 'NOTICE') return;

				const text = msg.params[msg.params.length - 1] || '';
				const lowerText = text.toLowerCase();

				// Check for NickServ source
				const fromNickServ =
					msg.source?.nick === 'NickServ' ||
					msg.prefix === 'NickServ' ||
					msg.prefix?.startsWith('NickServ!');

				if (!fromNickServ) return;

				if (
					lowerText.includes('account created') ||
					lowerText.includes('registered') ||
					lowerText.includes('you have been successfully')
				) {
					clearTimeout(timeout);
					conn.off('message', handler);
					resolve();
				}

				if (
					lowerText.includes('already registered') ||
					lowerText.includes('already taken') ||
					lowerText.includes('not available') ||
					lowerText.includes('error') ||
					lowerText.includes('invalid')
				) {
					clearTimeout(timeout);
					conn.off('message', handler);
					reject(new Error(text));
				}
			}

			conn.on('message', handler);
		});
	}

	function handleSubmit(): void {
		if (mode === 'login') {
			handleLogin();
		} else {
			handleRegister();
		}
	}
</script>

<div class="login-page">
	<div class="login-card">
		<h1 class="title">virc</h1>
		<p class="subtitle">
			{mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
		</p>

		<div class="mode-toggle">
			<button
				class="mode-button"
				class:active={mode === 'login'}
				disabled={loading}
				onclick={() => { mode = 'login'; error = null; }}
			>
				Login
			</button>
			<button
				class="mode-button"
				class:active={mode === 'register'}
				disabled={loading}
				onclick={() => { mode = 'register'; error = null; }}
			>
				Register
			</button>
		</div>

		<form onsubmit={e => { e.preventDefault(); handleSubmit(); }}>
			<div class="field">
				<label for="server-url">Server URL</label>
				<input
					id="server-url"
					type="text"
					bind:value={serverUrl}
					disabled={loading}
					placeholder="ws://localhost:8097"
				/>
			</div>

			<div class="field">
				<label for="files-url">Files Server URL</label>
				<input
					id="files-url"
					type="text"
					bind:value={filesUrl}
					disabled={loading}
					placeholder="http://localhost:8080"
				/>
			</div>

			<div class="field">
				<label for="username">Username</label>
				<input
					id="username"
					type="text"
					bind:value={username}
					disabled={loading}
					autocomplete="username"
				/>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					disabled={loading}
					autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
				/>
			</div>

			{#if error}
				<div class="error" role="alert">{error}</div>
			{/if}

			{#if statusMessage && loading}
				<div class="status">{statusMessage}</div>
			{/if}

			<button type="submit" class="submit-button" disabled={loading}>
				{#if loading}
					<span class="spinner"></span>
					{statusMessage ?? 'Working...'}
				{:else}
					{mode === 'login' ? 'Sign In' : 'Create Account'}
				{/if}
			</button>
		</form>
	</div>
</div>

<style>
	.login-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--surface-lowest);
		padding: 1rem;
	}

	.login-card {
		width: 100%;
		max-width: 400px;
		background: var(--surface-base);
		border-radius: 8px;
		padding: 2rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
	}

	.title {
		font-size: var(--font-xl);
		font-weight: var(--weight-bold);
		color: var(--accent-primary);
		text-align: center;
		margin-bottom: 0.25rem;
		font-family: var(--font-mono);
	}

	.subtitle {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.mode-toggle {
		display: flex;
		gap: 0;
		margin-bottom: 1.5rem;
		background: var(--surface-low);
		border-radius: 6px;
		padding: 3px;
	}

	.mode-button {
		flex: 1;
		padding: 0.5rem 1rem;
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		font-family: var(--font-primary);
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: background var(--duration-channel), color var(--duration-channel);
	}

	.mode-button:hover:not(:disabled) {
		color: var(--text-primary);
	}

	.mode-button.active {
		background: var(--surface-high);
		color: var(--text-primary);
	}

	.mode-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.field label {
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.field input {
		padding: 0.625rem 0.75rem;
		font-size: var(--font-base);
		font-family: var(--font-primary);
		color: var(--text-primary);
		background: var(--surface-low);
		border: 1px solid var(--interactive-muted);
		border-radius: 4px;
		outline: none;
		transition: border-color var(--duration-channel);
	}

	.field input:focus {
		border-color: var(--accent-primary);
	}

	.field input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.field input::placeholder {
		color: var(--text-muted);
	}

	.error {
		padding: 0.625rem 0.75rem;
		font-size: var(--font-sm);
		color: #fff;
		background: var(--danger);
		border-radius: 4px;
	}

	.status {
		padding: 0.5rem 0.75rem;
		font-size: var(--font-sm);
		color: var(--text-secondary);
		background: var(--accent-bg);
		border-radius: 4px;
		text-align: center;
	}

	.submit-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		font-size: var(--font-base);
		font-weight: var(--weight-medium);
		font-family: var(--font-primary);
		color: var(--text-inverse);
		background: var(--accent-primary);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: background var(--duration-channel);
		margin-top: 0.5rem;
	}

	.submit-button:hover:not(:disabled) {
		background: var(--accent-secondary);
	}

	.submit-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--text-inverse);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
