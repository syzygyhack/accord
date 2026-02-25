/**
 * IndexedDB message cache for offline access.
 *
 * Caches the last 200 messages per channel so they display instantly on app
 * load, even before the IRC connection is established. All operations are
 * async and non-blocking — callers should fire-and-forget writes.
 *
 * Schema:
 *   Database: "accord-messages"
 *   Object store: "messages"
 *   Key path: [channel, msgid]   (compound index)
 *   Index: "by-channel" on "channel"
 *
 * Messages are stored as plain objects (no Map/Set/Date — those are
 * serialized to JSON-safe forms).
 */

const DB_NAME = 'accord-messages';
const DB_VERSION = 1;
const STORE_NAME = 'messages';
const MAX_CACHED_PER_CHANNEL = 200;

// ---------------------------------------------------------------------------
// Serialization — IndexedDB can't store Map, Set, or Date instances
// ---------------------------------------------------------------------------

export interface CachedMessage {
	msgid: string;
	nick: string;
	account: string;
	target: string;
	text: string;
	/** ISO 8601 string (Date serialized for storage). */
	time: string;
	tags: Record<string, string>;
	replyTo?: string;
	threadId?: string;
	/** emoji -> account[] (Map<string, Set<string>> serialized). */
	reactions: Record<string, string[]>;
	isRedacted: boolean;
	isEdited?: boolean;
	editHistory?: string[];
	type: string;
	/** Lowercase channel key for indexing. */
	channel: string;
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

let _dbPromise: Promise<IDBDatabase> | null = null;

/** Open (or create) the database. Cached for reuse. */
function openDB(): Promise<IDBDatabase> {
	if (_dbPromise) return _dbPromise;

	_dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB not available'));
			return;
		}

		const req = indexedDB.open(DB_NAME, DB_VERSION);

		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, {
					keyPath: ['channel', 'msgid'],
				});
				store.createIndex('by-channel', 'channel', { unique: false });
			}
		};

		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			_dbPromise = null;
			reject(req.error);
		};
	});

	return _dbPromise;
}

// ---------------------------------------------------------------------------
// Write operations (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Cache messages for a channel. Keeps only the newest MAX_CACHED_PER_CHANNEL.
 * Replaces all cached messages for the channel in a single transaction.
 */
export async function cacheMessages(
	channel: string,
	messages: CachedMessage[],
): Promise<void> {
	const db = await openDB();

	// Keep only the newest messages
	const toStore = messages.slice(-MAX_CACHED_PER_CHANNEL);

	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(tx.objectStoreNames[0]);
	const idx = store.index('by-channel');

	// Delete existing messages for this channel
	const range = IDBKeyRange.only(channel);
	const cursorReq = idx.openCursor(range);

	await new Promise<void>((resolve, reject) => {
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (cursor) {
				cursor.delete();
				cursor.continue();
			} else {
				resolve();
			}
		};
		cursorReq.onerror = () => reject(cursorReq.error);
	});

	// Write new messages
	for (const msg of toStore) {
		store.put(msg);
	}

	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Append a single message to the cache for a channel.
 * If the channel exceeds MAX_CACHED_PER_CHANNEL, evicts the oldest.
 */
export async function cacheMessage(msg: CachedMessage): Promise<void> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(tx.objectStoreNames[0]);

	store.put(msg);

	// Evict oldest messages (by time) if over limit
	const idx = store.index('by-channel');
	const allReq = idx.getAll(IDBKeyRange.only(msg.channel));

	await new Promise<void>((resolve, reject) => {
		allReq.onsuccess = () => {
			const all = allReq.result as CachedMessage[];
			if (all.length > MAX_CACHED_PER_CHANNEL) {
				// Sort by time ascending, delete the oldest excess entries
				all.sort((a, b) => a.time.localeCompare(b.time));
				const excess = all.length - MAX_CACHED_PER_CHANNEL;
				for (let i = 0; i < excess; i++) {
					store.delete([all[i].channel, all[i].msgid]);
				}
			}
			resolve();
		};
		allReq.onerror = () => reject(allReq.error);
	});

	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Load cached messages for a channel, sorted by time ascending.
 * Returns an empty array if no cache exists or IndexedDB is unavailable.
 */
export async function loadCachedMessages(channel: string): Promise<CachedMessage[]> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readonly');
	const store = tx.objectStore(tx.objectStoreNames[0]);
	const idx = store.index('by-channel');

	return new Promise<CachedMessage[]>((resolve, reject) => {
		const req = idx.getAll(IDBKeyRange.only(channel));
		req.onsuccess = () => {
			const messages = (req.result as CachedMessage[]) ?? [];
			// Sort by time ascending (oldest first)
			messages.sort((a, b) => a.time.localeCompare(b.time));
			resolve(messages);
		};
		req.onerror = () => reject(req.error);
	});
}

/**
 * Get all channel keys that have cached messages.
 */
export async function getCachedChannels(): Promise<string[]> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readonly');
	const store = tx.objectStore(tx.objectStoreNames[0]);
	const idx = store.index('by-channel');

	return new Promise<string[]>((resolve, reject) => {
		const req = idx.getAllKeys();
		req.onsuccess = () => {
			const keys = req.result as IDBValidKey[];
			const unique = [...new Set(keys.map(String))];
			resolve(unique);
		};
		req.onerror = () => reject(req.error);
	});
}

/**
 * Delete all cached messages for a channel.
 */
export async function clearCachedChannel(channel: string): Promise<void> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(tx.objectStoreNames[0]);
	const idx = store.index('by-channel');

	const range = IDBKeyRange.only(channel);
	const cursorReq = idx.openCursor(range);

	await new Promise<void>((resolve, reject) => {
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (cursor) {
				cursor.delete();
				cursor.continue();
			} else {
				resolve();
			}
		};
		cursorReq.onerror = () => reject(cursorReq.error);
	});

	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Delete the entire database. Used for logout / cache reset.
 */
export async function clearAllCachedMessages(): Promise<void> {
	// Close existing connection
	if (_dbPromise) {
		try {
			const db = await _dbPromise;
			db.close();
		} catch {
			// Ignore
		}
		_dbPromise = null;
	}

	return new Promise<void>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			resolve();
			return;
		}
		const req = indexedDB.deleteDatabase(DB_NAME);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
		req.onblocked = () => resolve(); // Best effort
	});
}

// ---------------------------------------------------------------------------
// Serialization helpers (used by message store integration)
// ---------------------------------------------------------------------------

/**
 * Convert a live Message object to a CachedMessage for storage.
 */
export function serializeMessage(
	msg: {
		msgid: string;
		nick: string;
		account: string;
		target: string;
		text: string;
		time: Date;
		tags: Record<string, string>;
		replyTo?: string;
		threadId?: string;
		reactions: Map<string, Set<string>>;
		isRedacted: boolean;
		isEdited?: boolean;
		editHistory?: string[];
		type: string;
	},
	channel: string,
): CachedMessage {
	const reactions: Record<string, string[]> = {};
	for (const [emoji, accounts] of msg.reactions) {
		reactions[emoji] = [...accounts];
	}

	return {
		msgid: msg.msgid,
		nick: msg.nick,
		account: msg.account,
		target: msg.target,
		text: msg.text,
		time: msg.time.toISOString(),
		tags: msg.tags,
		replyTo: msg.replyTo,
		threadId: msg.threadId,
		reactions,
		isRedacted: msg.isRedacted,
		isEdited: msg.isEdited,
		editHistory: msg.editHistory,
		type: msg.type,
		channel,
	};
}

/**
 * Convert a CachedMessage back to the shape expected by addMessage/prependMessages.
 * The caller is responsible for converting to the full Message type.
 */
export function deserializeMessage(cached: CachedMessage): {
	msgid: string;
	nick: string;
	account: string;
	target: string;
	text: string;
	time: Date;
	tags: Record<string, string>;
	replyTo?: string;
	threadId?: string;
	reactions: Map<string, Set<string>>;
	isRedacted: boolean;
	isEdited?: boolean;
	editHistory?: string[];
	type: string;
} {
	const reactions = new Map<string, Set<string>>();
	for (const [emoji, accounts] of Object.entries(cached.reactions)) {
		reactions.set(emoji, new Set(accounts));
	}

	return {
		msgid: cached.msgid,
		nick: cached.nick,
		account: cached.account,
		target: cached.target,
		text: cached.text,
		time: new Date(cached.time),
		tags: cached.tags,
		replyTo: cached.replyTo,
		threadId: cached.threadId,
		reactions,
		isRedacted: cached.isRedacted,
		isEdited: cached.isEdited,
		editHistory: cached.editHistory,
		type: cached.type,
	};
}
