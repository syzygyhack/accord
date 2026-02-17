/**
 * Reactive member state with per-channel member lists, role grouping,
 * and presence tracking.
 *
 * Rich member data: modes, highest mode prefix, away status, and presence.
 * Complements the simpler channels.svelte.ts member tracking.
 *
 * Uses a version counter for Map reactivity (Svelte 5 $state doesn't
 * deeply track Map/Set mutations).
 */

import { MODE_ORDER } from '$lib/constants';

export interface Member {
	nick: string;
	account: string;
	modes: string[]; // ['@', '+', etc.]
	highestMode: string | null; // highest prefix: ~, &, @, %, +, null
	isAway: boolean;
	awayReason: string | null;
	presence: 'online' | 'idle' | 'dnd' | 'offline';
}

// --- Internal storage (non-reactive) ---
const _channels = new Map<string, Map<string, Member>>();
let _version = $state(0);

function notify(): void {
	_version++;
}

// Legacy export for direct access
export const memberState = {
	get channels() { void _version; return _channels; },
};

/** Compute the highest mode from an array of mode prefixes. */
function computeHighestMode(modes: string[]): string | null {
	for (const mode of MODE_ORDER) {
		if (modes.includes(mode)) return mode;
	}
	return null;
}

function ensureChannel(channel: string): Map<string, Member> {
	if (!_channels.has(channel)) {
		_channels.set(channel, new Map());
	}
	return _channels.get(channel)!;
}

/** Set the full member list for a channel (from NAMES/WHO response). */
export function setMembers(channel: string, members: Member[]): void {
	const map = new Map<string, Member>();
	for (const m of members) {
		map.set(m.nick, m);
	}
	_channels.set(channel, map);
	notify();
}

/** Add a member to a channel (on JOIN). Overwrites if nick already exists. */
export function addMember(channel: string, member: Member): void {
	const map = ensureChannel(channel);
	map.set(member.nick, member);
	notify();
}

/** Remove a member from a channel (on PART). */
export function removeMember(channel: string, nick: string): void {
	const map = _channels.get(channel);
	if (map) {
		map.delete(nick);
		notify();
	}
}

/** Remove a member from all channels (on QUIT). */
export function removeMemberFromAll(nick: string): void {
	for (const map of _channels.values()) {
		map.delete(nick);
	}
	notify();
}

/**
 * Update presence/away state for a nick across all channels.
 * Determines presence from away status and reason:
 * - Not away -> 'online'
 * - Away with reason starting with '[DND]' -> 'dnd'
 * - Away otherwise -> 'idle'
 */
export function updatePresence(nick: string, isAway: boolean, reason?: string): void {
	let presence: Member['presence'];
	let awayReason: string | null;

	if (!isAway) {
		presence = 'online';
		awayReason = null;
	} else {
		awayReason = reason ?? null;
		if (awayReason && awayReason.startsWith('[DND]')) {
			presence = 'dnd';
		} else {
			presence = 'idle';
		}
	}

	for (const map of _channels.values()) {
		const member = map.get(nick);
		if (member) {
			member.isAway = isAway;
			member.awayReason = awayReason;
			member.presence = presence;
		}
	}
	notify();
}

/** Update modes for a member in a specific channel. Recalculates highestMode. */
export function updateMemberModes(channel: string, nick: string, modes: string[]): void {
	const map = _channels.get(channel);
	if (!map) return;
	const member = map.get(nick);
	if (!member) return;
	member.modes = modes;
	member.highestMode = computeHighestMode(modes);
	notify();
}

/** Get a single member by nick in a channel, or null. */
export function getMember(channel: string, nick: string): Member | null {
	void _version;
	const map = _channels.get(channel);
	if (!map) return null;
	return map.get(nick) ?? null;
}

/**
 * Get all members for a channel, sorted by role (highest mode first)
 * then alphabetically by nick within each role.
 */
export function getMembers(channel: string): Member[] {
	void _version;
	const map = _channels.get(channel);
	if (!map) return [];

	const members = Array.from(map.values());
	members.sort((a, b) => {
		const aRank = modeRank(a.highestMode);
		const bRank = modeRank(b.highestMode);
		if (aRank !== bRank) return aRank - bRank;
		return a.nick.localeCompare(b.nick);
	});
	return members;
}

/**
 * Get members grouped by role. Key is the mode prefix string
 * (e.g. '@', '+'), or '' for no mode. Members within each group
 * are sorted alphabetically.
 */
export function getMembersByRole(channel: string): Map<string, Member[]> {
	void _version;
	const map = _channels.get(channel);
	if (!map) return new Map();

	const grouped = new Map<string, Member[]>();
	for (const member of map.values()) {
		const key = member.highestMode ?? '';
		if (!grouped.has(key)) {
			grouped.set(key, []);
		}
		grouped.get(key)!.push(member);
	}

	// Sort within each group
	for (const members of grouped.values()) {
		members.sort((a, b) => a.nick.localeCompare(b.nick));
	}

	return grouped;
}

/** Numeric rank for a mode prefix (lower = higher priority). */
function modeRank(mode: string | null): number {
	if (mode === null) return MODE_ORDER.length;
	const idx = MODE_ORDER.indexOf(mode as (typeof MODE_ORDER)[number]);
	return idx === -1 ? MODE_ORDER.length : idx;
}

/** Set a member's presence to 'offline' across all channels. */
export function setPresenceOffline(nick: string): void {
	for (const map of _channels.values()) {
		const member = map.get(nick);
		if (member) {
			member.presence = 'offline';
		}
	}
	notify();
}

/** Rename a member across all channels (used for NICK). */
export function renameMember(oldNick: string, newNick: string): void {
	for (const map of _channels.values()) {
		const member = map.get(oldNick);
		if (member) {
			map.delete(oldNick);
			member.nick = newNick;
			map.set(newNick, member);
		}
	}
	notify();
}

/** Clear all members from a specific channel (for reconnect). */
export function clearChannel(channel: string): void {
	const map = _channels.get(channel);
	if (map) {
		map.clear();
		notify();
	}
}

/** Reset all member state. */
export function resetMembers(): void {
	_channels.clear();
	notify();
}
