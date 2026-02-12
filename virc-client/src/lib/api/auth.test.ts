import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isAuthenticated,
	storeCredentials,
	getCredentials,
	clearCredentials,
	fetchToken,
	getToken,
	startTokenRefresh,
	stopTokenRefresh,
	clearToken,
} from './auth';

/**
 * Minimal sessionStorage mock — vitest runs in Node where sessionStorage
 * is not available by default.
 */
function createSessionStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() {
			return store.size;
		},
		key: (_index: number) => null,
	} as Storage;
}

describe('credential helpers', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = createSessionStorageMock();
		vi.stubGlobal('sessionStorage', storage);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports not authenticated when no credentials stored', () => {
		expect(isAuthenticated()).toBe(false);
	});

	it('stores and retrieves credentials', () => {
		storeCredentials({ account: 'alice', password: 'hunter2' });
		expect(isAuthenticated()).toBe(true);

		const creds = getCredentials();
		expect(creds).toEqual({ account: 'alice', password: 'hunter2' });
	});

	it('clears credentials on clearCredentials()', () => {
		storeCredentials({ account: 'alice', password: 'hunter2' });
		clearCredentials();
		expect(isAuthenticated()).toBe(false);
		expect(getCredentials()).toBeNull();
	});
});

describe('JWT management', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		clearToken();
	});

	afterEach(() => {
		stopTokenRefresh();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('getToken() returns null before any fetch', () => {
		expect(getToken()).toBeNull();
	});

	it('fetchToken() calls POST /api/auth and stores the token', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: 'jwt-abc-123' }),
		});
		vi.stubGlobal('fetch', mockFetch);

		const token = await fetchToken('https://files.example.com', 'alice', 'hunter2');

		expect(token).toBe('jwt-abc-123');
		expect(getToken()).toBe('jwt-abc-123');

		expect(mockFetch).toHaveBeenCalledWith('https://files.example.com/api/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ account: 'alice', password: 'hunter2' }),
		});
	});

	it('fetchToken() throws on non-OK response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: () => Promise.resolve('invalid credentials'),
		});
		vi.stubGlobal('fetch', mockFetch);

		await expect(
			fetchToken('https://files.example.com', 'alice', 'wrong'),
		).rejects.toThrow('Auth failed (401): invalid credentials');
	});

	it('clearToken() removes the in-memory token', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: 'jwt-abc-123' }),
		});
		vi.stubGlobal('fetch', mockFetch);

		await fetchToken('https://files.example.com', 'alice', 'hunter2');
		expect(getToken()).toBe('jwt-abc-123');

		clearToken();
		expect(getToken()).toBeNull();
	});

	it('startTokenRefresh() re-fetches token every 50 minutes', async () => {
		const storage = createSessionStorageMock();
		vi.stubGlobal('sessionStorage', storage);

		storeCredentials({ account: 'alice', password: 'hunter2' });

		let callCount = 0;
		const mockFetch = vi.fn().mockImplementation(() => {
			callCount++;
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ token: `jwt-refresh-${callCount}` }),
			});
		});
		vi.stubGlobal('fetch', mockFetch);

		startTokenRefresh('https://files.example.com');

		// No immediate call
		expect(mockFetch).not.toHaveBeenCalled();

		// Advance 50 minutes
		await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(getToken()).toBe('jwt-refresh-1');

		// Advance another 50 minutes
		await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(getToken()).toBe('jwt-refresh-2');
	});

	it('stopTokenRefresh() cancels the timer', async () => {
		const storage = createSessionStorageMock();
		vi.stubGlobal('sessionStorage', storage);

		storeCredentials({ account: 'alice', password: 'hunter2' });

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: 'jwt-new' }),
		});
		vi.stubGlobal('fetch', mockFetch);

		startTokenRefresh('https://files.example.com');
		stopTokenRefresh();

		await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
		expect(mockFetch).not.toHaveBeenCalled();
	});
});
