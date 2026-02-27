import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IRCConnection } from './connection';
import type { ConnectionState } from './connection';

// Polyfill CloseEvent for Node.js test environment (vitest runs in Node by default)
if (typeof globalThis.CloseEvent === 'undefined') {
	globalThis.CloseEvent = class CloseEvent extends Event {
		code: number;
		reason: string;
		wasClean: boolean;
		constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
			super(type);
			this.code = init?.code ?? 1000;
			this.reason = init?.reason ?? '';
			this.wasClean = init?.wasClean ?? false;
		}
	} as typeof globalThis.CloseEvent;
}

/**
 * Mock WebSocket that simulates the browser WebSocket API.
 * We test the IRCConnection class by controlling when the mock
 * WebSocket fires open/message/close/error events.
 */
class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	url: string;
	readyState: number = MockWebSocket.CONNECTING;
	onopen: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onclose: ((ev: CloseEvent) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	sentData: string[] = [];

	constructor(url: string) {
		this.url = url;
		// Store instance so tests can access it
		MockWebSocket.instances.push(this);
	}

	send(data: string) {
		this.sentData.push(data);
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
		if (this.onclose) {
			this.onclose(new CloseEvent('close'));
		}
	}

	// Test helpers
	simulateOpen() {
		this.readyState = MockWebSocket.OPEN;
		if (this.onopen) {
			this.onopen(new Event('open'));
		}
	}

	simulateMessage(data: string) {
		if (this.onmessage) {
			this.onmessage(new MessageEvent('message', { data }));
		}
	}

	simulateError() {
		if (this.onerror) {
			this.onerror(new Event('error'));
		}
	}

	simulateClose(code = 1006) {
		this.readyState = MockWebSocket.CLOSED;
		if (this.onclose) {
			this.onclose(new CloseEvent('close', { code }));
		}
	}

	static instances: MockWebSocket[] = [];
	static reset() {
		MockWebSocket.instances = [];
	}
}

// Install mock WebSocket globally
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
	MockWebSocket.reset();
	(globalThis as any).WebSocket = MockWebSocket as any;
	vi.useFakeTimers();
});

afterEach(() => {
	globalThis.WebSocket = originalWebSocket;
	vi.useRealTimers();
});

function latestMockWs(): MockWebSocket {
	return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

describe('IRCConnection', () => {
	describe('connect', () => {
		it('creates a WebSocket and resolves when opened', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			expect(conn.state).toBe('disconnected' satisfies ConnectionState);

			const connectPromise = conn.connect();
			expect(conn.state).toBe('connecting' satisfies ConnectionState);

			const ws = latestMockWs();
			expect(ws.url).toBe('ws://localhost:8097');
			ws.simulateOpen();

			await connectPromise;
			expect(conn.state).toBe('connected' satisfies ConnectionState);
		});

		it('rejects if WebSocket errors during connect', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();

			const ws = latestMockWs();
			ws.simulateError();
			ws.simulateClose();

			await expect(connectPromise).rejects.toThrow();
		});
	});

	describe('send', () => {
		it('sends a raw IRC line with \\r\\n appended', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.send('NICK testuser');
			expect(latestMockWs().sentData).toEqual(['NICK testuser\r\n']);
		});
	});

	describe('message events', () => {
		it('emits message events for complete IRC lines', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const messages: string[] = [];
			conn.on('message', (line: string) => messages.push(line));

			latestMockWs().simulateMessage(':server PING :test\r\n');
			expect(messages).toEqual([':server PING :test']);
		});

		it('handles bare WebSocket frames without CRLF (Ergo style)', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const messages: string[] = [];
			conn.on('message', (line: string) => messages.push(line));

			latestMockWs().simulateMessage(':server PING :test');
			expect(messages).toEqual([':server PING :test']);
		});

		it('handles multiple lines in a single message', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const messages: string[] = [];
			conn.on('message', (line: string) => messages.push(line));

			latestMockWs().simulateMessage('PING :a\r\nPING :b\r\n');
			expect(messages).toEqual(['PING :a', 'PING :b']);
		});
	});

	describe('disconnect', () => {
		it('closes the WebSocket and updates state', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.disconnect();
			expect(conn.state).toBe('disconnected' satisfies ConnectionState);
		});

		it('emits close event', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const closed = vi.fn();
			conn.on('close', closed);

			conn.disconnect();
			expect(closed).toHaveBeenCalled();
		});
	});

	describe('auto-reconnect', () => {
		it('attempts reconnect with exponential backoff on unexpected close', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const reconnecting = vi.fn();
			conn.on('reconnecting', reconnecting);

			// Simulate unexpected close
			latestMockWs().simulateClose(1006);
			expect(conn.state).toBe('reconnecting' satisfies ConnectionState);

			// First reconnect after 1s
			await vi.advanceTimersByTimeAsync(1000);
			expect(reconnecting).toHaveBeenCalledTimes(1);
			expect(reconnecting).toHaveBeenLastCalledWith(1);
			expect(MockWebSocket.instances.length).toBe(2);

			// Simulate failure on reconnect
			latestMockWs().simulateError();
			latestMockWs().simulateClose(1006);

			// Second reconnect after 2s
			await vi.advanceTimersByTimeAsync(2000);
			expect(reconnecting).toHaveBeenCalledTimes(2);
			expect(reconnecting).toHaveBeenLastCalledWith(2);
			expect(MockWebSocket.instances.length).toBe(3);

			// Simulate failure again
			latestMockWs().simulateError();
			latestMockWs().simulateClose(1006);

			// Third reconnect after 4s
			await vi.advanceTimersByTimeAsync(4000);
			expect(reconnecting).toHaveBeenCalledTimes(3);
			expect(reconnecting).toHaveBeenLastCalledWith(3);
			expect(MockWebSocket.instances.length).toBe(4);
		});

		it('fires reconnected event on successful reconnect', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const reconnected = vi.fn();
			conn.on('reconnected', reconnected);

			// Simulate unexpected close
			latestMockWs().simulateClose(1006);

			// Advance to first reconnect attempt
			await vi.advanceTimersByTimeAsync(1000);
			// New WS created, simulate successful open
			latestMockWs().simulateOpen();

			expect(reconnected).toHaveBeenCalledTimes(1);
			expect(conn.state).toBe('connected' satisfies ConnectionState);
		});

		it('caps backoff at 30 seconds', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			// Simulate unexpected close
			latestMockWs().simulateClose(1006);

			// Fail through several backoff cycles: 1s, 2s, 4s, 8s, 16s, 30s (capped)
			for (let i = 0; i < 5; i++) {
				const delay = Math.min(1000 * Math.pow(2, i), 30000);
				await vi.advanceTimersByTimeAsync(delay);
				latestMockWs().simulateError();
				latestMockWs().simulateClose(1006);
			}

			// 6th attempt should be capped at 30s (not 32s)
			const instancesBefore = MockWebSocket.instances.length;
			await vi.advanceTimersByTimeAsync(30000);
			expect(MockWebSocket.instances.length).toBe(instancesBefore + 1);
		});

		it('does not reconnect after explicit disconnect', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.disconnect();

			await vi.advanceTimersByTimeAsync(5000);
			// Should still be just 1 WebSocket instance (no reconnect attempts)
			expect(MockWebSocket.instances.length).toBe(1);
		});
	});

	describe('send security', () => {
		it('strips CR/LF to prevent IRC command injection', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.send('PRIVMSG #test :hello\r\nQUIT :injected');
			expect(latestMockWs().sentData).toEqual(['PRIVMSG #test :helloQUIT :injected\r\n']);
		});

		it('strips lone CR from outgoing messages', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.send('PRIVMSG #test :line1\rline2');
			expect(latestMockWs().sentData).toEqual(['PRIVMSG #test :line1line2\r\n']);
		});

		it('strips lone LF from outgoing messages', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.send('PRIVMSG #test :line1\nline2');
			expect(latestMockWs().sentData).toEqual(['PRIVMSG #test :line1line2\r\n']);
		});

		it('returns false when WebSocket is not open', () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			// Not connected yet — send should return false
			expect(conn.send('PING :test')).toBe(false);
		});

		it('returns false after disconnect', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			conn.disconnect();
			expect(conn.send('PING :test')).toBe(false);
		});

		it('returns true on successful send', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			expect(conn.send('PING :test')).toBe(true);
		});
	});

	describe('connect timeout', () => {
		it('rejects after 10s if server never responds', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();

			// Attach rejection handler before advancing timers to prevent unhandled rejection
			const rejection = connectPromise.then(() => null, (e: Error) => e);

			// Advance past the 10s timeout
			await vi.advanceTimersByTimeAsync(10_000);

			const err = await rejection;
			expect(err).toBeInstanceOf(Error);
			expect(err!.message).toContain('timed out');
			// After timeout, onclose triggers scheduleReconnect (auto-reconnect is correct behavior)
			expect(conn.state).toBe('reconnecting' satisfies ConnectionState);
			// Cleanly stop reconnect attempts
			conn.disconnect();
		});

		it('rejects concurrent connect attempt', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			conn.connect(); // First connect — in progress

			await expect(conn.connect()).rejects.toThrow('already connecting');
		});

		it('rejects connect when already connected', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const p = conn.connect();
			latestMockWs().simulateOpen();
			await p;

			await expect(conn.connect()).rejects.toThrow('already connected');
		});
	});

	describe('event emitter', () => {
		it('supports multiple handlers for the same event', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const handler1 = vi.fn();
			const handler2 = vi.fn();
			conn.on('message', handler1);
			conn.on('message', handler2);

			latestMockWs().simulateMessage('PING :test\r\n');
			expect(handler1).toHaveBeenCalledWith('PING :test');
			expect(handler2).toHaveBeenCalledWith('PING :test');
		});

		it('emits error events', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const errorHandler = vi.fn();
			conn.on('error', errorHandler);

			latestMockWs().simulateError();
			expect(errorHandler).toHaveBeenCalled();
		});

		it('isolates handler errors — one throwing handler does not block others', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const connectPromise = conn.connect();
			latestMockWs().simulateOpen();
			await connectPromise;

			const thrower = () => { throw new Error('handler failure'); };
			const survivor = vi.fn();
			conn.on('message', thrower);
			conn.on('message', survivor);

			latestMockWs().simulateMessage('PING :test\r\n');
			expect(survivor).toHaveBeenCalledWith('PING :test');
		});

		it('off() returns true when handler is removed', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const handler = vi.fn();
			conn.on('message', handler);
			expect(conn.off('message', handler)).toBe(true);
		});

		it('off() returns false when handler was not registered', async () => {
			const conn = new IRCConnection({ url: 'ws://localhost:8097' });
			const handler = vi.fn();
			expect(conn.off('message', handler)).toBe(false);
		});
	});
});
