/**
 * Keyboard shortcut manager.
 *
 * Registers key combinations and dispatches to handler functions.
 * Handles modifier keys (Ctrl/Meta, Alt, Shift) cross-platform.
 * Supports user-customizable bindings stored in localStorage.
 */

/** Serializable key combination (no handler). */
export interface KeyCombo {
	key: string;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
}

export interface Keybinding extends KeyCombo {
	/** Handler returns true if the event was consumed. */
	handler: (e: KeyboardEvent) => boolean | void;
	/** Description for documentation/help purposes. Used as the stable identifier for custom overrides. */
	description?: string;
}

/** Info about a registered binding exposed to the settings UI. */
export interface BindingInfo {
	description: string;
	defaultCombo: KeyCombo;
	currentCombo: KeyCombo;
}

const STORAGE_KEY = 'accord:keybindingOverrides';

/** Active bindings, checked in order. First matching handler that returns true wins. */
let bindings: Keybinding[] = [];

/** Custom overrides keyed by description. */
let overrides: Map<string, KeyCombo> = new Map();

/** Load overrides from localStorage on module init. */
function loadOverrides(): void {
	try {
		if (typeof localStorage === 'undefined') return;
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<string, KeyCombo>;
		overrides = new Map(Object.entries(parsed));
	} catch {
		overrides = new Map();
	}
}

/** Save overrides to localStorage. */
function saveOverrides(): void {
	if (typeof localStorage === 'undefined') return;
	const obj: Record<string, KeyCombo> = {};
	for (const [key, combo] of overrides) {
		obj[key] = { key: combo.key, ctrl: combo.ctrl, alt: combo.alt, shift: combo.shift };
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

// Load on module init
loadOverrides();

/**
 * Get the effective key combo for a binding, considering custom overrides.
 */
function getEffectiveCombo(binding: Keybinding): KeyCombo {
	if (binding.description) {
		const override = overrides.get(binding.description);
		if (override) return override;
	}
	return { key: binding.key, ctrl: binding.ctrl, alt: binding.alt, shift: binding.shift };
}

/**
 * Register a keybinding. Returns an unregister function.
 */
export function registerKeybinding(binding: Keybinding): () => void {
	bindings.push(binding);
	return () => {
		bindings = bindings.filter((b) => b !== binding);
	};
}

/**
 * Register multiple keybindings. Returns an unregister-all function.
 */
export function registerKeybindings(newBindings: Keybinding[]): () => void {
	bindings.push(...newBindings);
	return () => {
		const set = new Set(newBindings);
		bindings = bindings.filter((b) => !set.has(b));
	};
}

/**
 * Process a keydown event against registered bindings.
 * Call this from a global keydown listener.
 */
export function processKeydown(e: KeyboardEvent): void {
	for (const binding of bindings) {
		const combo = getEffectiveCombo(binding);
		if (!matchesCombo(e, combo)) continue;

		const result = binding.handler(e);
		if (result !== false) {
			e.preventDefault();
			return;
		}
	}
}

function matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
	const wantCtrl = combo.ctrl ?? false;
	const wantAlt = combo.alt ?? false;
	const wantShift = combo.shift ?? false;

	// ctrlKey or metaKey (Cmd on Mac) both count as "ctrl"
	const hasCtrl = e.ctrlKey || e.metaKey;

	if (wantCtrl !== hasCtrl) return false;
	if (wantAlt !== e.altKey) return false;
	if (wantShift !== e.shiftKey) return false;

	// Match key — case-insensitive for letters
	return e.key.toLowerCase() === combo.key.toLowerCase();
}

/**
 * Install the global keydown listener on a target (defaults to window).
 * Returns a cleanup function.
 */
export function installGlobalHandler(target: EventTarget = window): () => void {
	const handler = (e: Event) => processKeydown(e as KeyboardEvent);
	target.addEventListener('keydown', handler);
	return () => target.removeEventListener('keydown', handler);
}

// ---------------------------------------------------------------------------
// Customization API (for User Settings > Keybindings)
// ---------------------------------------------------------------------------

/**
 * Get all registered bindings that have descriptions (user-visible shortcuts).
 * Returns binding info with default and current (possibly overridden) combos.
 */
export function getRegisteredBindings(): BindingInfo[] {
	const seen = new Set<string>();
	const result: BindingInfo[] = [];

	for (const binding of bindings) {
		if (!binding.description) continue;
		// Deduplicate by description (in case of re-registration)
		if (seen.has(binding.description)) continue;
		seen.add(binding.description);

		const defaultCombo: KeyCombo = {
			key: binding.key,
			ctrl: binding.ctrl,
			alt: binding.alt,
			shift: binding.shift,
		};

		const override = overrides.get(binding.description);
		const currentCombo = override ?? { ...defaultCombo };

		result.push({
			description: binding.description,
			defaultCombo,
			currentCombo,
		});
	}

	return result;
}

/**
 * Set a custom key combo for a binding identified by description.
 * Takes effect immediately and persists to localStorage.
 */
export function setCustomBinding(description: string, combo: KeyCombo): void {
	overrides.set(description, {
		key: combo.key,
		ctrl: combo.ctrl,
		alt: combo.alt,
		shift: combo.shift,
	});
	saveOverrides();
}

/**
 * Reset all custom keybinding overrides to defaults.
 * Takes effect immediately and clears localStorage.
 */
export function resetAllBindings(): void {
	overrides.clear();
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(STORAGE_KEY);
	}
}

/**
 * Reset a single binding to its default.
 */
export function resetBinding(description: string): void {
	overrides.delete(description);
	saveOverrides();
}

/**
 * Check if any custom overrides exist.
 */
export function hasCustomBindings(): boolean {
	return overrides.size > 0;
}

/**
 * Format a KeyCombo as a human-readable string (e.g. "Ctrl+Shift+K").
 */
export function formatCombo(combo: KeyCombo): string {
	const parts: string[] = [];
	if (combo.ctrl) parts.push('Ctrl');
	if (combo.alt) parts.push('Alt');
	if (combo.shift) parts.push('Shift');

	// Prettify the key name
	let keyName = combo.key;
	if (keyName.length === 1) {
		keyName = keyName.toUpperCase();
	} else {
		// Handle common key names
		const names: Record<string, string> = {
			ArrowUp: 'Up',
			ArrowDown: 'Down',
			ArrowLeft: 'Left',
			ArrowRight: 'Right',
			' ': 'Space',
			Escape: 'Esc',
		};
		keyName = names[keyName] ?? keyName;
	}
	parts.push(keyName);

	return parts.join('+');
}

/**
 * Extract a KeyCombo from a KeyboardEvent (for recording mode).
 * Returns null if only modifier keys are pressed (no actual key).
 */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
	// Ignore bare modifier key presses
	if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
		return null;
	}

	return {
		key: e.key,
		ctrl: e.ctrlKey || e.metaKey || undefined,
		alt: e.altKey || undefined,
		shift: e.shiftKey || undefined,
	};
}

// For testing: reset module state
export function _resetForTesting(): void {
	bindings = [];
	overrides = new Map();
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(STORAGE_KEY);
	}
}
