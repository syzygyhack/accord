import { describe, it, expect } from 'vitest';
import {
	connectionState,
	setConnected,
	setDisconnected,
	setReconnecting,
	setConnecting,
	setLatency,
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

	it('setLatency() updates latency', () => {
		setLatency(42);
		expect(connectionState.latency).toBe(42);
	});
});
