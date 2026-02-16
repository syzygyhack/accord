import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	registerKeybinding,
	registerKeybindings,
	processKeydown,
	installGlobalHandler,
	getRegisteredBindings,
	setCustomBinding,
	resetAllBindings,
	resetBinding,
	hasCustomBindings,
	formatCombo,
	comboFromEvent,
	_resetForTesting,
} from './keybindings';

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

/** Create a fake KeyboardEvent-like object for testing. */
function makeKeyEvent(opts: {
	key: string;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
}): KeyboardEvent {
	return {
		key: opts.key,
		ctrlKey: opts.ctrlKey ?? false,
		altKey: opts.altKey ?? false,
		shiftKey: opts.shiftKey ?? false,
		metaKey: opts.metaKey ?? false,
		preventDefault: vi.fn(),
	} as unknown as KeyboardEvent;
}

describe('keybindings', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		_resetForTesting();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('matches a simple key', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'Escape', handler });

		processKeydown(makeKeyEvent({ key: 'Escape' }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('matches Ctrl+K', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', ctrl: true, handler });

		// Without Ctrl — should not match
		processKeydown(makeKeyEvent({ key: 'k' }));
		expect(handler).not.toHaveBeenCalled();

		// With Ctrl — should match
		processKeydown(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('matches Meta key as Ctrl (Mac Cmd)', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', ctrl: true, handler });

		processKeydown(makeKeyEvent({ key: 'k', metaKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('matches Alt+Shift+ArrowUp', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({
			key: 'ArrowUp',
			alt: true,
			shift: true,
			handler,
		});

		// Alt only — should not match
		processKeydown(makeKeyEvent({ key: 'ArrowUp', altKey: true }));
		expect(handler).not.toHaveBeenCalled();

		// Alt+Shift — should match
		processKeydown(makeKeyEvent({ key: 'ArrowUp', altKey: true, shiftKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('does not match when extra modifiers are held', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', handler });

		// k with Ctrl held — should not match since binding has no ctrl
		processKeydown(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
	});

	it('unregisters a single binding', () => {
		const handler = vi.fn(() => true);
		const unreg = registerKeybinding({ key: 'a', handler });

		processKeydown(makeKeyEvent({ key: 'a' }));
		expect(handler).toHaveBeenCalledTimes(1);

		unreg();
		processKeydown(makeKeyEvent({ key: 'a' }));
		expect(handler).toHaveBeenCalledTimes(1); // no additional call
	});

	it('registers and unregisters multiple bindings', () => {
		const h1 = vi.fn(() => true);
		const h2 = vi.fn(() => true);
		const unreg = registerKeybindings([
			{ key: 'a', handler: h1 },
			{ key: 'b', handler: h2 },
		]);

		processKeydown(makeKeyEvent({ key: 'a' }));
		processKeydown(makeKeyEvent({ key: 'b' }));
		expect(h1).toHaveBeenCalledTimes(1);
		expect(h2).toHaveBeenCalledTimes(1);

		unreg();
		processKeydown(makeKeyEvent({ key: 'a' }));
		processKeydown(makeKeyEvent({ key: 'b' }));
		expect(h1).toHaveBeenCalledTimes(1);
		expect(h2).toHaveBeenCalledTimes(1);
	});

	it('first matching handler wins (prevents later handlers)', () => {
		const h1 = vi.fn(() => true);
		const h2 = vi.fn(() => true);
		registerKeybindings([
			{ key: 'x', handler: h1 },
			{ key: 'x', handler: h2 },
		]);

		processKeydown(makeKeyEvent({ key: 'x' }));
		expect(h1).toHaveBeenCalledTimes(1);
		expect(h2).not.toHaveBeenCalled();
	});

	it('handler returning false allows fallthrough', () => {
		const h1 = vi.fn(() => false);
		const h2 = vi.fn(() => true);
		registerKeybindings([
			{ key: 'x', handler: h1 },
			{ key: 'x', handler: h2 },
		]);

		processKeydown(makeKeyEvent({ key: 'x' }));
		expect(h1).toHaveBeenCalledTimes(1);
		expect(h2).toHaveBeenCalledTimes(1);
	});

	it('preventDefault is called when handler consumes the event', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', ctrl: true, handler });

		const e = makeKeyEvent({ key: 'k', ctrlKey: true });
		processKeydown(e);
		expect(e.preventDefault).toHaveBeenCalled();
	});

	it('is case-insensitive for key matching', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'M', ctrl: true, shift: true, handler });

		processKeydown(makeKeyEvent({ key: 'M', ctrlKey: true, shiftKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);

		processKeydown(makeKeyEvent({ key: 'm', ctrlKey: true, shiftKey: true }));
		expect(handler).toHaveBeenCalledTimes(2);
	});
});

describe('keybinding customization', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		_resetForTesting();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('getRegisteredBindings returns bindings with descriptions', () => {
		registerKeybindings([
			{ key: 'k', ctrl: true, handler: () => true, description: 'Quick switch' },
			{ key: 'Escape', handler: () => true }, // no description — excluded
			{ key: ',', ctrl: true, handler: () => true, description: 'Open settings' },
		]);

		const bindings = getRegisteredBindings();
		expect(bindings).toHaveLength(2);
		expect(bindings[0].description).toBe('Quick switch');
		expect(bindings[0].defaultCombo).toEqual({ key: 'k', ctrl: true, alt: undefined, shift: undefined });
		expect(bindings[1].description).toBe('Open settings');
	});

	it('setCustomBinding overrides the key combo', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', ctrl: true, handler, description: 'Quick switch' });

		// Default: Ctrl+K triggers it
		processKeydown(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);

		// Override to Ctrl+P
		setCustomBinding('Quick switch', { key: 'p', ctrl: true });

		// Old combo no longer works
		processKeydown(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);

		// New combo works
		processKeydown(makeKeyEvent({ key: 'p', ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it('getRegisteredBindings reflects custom overrides', () => {
		registerKeybinding({ key: 'k', ctrl: true, handler: () => true, description: 'Quick switch' });
		setCustomBinding('Quick switch', { key: 'p', ctrl: true });

		const bindings = getRegisteredBindings();
		expect(bindings[0].defaultCombo.key).toBe('k');
		expect(bindings[0].currentCombo.key).toBe('p');
	});

	it('resetAllBindings clears all overrides', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', ctrl: true, handler, description: 'Quick switch' });
		setCustomBinding('Quick switch', { key: 'p', ctrl: true });

		resetAllBindings();

		// Default combo works again
		processKeydown(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);

		// Custom combo no longer works
		processKeydown(makeKeyEvent({ key: 'p', ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('resetBinding clears a single override', () => {
		const h1 = vi.fn(() => true);
		const h2 = vi.fn(() => true);
		registerKeybindings([
			{ key: 'k', ctrl: true, handler: h1, description: 'Quick switch' },
			{ key: ',', ctrl: true, handler: h2, description: 'Open settings' },
		]);

		setCustomBinding('Quick switch', { key: 'p', ctrl: true });
		setCustomBinding('Open settings', { key: '.', ctrl: true });

		resetBinding('Quick switch');

		// Quick switch reset to default (Ctrl+K)
		processKeydown(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(h1).toHaveBeenCalledTimes(1);

		// Open settings still uses override (Ctrl+.)
		processKeydown(makeKeyEvent({ key: '.', ctrlKey: true }));
		expect(h2).toHaveBeenCalledTimes(1);
	});

	it('hasCustomBindings reports correctly', () => {
		registerKeybinding({ key: 'k', ctrl: true, handler: () => true, description: 'Quick switch' });

		expect(hasCustomBindings()).toBe(false);
		setCustomBinding('Quick switch', { key: 'p', ctrl: true });
		expect(hasCustomBindings()).toBe(true);
		resetAllBindings();
		expect(hasCustomBindings()).toBe(false);
	});

	it('persists overrides to localStorage', () => {
		registerKeybinding({ key: 'k', ctrl: true, handler: () => true, description: 'Quick switch' });
		setCustomBinding('Quick switch', { key: 'p', ctrl: true });

		const stored = localStorage.getItem('virc:keybindingOverrides');
		expect(stored).toBeTruthy();
		const parsed = JSON.parse(stored!);
		expect(parsed['Quick switch'].key).toBe('p');
		expect(parsed['Quick switch'].ctrl).toBe(true);
	});

	it('resetAllBindings removes localStorage entry', () => {
		registerKeybinding({ key: 'k', ctrl: true, handler: () => true, description: 'Quick switch' });
		setCustomBinding('Quick switch', { key: 'p', ctrl: true });
		resetAllBindings();

		expect(localStorage.getItem('virc:keybindingOverrides')).toBeNull();
	});
});

describe('formatCombo', () => {
	it('formats a simple key', () => {
		expect(formatCombo({ key: 'k' })).toBe('K');
	});

	it('formats Ctrl+K', () => {
		expect(formatCombo({ key: 'k', ctrl: true })).toBe('Ctrl+K');
	});

	it('formats Alt+Shift+ArrowUp', () => {
		expect(formatCombo({ key: 'ArrowUp', alt: true, shift: true })).toBe('Alt+Shift+Up');
	});

	it('formats Escape', () => {
		expect(formatCombo({ key: 'Escape' })).toBe('Esc');
	});

	it('formats Ctrl+Shift+M', () => {
		expect(formatCombo({ key: 'M', ctrl: true, shift: true })).toBe('Ctrl+Shift+M');
	});
});

describe('comboFromEvent', () => {
	it('extracts key combo from a keyboard event', () => {
		const combo = comboFromEvent(makeKeyEvent({ key: 'k', ctrlKey: true }));
		expect(combo).toEqual({ key: 'k', ctrl: true, alt: undefined, shift: undefined });
	});

	it('returns null for bare modifier keys', () => {
		expect(comboFromEvent(makeKeyEvent({ key: 'Control' }))).toBeNull();
		expect(comboFromEvent(makeKeyEvent({ key: 'Shift' }))).toBeNull();
		expect(comboFromEvent(makeKeyEvent({ key: 'Alt' }))).toBeNull();
		expect(comboFromEvent(makeKeyEvent({ key: 'Meta' }))).toBeNull();
	});

	it('includes shift modifier', () => {
		const combo = comboFromEvent(makeKeyEvent({ key: 'ArrowUp', altKey: true, shiftKey: true }));
		expect(combo).toEqual({ key: 'ArrowUp', ctrl: undefined, alt: true, shift: true });
	});
});

describe('installGlobalHandler', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		_resetForTesting();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('adds a keydown listener to the target', () => {
		const target = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		installGlobalHandler(target as unknown as EventTarget);
		expect(target.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
	});

	it('dispatches keydown events to registered bindings', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'k', ctrl: true, handler });

		const listeners: ((e: Event) => void)[] = [];
		const target = {
			addEventListener: (_event: string, fn: (e: Event) => void) => listeners.push(fn),
			removeEventListener: vi.fn(),
		};
		installGlobalHandler(target as unknown as EventTarget);

		// Simulate a keydown event through the installed handler
		const e = makeKeyEvent({ key: 'k', ctrlKey: true });
		listeners[0](e);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(e.preventDefault).toHaveBeenCalled();
	});

	it('returns a cleanup function that removes the listener', () => {
		const addSpy = vi.fn();
		const removeSpy = vi.fn();
		const target = {
			addEventListener: addSpy,
			removeEventListener: removeSpy,
		};
		const cleanup = installGlobalHandler(target as unknown as EventTarget);

		// Get the handler that was registered
		const registeredHandler = addSpy.mock.calls[0][1];

		cleanup();
		expect(removeSpy).toHaveBeenCalledWith('keydown', registeredHandler);
	});

	it('does not dispatch after cleanup', () => {
		const handler = vi.fn(() => true);
		registerKeybinding({ key: 'x', handler });

		const listeners = new Map<string, Set<(e: Event) => void>>();
		const target = {
			addEventListener: (event: string, fn: (e: Event) => void) => {
				if (!listeners.has(event)) listeners.set(event, new Set());
				listeners.get(event)!.add(fn);
			},
			removeEventListener: (event: string, fn: (e: Event) => void) => {
				listeners.get(event)?.delete(fn);
			},
		};

		const cleanup = installGlobalHandler(target as unknown as EventTarget);

		// Fire before cleanup
		for (const fn of listeners.get('keydown') ?? []) {
			fn(makeKeyEvent({ key: 'x' }));
		}
		expect(handler).toHaveBeenCalledTimes(1);

		cleanup();

		// Fire after cleanup — listener should be removed
		for (const fn of listeners.get('keydown') ?? []) {
			fn(makeKeyEvent({ key: 'x' }));
		}
		expect(handler).toHaveBeenCalledTimes(1); // no additional call
	});
});
