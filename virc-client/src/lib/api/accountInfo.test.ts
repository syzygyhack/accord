import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	fetchAccountInfo,
	clearAccountInfoCache,
	getCachedAccountInfo,
	type AccountInfo,
} from './accountInfo';

describe('fetchAccountInfo', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn();
		vi.stubGlobal('fetch', mockFetch);
		clearAccountInfoCache();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('fetches account info with auth header', async () => {
		const info: AccountInfo = {
			accountName: 'alice',
			registeredAt: '2026-01-15T10:30:00.000Z',
		};

		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(info),
		});

		const result = await fetchAccountInfo('alice', 'jwt-token', 'https://files.example.com');

		expect(result).toEqual(info);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://files.example.com/api/account-info?account=alice');
		expect(options.headers['Authorization']).toBe('Bearer jwt-token');
	});

	it('returns null when server returns error', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 404,
		});

		const result = await fetchAccountInfo('unknown', 'token', 'https://files.example.com');
		expect(result).toBeNull();
	});

	it('returns null on network error', async () => {
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		const result = await fetchAccountInfo('alice', 'token', 'https://files.example.com');
		expect(result).toBeNull();
	});

	it('caches results and does not re-fetch', async () => {
		const info: AccountInfo = {
			accountName: 'bob',
			registeredAt: '2025-06-01T00:00:00.000Z',
		};

		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(info),
		});

		const result1 = await fetchAccountInfo('bob', 'token', 'https://files.example.com');
		const result2 = await fetchAccountInfo('bob', 'token', 'https://files.example.com');

		expect(result1).toEqual(info);
		expect(result2).toEqual(info);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('caches null results to prevent re-fetching failures', async () => {
		mockFetch.mockResolvedValue({ ok: false, status: 404 });

		await fetchAccountInfo('gone', 'token', 'https://files.example.com');
		await fetchAccountInfo('gone', 'token', 'https://files.example.com');

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('strips trailing slash from filesUrl', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					accountName: 'alice',
					registeredAt: '2026-01-15T10:30:00.000Z',
				}),
		});

		await fetchAccountInfo('alice', 'token', 'https://files.example.com/');

		const [url] = mockFetch.mock.calls[0];
		expect(url).toContain('https://files.example.com/api/account-info');
		expect(url).not.toContain('//api/account-info');
	});

	it('encodes account name in URL', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					accountName: 'user with spaces',
					registeredAt: '2026-01-15T10:30:00.000Z',
				}),
		});

		await fetchAccountInfo('user with spaces', 'token', 'https://files.example.com');

		const [url] = mockFetch.mock.calls[0];
		expect(url).toContain('account=user%20with%20spaces');
	});
});

describe('getCachedAccountInfo', () => {
	beforeEach(() => {
		clearAccountInfoCache();
	});

	it('returns undefined for uncached accounts', () => {
		expect(getCachedAccountInfo('nobody')).toBeUndefined();
	});
});

describe('formatRegisteredDate', () => {
	// Import at test level to keep tests co-located
	it('formats ISO date as human-readable', async () => {
		const { formatRegisteredDate } = await import('./accountInfo');
		expect(formatRegisteredDate('2026-01-15T10:30:00.000Z')).toBe('Jan 15, 2026');
	});

	it('formats another date correctly', async () => {
		const { formatRegisteredDate } = await import('./accountInfo');
		expect(formatRegisteredDate('2025-12-25T00:00:00.000Z')).toBe('Dec 25, 2025');
	});

	it('returns null for invalid date', async () => {
		const { formatRegisteredDate } = await import('./accountInfo');
		expect(formatRegisteredDate('not-a-date')).toBeNull();
	});

	it('returns null for empty string', async () => {
		const { formatRegisteredDate } = await import('./accountInfo');
		expect(formatRegisteredDate('')).toBeNull();
	});
});
