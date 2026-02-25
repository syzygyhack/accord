import { describe, it, expect } from 'vitest';
import {
	connectionState,
	setConnected,
	setDisconnected,
	setReconnecting,
	setConnecting,
	setLatency,
	setHydratedFromCache,
	initOnlineTracking,
} from './connection.svelte';

describe('connectionState', () => {
	it('starts as disconnected with no error or latency', () => {
		expect(connectionState.status).toBe('disconnected');
		expect(connectionState.error).toBeNull();
		expect(connectionState.latency).toBeNull();
	});

	it('setConnecting() sets status to connecting', () => {
		setConnecting();
		expect(connectionState.status).toBe('connecting');
	});

	it('setConnected() sets status and clears error', () => {
		// Put into an error state first
		setDisconnected('network failure');
		expect(connectionState.error).toBe('network failure');

		setConnected();
		expect(connectionState.status).toBe('connected');
		expect(connectionState.error).toBeNull();
	});

	it('setDisconnected() sets status and records error', () => {
		setDisconnected('server closed');
		expect(connectionState.status).toBe('disconnected');
		expect(connectionState.error).toBe('server closed');
		expect(connectionState.latency).toBeNull();
	});

	it('setDisconnected() without error sets error to null', () => {
		setDisconnected();
		expect(connectionState.status).toBe('disconnected');
		expect(connectionState.error).toBeNull();
	});

	it('setReconnecting() sets status to reconnecting', () => {
		setReconnecting();
		expect(connectionState.status).toBe('reconnecting');
	});

	it('setReconnecting() with attempt number tracks the attempt', () => {
		setReconnecting(3);
		expect(connectionState.status).toBe('reconnecting');
		expect(connectionState.reconnectAttempt).toBe(3);
	});

	it('setConnected() resets reconnectAttempt to 0', () => {
		setReconnecting(5);
		expect(connectionState.reconnectAttempt).toBe(5);

		setConnected();
		expect(connectionState.reconnectAttempt).toBe(0);
	});

	it('setLatency() updates latency', () => {
		setLatency(42);
		expect(connectionState.latency).toBe(42);
	});

	it('starts with isOnline defaulting to true (navigator unavailable in test)', () => {
		// In node test env, navigator.onLine defaults to true
		expect(connectionState.isOnline).toBe(true);
	});

	it('starts with hydratedFromCache as false', () => {
		expect(connectionState.hydratedFromCache).toBe(false);
	});

	it('setHydratedFromCache() sets hydratedFromCache to true', () => {
		setHydratedFromCache();
		expect(connectionState.hydratedFromCache).toBe(true);
	});

	it('initOnlineTracking() returns a cleanup function', () => {
		const cleanup = initOnlineTracking();
		expect(typeof cleanup).toBe('function');
		cleanup();
	});
});
