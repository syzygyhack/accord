import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listInvites, createInvite, deleteInvite, type InviteSummary } from './invites';

describe('invites API', () => {
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

	describe('listInvites', () => {
		it('fetches invites with auth header', async () => {
			const invites: InviteSummary[] = [
				{ token: 'abc123', channel: '#general', createdBy: 'admin', expiresAt: 0, maxUses: 0, useCount: 0, expired: false, maxUsesReached: false },
			];
			fetchMock.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ invites }),
			});

			const result = await listInvites(baseUrl, token);
			expect(result).toEqual(invites);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/invite',
				{ headers: { Authorization: 'Bearer jwt-token-123' } },
			);
		});

		it('returns empty array on error', async () => {
			fetchMock.mockResolvedValue({ ok: false });
			const result = await listInvites(baseUrl, token);
			expect(result).toEqual([]);
		});

		it('returns empty array on network failure', async () => {
			fetchMock.mockRejectedValue(new Error('Network error'));
			const result = await listInvites(baseUrl, token);
			expect(result).toEqual([]);
		});
	});

	describe('createInvite', () => {
		it('posts invite and returns result', async () => {
			const response = { token: 'xyz789', url: '/join/srv/xyz789', channel: '#general', expiresAt: 0, maxUses: 0 };
			fetchMock.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(response),
			});

			const result = await createInvite(baseUrl, token, '#general');
			expect(result).toEqual(response);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/invite',
				{
					method: 'POST',
					headers: {
						Authorization: 'Bearer jwt-token-123',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ channel: '#general' }),
				},
			);
		});

		it('passes optional expiresIn and maxUses', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: 'a', url: '/join/s/a', channel: '#dev', expiresAt: 1000, maxUses: 10 }),
			});

			await createInvite(baseUrl, token, '#dev', '1d', 10);
			const call = fetchMock.mock.calls[0];
			const body = JSON.parse(call[1].body);
			expect(body.expiresIn).toBe('1d');
			expect(body.maxUses).toBe(10);
		});

		it('throws on error response', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 400,
				text: () => Promise.resolve('Bad request'),
			});

			await expect(createInvite(baseUrl, token, '#bad')).rejects.toThrow('Failed to create invite (400)');
		});
	});

	describe('deleteInvite', () => {
		it('deletes invite by token', async () => {
			fetchMock.mockResolvedValue({ ok: true });

			await deleteInvite(baseUrl, token, 'abc123');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://files.example.com/api/invite/abc123',
				{
					method: 'DELETE',
					headers: { Authorization: 'Bearer jwt-token-123' },
				},
			);
		});

		it('throws on error response', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 403,
				text: () => Promise.resolve('Forbidden'),
			});

			await expect(deleteInvite(baseUrl, token, 'abc123')).rejects.toThrow('Failed to delete invite (403)');
		});
	});
});
