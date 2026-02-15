import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	themeState,
	setTheme,
	applyServerTheme,
	clearServerTheme,
	parseServerTheme,
	resetTheme,
} from './theme.svelte';

/**
 * Minimal localStorage mock for Node-based vitest.
 */
function createStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() { return store.size; },
		key: (_index: number) => null,
	} as Storage;
}

/**
 * Minimal document.documentElement mock for DOM operations.
 */
function createDocumentMock() {
	const attrs = new Map<string, string>();
	const styles = new Map<string, string>();

	return {
		documentElement: {
			getAttribute: (name: string) => attrs.get(name) ?? null,
			setAttribute: (name: string, value: string) => attrs.set(name, value),
			style: {
				setProperty: (name: string, value: string) => styles.set(name, value),
				removeProperty: (name: string) => { styles.delete(name); return ''; },
				getPropertyValue: (name: string) => styles.get(name) ?? '',
			},
		},
	};
}

describe('theme state', () => {
	beforeEach(() => {
		const storage = createStorageMock();
		vi.stubGlobal('localStorage', storage);
		vi.stubGlobal('document', createDocumentMock());
		resetTheme();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('setTheme', () => {
		it('updates the current theme', () => {
			setTheme('light');
			expect(themeState.current).toBe('light');
		});

		it('persists to localStorage', () => {
			setTheme('amoled');
			expect(localStorage.getItem('virc:theme')).toBe('amoled');
		});

		it('sets data-theme on document element', () => {
			setTheme('compact');
			expect(document.documentElement.getAttribute('data-theme')).toBe('compact');
		});

		it('ignores invalid theme values', () => {
			setTheme('dark');
			setTheme('invalid' as any);
			expect(themeState.current).toBe('dark');
		});

		it('cycles through all valid themes', () => {
			for (const theme of ['dark', 'light', 'amoled', 'compact'] as const) {
				setTheme(theme);
				expect(themeState.current).toBe(theme);
				expect(document.documentElement.getAttribute('data-theme')).toBe(theme);
			}
		});
	});

	describe('server theme overrides', () => {
		it('applies allowed CSS variables to root', () => {
			applyServerTheme({ '--accent-primary': '#ff0000' });
			expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#ff0000');
			expect(themeState.serverOverrides).toEqual({ '--accent-primary': '#ff0000' });
		});

		it('rejects disallowed CSS variables', () => {
			applyServerTheme({ '--font-primary': 'Comic Sans' });
			expect(document.documentElement.style.getPropertyValue('--font-primary')).toBe('');
			expect(themeState.serverOverrides).toEqual({});
		});

		it('rejects values containing url()', () => {
			applyServerTheme({ '--accent-primary': 'url(https://evil.com)' });
			expect(themeState.serverOverrides).toEqual({});
		});

		it('rejects values containing expression()', () => {
			applyServerTheme({ '--surface-base': 'expression(alert(1))' });
			expect(themeState.serverOverrides).toEqual({});
		});

		it('rejects values containing semicolons', () => {
			applyServerTheme({ '--accent-primary': '#fff; background: red' });
			expect(themeState.serverOverrides).toEqual({});
		});

		it('applies multiple overrides', () => {
			applyServerTheme({
				'--accent-primary': '#e05050',
				'--surface-lowest': '#1a1015',
				'--surface-low': '#201520',
			});
			expect(Object.keys(themeState.serverOverrides)).toHaveLength(3);
			expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#e05050');
			expect(document.documentElement.style.getPropertyValue('--surface-lowest')).toBe('#1a1015');
		});

		it('clears previous overrides before applying new ones', () => {
			applyServerTheme({ '--accent-primary': '#ff0000' });
			applyServerTheme({ '--surface-base': '#111111' });
			expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
			expect(document.documentElement.style.getPropertyValue('--surface-base')).toBe('#111111');
		});
	});

	describe('clearServerTheme', () => {
		it('removes all server overrides from DOM', () => {
			applyServerTheme({
				'--accent-primary': '#ff0000',
				'--surface-base': '#111111',
			});
			clearServerTheme();
			expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
			expect(document.documentElement.style.getPropertyValue('--surface-base')).toBe('');
			expect(themeState.serverOverrides).toEqual({});
		});

		it('is safe to call when no overrides exist', () => {
			clearServerTheme();
			expect(themeState.serverOverrides).toEqual({});
		});
	});

	describe('parseServerTheme', () => {
		it('parses accent into --accent-primary', () => {
			const result = parseServerTheme({ accent: '#e05050' });
			expect(result).toEqual({ '--accent-primary': '#e05050' });
		});

		it('parses surfaces into --surface-* variables', () => {
			const result = parseServerTheme({
				surfaces: {
					lowest: '#1a1015',
					low: '#201520',
					base: '#281a28',
				},
			});
			expect(result).toEqual({
				'--surface-lowest': '#1a1015',
				'--surface-low': '#201520',
				'--surface-base': '#281a28',
			});
		});

		it('combines accent and surfaces', () => {
			const result = parseServerTheme({
				accent: '#e05050',
				surfaces: { lowest: '#1a1015' },
			});
			expect(result).toEqual({
				'--accent-primary': '#e05050',
				'--surface-lowest': '#1a1015',
			});
		});

		it('returns empty object for empty config', () => {
			expect(parseServerTheme({})).toEqual({});
		});
	});

	describe('resetTheme', () => {
		it('resets to dark theme', () => {
			setTheme('light');
			applyServerTheme({ '--accent-primary': '#ff0000' });
			resetTheme();
			expect(themeState.current).toBe('dark');
			expect(themeState.serverOverrides).toEqual({});
			expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		});
	});
});
