import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appSettings, resetAppSettings } from './appSettings.svelte';

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

describe('appSettings', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		resetAppSettings();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('systemMessageDisplay', () => {
		it('defaults to all', () => {
			expect(appSettings.systemMessageDisplay).toBe('all');
		});

		it('can be set to smart', () => {
			appSettings.systemMessageDisplay = 'smart';
			expect(appSettings.systemMessageDisplay).toBe('smart');
		});

		it('can be set to none', () => {
			appSettings.systemMessageDisplay = 'none';
			expect(appSettings.systemMessageDisplay).toBe('none');
		});

		it('persists to localStorage', () => {
			appSettings.systemMessageDisplay = 'smart';
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.systemMessageDisplay).toBe('smart');
		});

		it('resets to default', () => {
			appSettings.systemMessageDisplay = 'none';
			resetAppSettings();
			expect(appSettings.systemMessageDisplay).toBe('all');
		});
	});

	describe('zoom', () => {
		it('defaults to 125', () => {
			expect(appSettings.zoom).toBe(125);
		});

		it('persists to localStorage', () => {
			appSettings.zoom = 100;
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.zoom).toBe(100);
		});
	});
});
