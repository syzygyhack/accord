import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	getProfile,
	getAllProfiles,
	setProfile,
	resetProfiles,
	fetchProfile,
	fetchAllProfiles,
	updateProfile,
	uploadAvatar,
	resolveAvatarUrl,
	type UserProfile,
} from './profiles.svelte';

// Mock dependencies
vi.mock('$lib/api/auth', () => ({
	getToken: vi.fn(() => 'test-jwt-token'),
}));

vi.mock('$lib/state/servers.svelte', () => ({
	getActiveServer: vi.fn(() => ({
		id: 'default',
		name: 'Test Server',
		url: 'ws://localhost:8097',
		filesUrl: 'http://localhost:8098',
		icon: null,
	})),
}));

vi.mock('$lib/utils/url', () => ({
	normalizeBaseUrl: (url: string) => url.replace(/\/+$/, ''),
}));

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
	return {
		account: overrides.account ?? 'alice',
		displayName: overrides.displayName,
		bio: overrides.bio,
		avatar: overrides.avatar,
		status: overrides.status,
		updatedAt: overrides.updatedAt ?? Date.now(),
	};
}

describe('profiles state', () => {
	beforeEach(() => {
		resetProfiles();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		resetProfiles();
	});

	it('starts with no profiles', () => {
		expect(getProfile('alice')).toBeNull();
		expect(getAllProfiles()).toEqual([]);
	});

	it('sets and retrieves a profile', () => {
		const profile = makeProfile({ account: 'alice', displayName: 'Alice' });
		setProfile(profile);
		expect(getProfile('alice')).toEqual(profile);
	});

	it('getProfile is case-insensitive', () => {
		setProfile(makeProfile({ account: 'Alice', displayName: 'Alice W' }));
		expect(getProfile('alice')).not.toBeNull();
		expect(getProfile('ALICE')).not.toBeNull();
		expect(getProfile('Alice')).not.toBeNull();
	});

	it('getAllProfiles returns all cached profiles', () => {
		setProfile(makeProfile({ account: 'alice' }));
		setProfile(makeProfile({ account: 'bob' }));
		setProfile(makeProfile({ account: 'charlie' }));
		expect(getAllProfiles()).toHaveLength(3);
	});

	it('overwrites profile on subsequent set', () => {
		setProfile(makeProfile({ account: 'alice', displayName: 'Alice' }));
		setProfile(makeProfile({ account: 'alice', displayName: 'Alice Updated' }));
		expect(getProfile('alice')?.displayName).toBe('Alice Updated');
		expect(getAllProfiles()).toHaveLength(1);
	});

	it('resetProfiles clears all profiles', () => {
		setProfile(makeProfile({ account: 'alice' }));
		setProfile(makeProfile({ account: 'bob' }));
		resetProfiles();
		expect(getProfile('alice')).toBeNull();
		expect(getAllProfiles()).toEqual([]);
	});

	it('handles profile with all optional fields', () => {
		const profile = makeProfile({
			account: 'alice',
			displayName: 'Alice Wonderland',
			bio: 'Hello world',
			avatar: '/api/files/avatars/abc.png',
			status: 'online',
		});
		setProfile(profile);
		const cached = getProfile('alice');
		expect(cached?.displayName).toBe('Alice Wonderland');
		expect(cached?.bio).toBe('Hello world');
		expect(cached?.avatar).toBe('/api/files/avatars/abc.png');
		expect(cached?.status).toBe('online');
	});

	it('handles profile with no optional fields', () => {
		const profile = makeProfile({ account: 'minimal' });
		setProfile(profile);
		const cached = getProfile('minimal');
		expect(cached).not.toBeNull();
		expect(cached?.displayName).toBeUndefined();
		expect(cached?.bio).toBeUndefined();
		expect(cached?.avatar).toBeUndefined();
	});
});

describe('resolveAvatarUrl', () => {
	it('returns null for undefined avatar', () => {
		expect(resolveAvatarUrl(undefined)).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(resolveAvatarUrl('')).toBeNull();
	});

	it('returns absolute URL as-is for http', () => {
		expect(resolveAvatarUrl('http://example.com/avatar.png')).toBe('http://example.com/avatar.png');
	});

	it('returns absolute URL as-is for https', () => {
		expect(resolveAvatarUrl('https://example.com/avatar.png')).toBe('https://example.com/avatar.png');
	});

	it('resolves relative path against filesUrl', () => {
		const result = resolveAvatarUrl('/api/files/avatars/abc.png');
		expect(result).toBe('http://localhost:8098/api/files/avatars/abc.png');
	});
});

describe('fetchProfile', () => {
	beforeEach(() => {
		resetProfiles();
	});

	it('fetches and caches a profile', async () => {
		const mockProfile = makeProfile({ account: 'bob', displayName: 'Bob' });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockProfile),
		}));

		const result = await fetchProfile('bob');
		expect(result).toEqual(mockProfile);
		expect(getProfile('bob')).toEqual(mockProfile);
	});

	it('returns null on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		}));

		const result = await fetchProfile('nonexistent');
		expect(result).toBeNull();
		expect(getProfile('nonexistent')).toBeNull();
	});

	it('returns null on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		const result = await fetchProfile('bob');
		expect(result).toBeNull();
	});

	it('deduplicates concurrent requests for the same account', async () => {
		const mockProfile = makeProfile({ account: 'alice' });
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockProfile),
		});
		vi.stubGlobal('fetch', fetchFn);

		const [r1, r2, r3] = await Promise.all([
			fetchProfile('alice'),
			fetchProfile('alice'),
			fetchProfile('alice'),
		]);

		expect(r1).toEqual(mockProfile);
		expect(r2).toEqual(mockProfile);
		expect(r3).toEqual(mockProfile);
		// Only one fetch call should have been made
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

describe('fetchAllProfiles', () => {
	beforeEach(() => {
		resetProfiles();
	});

	it('fetches and caches multiple profiles', async () => {
		const profiles = [
			makeProfile({ account: 'alice', displayName: 'Alice' }),
			makeProfile({ account: 'bob', displayName: 'Bob' }),
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(profiles),
		}));

		const result = await fetchAllProfiles();
		expect(result).toHaveLength(2);
		expect(getProfile('alice')?.displayName).toBe('Alice');
		expect(getProfile('bob')?.displayName).toBe('Bob');
	});

	it('returns empty array on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
		}));

		const result = await fetchAllProfiles();
		expect(result).toEqual([]);
	});

	it('returns empty array on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));

		const result = await fetchAllProfiles();
		expect(result).toEqual([]);
	});
});

describe('updateProfile', () => {
	beforeEach(() => {
		resetProfiles();
	});

	it('updates profile and caches result', async () => {
		const updated = makeProfile({ account: 'alice', displayName: 'Alice New', bio: 'Updated bio' });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(updated),
		}));

		const result = await updateProfile({ displayName: 'Alice New', bio: 'Updated bio' });
		expect(result).toEqual(updated);
		expect(getProfile('alice')?.displayName).toBe('Alice New');
	});

	it('returns null on failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
		}));

		const result = await updateProfile({ displayName: 'Test' });
		expect(result).toBeNull();
	});

	it('sends correct request format', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(makeProfile({ account: 'alice' })),
		});
		vi.stubGlobal('fetch', fetchFn);

		await updateProfile({ displayName: 'New Name', bio: 'My bio' });

		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost:8098/api/profile',
			expect.objectContaining({
				method: 'PUT',
				headers: expect.objectContaining({
					'Content-Type': 'application/json',
					'Authorization': 'Bearer test-jwt-token',
				}),
				body: JSON.stringify({ displayName: 'New Name', bio: 'My bio' }),
			}),
		);
	});
});

describe('uploadAvatar', () => {
	beforeEach(() => {
		resetProfiles();
	});

	it('uploads and returns avatar URL', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ url: '/api/files/avatars/abc.png' }),
		}));

		const file = new File(['test'], 'avatar.png', { type: 'image/png' });
		const result = await uploadAvatar(file);
		expect(result).toBe('/api/files/avatars/abc.png');
	});

	it('returns null on upload failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: false,
			status: 413,
		}));

		const file = new File(['test'], 'avatar.png', { type: 'image/png' });
		const result = await uploadAvatar(file);
		expect(result).toBeNull();
	});

	it('sends multipart/form-data request', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ url: '/api/files/avatars/test.png' }),
		});
		vi.stubGlobal('fetch', fetchFn);

		const file = new File(['pixels'], 'avatar.png', { type: 'image/png' });
		await uploadAvatar(file);

		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost:8098/api/profile/avatar',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Authorization': 'Bearer test-jwt-token',
				}),
			}),
		);
		// body should be FormData
		const callArgs = fetchFn.mock.calls[0];
		expect(callArgs[1].body).toBeInstanceOf(FormData);
	});
});
