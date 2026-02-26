/**
 * Reactive store for user profiles.
 *
 * Caches profiles fetched from accord-files. Profiles contain
 * display name, bio, avatar URL, and status. The store is populated
 * on connection and individual profiles can be fetched on demand.
 */

import { getToken } from '$lib/api/auth';
import { getActiveServer } from '$lib/state/servers.svelte';
import { normalizeBaseUrl } from '$lib/utils/url';

// ---- Types ------------------------------------------------------------------

export interface UserProfile {
	account: string;
	displayName?: string;
	bio?: string;
	avatar?: string;
	status?: string;
	updatedAt: number;
}

// ---- Reactive state ---------------------------------------------------------

const _profiles = new Map<string, UserProfile>();
let _version = $state(0);

function notify(): void {
	_version++;
}

// ---- Public API -------------------------------------------------------------

/** Reactive profiles map — read via getProfile/getAllProfiles. */
export const profileState = {
	get profiles() {
		void _version;
		return _profiles;
	},
};

/** Get a cached profile by account name, or null if not cached. */
export function getProfile(account: string): UserProfile | null {
	void _version;
	return _profiles.get(account.toLowerCase()) ?? null;
}

/** Get all cached profiles as an array. */
export function getAllProfiles(): UserProfile[] {
	void _version;
	return Array.from(_profiles.values());
}

/** Manually set a profile in the cache (e.g. after update). */
export function setProfile(profile: UserProfile): void {
	_profiles.set(profile.account.toLowerCase(), profile);
	notify();
}

/** Reset all profile state (for testing / disconnect). */
export function resetProfiles(): void {
	_profiles.clear();
	_version = 0;
}

// ---- Fetch helpers ----------------------------------------------------------

/** In-flight request deduplication. */
const _inflight = new Map<string, Promise<UserProfile | null>>();

/** Resolve filesUrl from active server. */
function getFilesUrl(): string | null {
	const server = getActiveServer();
	return server?.filesUrl ? normalizeBaseUrl(server.filesUrl) : null;
}

/**
 * Fetch a single profile from the server and cache it.
 * Returns null if the profile doesn't exist or the request fails.
 * Deduplicates in-flight requests for the same account.
 */
export async function fetchProfile(account: string): Promise<UserProfile | null> {
	const key = account.toLowerCase();

	// Deduplicate
	const existing = _inflight.get(key);
	if (existing) return existing;

	const promise = _fetchProfileImpl(key);
	_inflight.set(key, promise);
	try {
		return await promise;
	} finally {
		_inflight.delete(key);
	}
}

async function _fetchProfileImpl(account: string): Promise<UserProfile | null> {
	const filesUrl = getFilesUrl();
	const token = getToken();
	if (!filesUrl) return null;

	try {
		const headers: Record<string, string> = {};
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const res = await fetch(
			`${filesUrl}/api/profile/${encodeURIComponent(account)}`,
			{ headers },
		);
		if (res.status === 404) {
			// Profile doesn't exist yet — not an error, just empty
			return null;
		}
		if (!res.ok) return null;

		const profile = (await res.json()) as UserProfile;
		_profiles.set(account.toLowerCase(), profile);
		notify();
		return profile;
	} catch {
		return null;
	}
}

/**
 * Fetch all profiles from the server and populate the cache.
 * Returns the profiles array, or empty array on failure.
 */
export async function fetchAllProfiles(): Promise<UserProfile[]> {
	const filesUrl = getFilesUrl();
	const token = getToken();
	if (!filesUrl) return [];

	try {
		const headers: Record<string, string> = {};
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const res = await fetch(`${filesUrl}/api/profiles`, { headers });
		if (!res.ok) return [];

		const profiles = (await res.json()) as UserProfile[];
		for (const profile of profiles) {
			_profiles.set(profile.account.toLowerCase(), profile);
		}
		notify();
		return profiles;
	} catch {
		return [];
	}
}

export interface ProfileUpdateResult {
	profile: UserProfile | null;
	error: string | null;
}

/**
 * Update the current user's profile.
 * Returns the updated profile and error details.
 */
export async function updateProfile(
	data: { bio?: string; status?: string },
): Promise<ProfileUpdateResult> {
	const filesUrl = getFilesUrl();
	const token = getToken();
	if (!filesUrl) return { profile: null, error: 'Not connected to file server' };
	if (!token) return { profile: null, error: 'Not authenticated — try logging out and back in' };

	try {
		const res = await fetch(`${filesUrl}/api/profile`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`,
			},
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			const msg = (body as { error?: string } | null)?.error ?? `Server error (${res.status})`;
			return { profile: null, error: msg };
		}

		const profile = (await res.json()) as UserProfile;
		_profiles.set(profile.account.toLowerCase(), profile);
		notify();
		return { profile, error: null };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Network error';
		return { profile: null, error: msg };
	}
}

export interface AvatarUploadResult {
	url: string | null;
	error: string | null;
}

/**
 * Upload an avatar image for the current user.
 * Returns the avatar URL on success, or an error message on failure.
 */
export async function uploadAvatar(file: File): Promise<AvatarUploadResult> {
	const filesUrl = getFilesUrl();
	const token = getToken();
	if (!filesUrl) return { url: null, error: 'Not connected to file server' };
	if (!token) return { url: null, error: 'Not authenticated — try logging out and back in' };

	try {
		const formData = new FormData();
		formData.append('avatar', file);

		const res = await fetch(`${filesUrl}/api/profile/avatar`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
			},
			body: formData,
		});
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			const msg = (body as { error?: string } | null)?.error ?? `Server error (${res.status})`;
			return { url: null, error: msg };
		}

		const data = (await res.json()) as { url: string };
		return { url: data.url, error: null };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Network error';
		return { url: null, error: msg };
	}
}

/**
 * Resolve a profile's avatar URL to an absolute URL.
 * Relative paths are resolved against the files server.
 */
export function resolveAvatarUrl(avatarPath: string | undefined): string | null {
	if (!avatarPath) return null;
	if (avatarPath.startsWith('http://') || avatarPath.startsWith('https://')) {
		return avatarPath;
	}
	const filesUrl = getFilesUrl();
	if (!filesUrl) return null;
	return `${filesUrl}${avatarPath}`;
}
