import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { changePassword, changeEmail } from './account';

describe('changePassword', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn();
		vi.stubGlobal('fetch', mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends password change request with correct payload', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});

		const result = await changePassword('https://files.example.com', 'jwt-token', {
			currentPassword: 'old-pass',
			newPassword: 'new-pass',
		});

		expect(result).toEqual({ success: true });
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://files.example.com/api/account/password');
		expect(options.method).toBe('POST');
		expect(options.headers['Authorization']).toBe('Bearer jwt-token');
		expect(JSON.parse(options.body)).toEqual({
			currentPassword: 'old-pass',
			newPassword: 'new-pass',
		});
	});

	it('returns error on 403 (wrong current password)', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 403,
			json: () => Promise.resolve({ error: 'Current password is incorrect' }),
		});

		const result = await changePassword('https://files.example.com', 'token', {
			currentPassword: 'wrong',
			newPassword: 'new-pass',
		});

		expect(result.success).toBe(false);
		expect(result.error).toBe('Current password is incorrect');
	});

	it('returns error on network failure', async () => {
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		const result = await changePassword('https://files.example.com', 'token', {
			currentPassword: 'old',
			newPassword: 'new',
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Network error');
	});

	it('strips trailing slash from filesUrl', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});

		await changePassword('https://files.example.com/', 'token', {
			currentPassword: 'old',
			newPassword: 'new',
		});

		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe('https://files.example.com/api/account/password');
	});

	it('handles non-JSON error responses', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			json: () => Promise.reject(new Error('not json')),
		});

		const result = await changePassword('https://files.example.com', 'token', {
			currentPassword: 'old',
			newPassword: 'new',
		});

		expect(result.success).toBe(false);
		expect(result.error).toBe('Unknown error');
	});
});

describe('changeEmail', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn();
		vi.stubGlobal('fetch', mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends email change request with correct payload', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});

		const result = await changeEmail('https://files.example.com', 'jwt-token', {
			email: 'new@example.com',
		});

		expect(result).toEqual({ success: true });
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://files.example.com/api/account/email');
		expect(options.method).toBe('POST');
		expect(options.headers['Authorization']).toBe('Bearer jwt-token');
		expect(JSON.parse(options.body)).toEqual({ email: 'new@example.com' });
	});

	it('returns error on 400 (invalid email)', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			json: () => Promise.resolve({ error: 'Invalid email format' }),
		});

		const result = await changeEmail('https://files.example.com', 'token', {
			email: 'bad',
		});

		expect(result.success).toBe(false);
		expect(result.error).toBe('Invalid email format');
	});

	it('returns error on network failure', async () => {
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		const result = await changeEmail('https://files.example.com', 'token', {
			email: 'test@test.com',
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Network error');
	});

	it('strips trailing slash from filesUrl', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});

		await changeEmail('https://files.example.com/', 'token', {
			email: 'test@test.com',
		});

		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe('https://files.example.com/api/account/email');
	});
});
