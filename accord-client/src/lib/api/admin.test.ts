import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	checkAdmin,
	fetchStats,
	fetchUsers,
	kickUser,
	banUser,
	fetchAuditLog,
	filterUsers,
	formatUptime,
	type AdminUser,
} from './admin';

describe('admin API', () => {
	const fetchMock = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = fetchMock;
		fetchMock.mockReset();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const baseUrl = 'https://files.example.com';
	const token = 'jwt-token-123';

	describe('checkAdmin', () => {
		it('returns true when endpoint responds 200', async () => {
			fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ admin: true }) });
			expect(await checkAdmin(baseUrl, token)).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/admin/check',
				{ headers: { Authorization: 'Bearer jwt-token-123' } },
			);
		});

		it('returns false when endpoint responds 403', async () => {
			fetchMock.mockResolvedValue({ ok: false, status: 403 });
			expect(await checkAdmin(baseUrl, token)).toBe(false);
		});

		it('returns false on network error', async () => {
			fetchMock.mockRejectedValue(new Error('Network error'));
			expect(await checkAdmin(baseUrl, token)).toBe(false);
		});
	});

	describe('fetchStats', () => {
		it('returns stats on success', async () => {
			const stats = { registeredAccounts: 10, profileCount: 8, channels: 5, uptimeMs: 60000, uptimeSeconds: 60 };
			fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(stats) });
			expect(await fetchStats(baseUrl, token)).toEqual(stats);
		});

		it('returns null on error response', async () => {
			fetchMock.mockResolvedValue({ ok: false });
			expect(await fetchStats(baseUrl, token)).toBeNull();
		});

		it('returns null on network error', async () => {
			fetchMock.mockRejectedValue(new Error('fail'));
			expect(await fetchStats(baseUrl, token)).toBeNull();
		});
	});

	describe('fetchUsers', () => {
		it('returns users on success', async () => {
			const users = [{ account: 'alice', displayName: 'Alice', status: null, updatedAt: 1000 }];
			fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ users, total: 1 }) });
			expect(await fetchUsers(baseUrl, token)).toEqual(users);
		});

		it('returns empty array on error', async () => {
			fetchMock.mockResolvedValue({ ok: false });
			expect(await fetchUsers(baseUrl, token)).toEqual([]);
		});

		it('returns empty array on network failure', async () => {
			fetchMock.mockRejectedValue(new Error('fail'));
			expect(await fetchUsers(baseUrl, token)).toEqual([]);
		});
	});

	describe('kickUser', () => {
		it('sends POST with correct body', async () => {
			fetchMock.mockResolvedValue({ ok: true });
			await kickUser(baseUrl, token, '#general', 'bob', 'spam');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/admin/kick',
				{
					method: 'POST',
					headers: {
						Authorization: 'Bearer jwt-token-123',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ channel: '#general', nick: 'bob', reason: 'spam' }),
				},
			);
		});

		it('omits reason when not provided', async () => {
			fetchMock.mockResolvedValue({ ok: true });
			await kickUser(baseUrl, token, '#general', 'bob');
			const call = fetchMock.mock.calls[0];
			const body = JSON.parse(call[1].body);
			expect(body).toEqual({ channel: '#general', nick: 'bob' });
		});

		it('throws on error response', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 502,
				text: () => Promise.resolve('IRC unavailable'),
			});
			await expect(kickUser(baseUrl, token, '#general', 'bob')).rejects.toThrow('Kick failed (502)');
		});
	});

	describe('banUser', () => {
		it('sends POST with correct body including duration', async () => {
			fetchMock.mockResolvedValue({ ok: true });
			await banUser(baseUrl, token, '#general', 'bob', 'trolling', '7d');
			const call = fetchMock.mock.calls[0];
			const body = JSON.parse(call[1].body);
			expect(body).toEqual({ channel: '#general', nick: 'bob', reason: 'trolling', duration: '7d' });
		});

		it('throws on error response', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 400,
				text: () => Promise.resolve('Bad request'),
			});
			await expect(banUser(baseUrl, token, '#general', 'bob')).rejects.toThrow('Ban failed (400)');
		});
	});

	describe('fetchAuditLog', () => {
		it('fetches with offset and limit', async () => {
			const data = { entries: [], total: 0, offset: 10, limit: 25 };
			fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) });
			const result = await fetchAuditLog(baseUrl, token, 10, 25);
			expect(result).toEqual(data);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/admin/audit?offset=10&limit=25',
				{ headers: { Authorization: 'Bearer jwt-token-123' } },
			);
		});

		it('uses defaults when no offset/limit provided', async () => {
			fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries: [], total: 0, offset: 0, limit: 50 }) });
			await fetchAuditLog(baseUrl, token);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/admin/audit?offset=0&limit=50',
				{ headers: { Authorization: 'Bearer jwt-token-123' } },
			);
		});

		it('returns null on error', async () => {
			fetchMock.mockResolvedValue({ ok: false });
			expect(await fetchAuditLog(baseUrl, token)).toBeNull();
		});
	});
});

describe('filterUsers', () => {
	const users: AdminUser[] = [
		{ account: 'alice', displayName: 'Alice Wonder', status: null, updatedAt: 1000 },
		{ account: 'bob', displayName: null, status: null, updatedAt: 2000 },
		{ account: 'charlie', displayName: 'Charlie Brown', status: 'online', updatedAt: 3000 },
	];

	it('returns all users with empty query', () => {
		expect(filterUsers(users, '')).toEqual(users);
		expect(filterUsers(users, '   ')).toEqual(users);
	});

	it('filters by account name', () => {
		expect(filterUsers(users, 'ali')).toEqual([users[0]]);
	});

	it('filters by display name', () => {
		expect(filterUsers(users, 'brown')).toEqual([users[2]]);
	});

	it('is case-insensitive', () => {
		expect(filterUsers(users, 'ALICE')).toEqual([users[0]]);
	});

	it('returns empty array when no match', () => {
		expect(filterUsers(users, 'zzz')).toEqual([]);
	});
});

describe('formatUptime', () => {
	it('formats seconds to minutes only', () => {
		expect(formatUptime(120)).toBe('2m');
	});

	it('formats hours and minutes', () => {
		expect(formatUptime(3660)).toBe('1h 1m');
	});

	it('formats days, hours, and minutes', () => {
		expect(formatUptime(90061)).toBe('1d 1h 1m');
	});

	it('handles zero', () => {
		expect(formatUptime(0)).toBe('0m');
	});
});
