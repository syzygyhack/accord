import { describe, it, expect, afterEach } from 'vitest';
import {
	searchEmoji,
	searchCustomEmoji,
	categories,
	allEmoji,
	setCustomEmoji,
	getCustomEmojiMap,
	getCustomEmojiList,
	getCustomEmojiUrl,
	clearCustomEmoji,
	type EmojiEntry,
} from './emoji';

describe('searchEmoji', () => {
	it('returns all emoji for empty query', () => {
		expect(searchEmoji('')).toBe(allEmoji);
	});

	it('returns all emoji for whitespace-only query', () => {
		expect(searchEmoji('   ')).toBe(allEmoji);
	});

	it('finds emoji by name', () => {
		const results = searchEmoji('grinning face');
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((e) => e.name.includes('grinning face'))).toBe(true);
	});

	it('finds emoji by keyword', () => {
		const results = searchEmoji('happy');
		expect(results.length).toBeGreaterThan(0);
		// All results should have 'happy' in name or keywords
		for (const e of results) {
			const matchesName = e.name.toLowerCase().includes('happy');
			const matchesKeyword = e.keywords.some((k) => k.toLowerCase().includes('happy'));
			expect(matchesName || matchesKeyword).toBe(true);
		}
	});

	it('is case-insensitive', () => {
		const lower = searchEmoji('robot');
		const upper = searchEmoji('ROBOT');
		const mixed = searchEmoji('Robot');
		expect(lower).toEqual(upper);
		expect(lower).toEqual(mixed);
	});

	it('returns empty array when no match', () => {
		const results = searchEmoji('zzzznonexistentemoji');
		expect(results).toEqual([]);
	});

	it('finds fire emoji by keyword "lit"', () => {
		const results = searchEmoji('lit');
		const fire = results.find((e) => e.emoji === '\u{1F525}');
		expect(fire).toBeDefined();
	});

	it('trims query whitespace', () => {
		const trimmed = searchEmoji('robot');
		const padded = searchEmoji('  robot  ');
		expect(trimmed).toEqual(padded);
	});
});

describe('categories', () => {
	it('has expected category names', () => {
		const names = categories.map((c) => c.name);
		expect(names).toContain('Smileys');
		expect(names).toContain('People');
		expect(names).toContain('Nature');
		expect(names).toContain('Food');
		expect(names).toContain('Activities');
		expect(names).toContain('Travel');
		expect(names).toContain('Objects');
		expect(names).toContain('Symbols');
	});

	it('has 8 categories', () => {
		expect(categories).toHaveLength(8);
	});

	it('every category has at least one emoji', () => {
		for (const cat of categories) {
			expect(cat.emoji.length).toBeGreaterThan(0);
		}
	});

	it('every emoji entry has required fields', () => {
		for (const entry of allEmoji) {
			expect(typeof entry.emoji).toBe('string');
			expect(entry.emoji.length).toBeGreaterThan(0);
			expect(typeof entry.name).toBe('string');
			expect(entry.name.length).toBeGreaterThan(0);
			expect(Array.isArray(entry.keywords)).toBe(true);
			expect(entry.keywords.length).toBeGreaterThan(0);
		}
	});

	it('allEmoji is the flat union of all categories', () => {
		const manual = categories.flatMap((c) => c.emoji);
		expect(allEmoji).toEqual(manual);
	});
});

describe('custom emoji', () => {
	afterEach(() => {
		clearCustomEmoji();
	});

	it('starts with empty custom emoji map', () => {
		expect(getCustomEmojiMap().size).toBe(0);
		expect(getCustomEmojiList()).toEqual([]);
	});

	it('setCustomEmoji populates the map', () => {
		setCustomEmoji({
			catjam: 'https://example.com/catjam.gif',
			pepethink: 'https://example.com/pepethink.png',
		});
		expect(getCustomEmojiMap().size).toBe(2);
		expect(getCustomEmojiUrl('catjam')).toBe('https://example.com/catjam.gif');
		expect(getCustomEmojiUrl('pepethink')).toBe('https://example.com/pepethink.png');
	});

	it('getCustomEmojiUrl returns undefined for unknown names', () => {
		setCustomEmoji({ catjam: 'https://example.com/catjam.gif' });
		expect(getCustomEmojiUrl('unknown')).toBeUndefined();
	});

	it('getCustomEmojiList returns entries', () => {
		setCustomEmoji({
			catjam: 'https://example.com/catjam.gif',
			pepethink: 'https://example.com/pepethink.png',
		});
		const list = getCustomEmojiList();
		expect(list).toHaveLength(2);
		expect(list[0]).toEqual({ name: 'catjam', url: 'https://example.com/catjam.gif' });
	});

	it('clearCustomEmoji empties the map', () => {
		setCustomEmoji({ catjam: 'https://example.com/catjam.gif' });
		expect(getCustomEmojiMap().size).toBe(1);
		clearCustomEmoji();
		expect(getCustomEmojiMap().size).toBe(0);
	});

	it('searchCustomEmoji returns all for empty query', () => {
		setCustomEmoji({
			catjam: 'https://example.com/catjam.gif',
			pepethink: 'https://example.com/pepethink.png',
		});
		const results = searchCustomEmoji('');
		expect(results).toHaveLength(2);
	});

	it('searchCustomEmoji filters by name', () => {
		setCustomEmoji({
			catjam: 'https://example.com/catjam.gif',
			pepethink: 'https://example.com/pepethink.png',
		});
		const results = searchCustomEmoji('cat');
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('catjam');
	});

	it('searchCustomEmoji is case-insensitive', () => {
		setCustomEmoji({ CatJam: 'https://example.com/catjam.gif' });
		const results = searchCustomEmoji('catjam');
		expect(results).toHaveLength(1);
	});
});
