/**
 * Reactive buffer for raw IRC lines (debug panel).
 *
 * Stores the last 200 incoming/outgoing IRC lines with timestamps.
 * Used by the Advanced settings "Show raw IRC messages" feature.
 */

const MAX_RAW_LINES = 200;

export interface RawIrcLine {
	direction: 'in' | 'out';
	line: string;
	time: Date;
}

let _lines: RawIrcLine[] = $state([]);

/** Reactive accessor for the raw IRC log. */
export const rawIrcLog = {
	get lines() { return _lines; },
};

/** Commands that may contain credentials — redact their content. */
const SENSITIVE_COMMANDS = /^(AUTHENTICATE|PASS)\b/i;

/** Append a raw IRC line to the buffer, evicting oldest if over limit. Redacts sensitive commands. */
export function pushRawLine(direction: 'in' | 'out', line: string): void {
	const redacted = SENSITIVE_COMMANDS.test(line)
		? line.replace(/\s+.*$/, ' [REDACTED]')
		: line;
	_lines.push({ direction, line: redacted, time: new Date() });
	if (_lines.length > MAX_RAW_LINES) {
		_lines = _lines.slice(_lines.length - MAX_RAW_LINES);
	}
}

/** Clear the raw IRC log buffer. */
export function clearRawLog(): void {
	_lines = [];
}
