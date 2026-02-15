/**
 * IRC formatting utilities.
 *
 * Handles mIRC formatting codes ↔ HTML conversion, markdown-to-IRC conversion,
 * URL auto-linking, mention highlighting, and custom emoji rendering.
 */

import { getCustomEmojiMap } from '$lib/emoji';

// mIRC color palette (indices 0-15)
const MIRC_COLORS: string[] = [
	'#ffffff', // 0  white
	'#000000', // 1  black
	'#00007f', // 2  navy
	'#009300', // 3  green
	'#ff0000', // 4  red
	'#7f0000', // 5  brown/maroon
	'#9c009c', // 6  purple
	'#fc7f00', // 7  orange
	'#ffff00', // 8  yellow
	'#00fc00', // 9  light green
	'#009393', // 10 teal
	'#00ffff', // 11 cyan
	'#0000fc', // 12 blue
	'#ff00ff', // 13 pink
	'#7f7f7f', // 14 grey
	'#d2d2d2', // 15 light grey
];

// Control characters
const BOLD = '\x02';
const ITALIC = '\x1D';
const UNDERLINE = '\x1F';
const STRIKETHROUGH = '\x1E';
const MONOSPACE = '\x11';
const COLOR = '\x03';
const RESET = '\x0F';

/** Escape HTML special characters to prevent XSS. */
function escapeHTML(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Convert mIRC formatting codes to HTML.
 *
 * Handles bold, italic, underline, strikethrough, monospace, color (0-15),
 * and reset. Unclosed tags are closed at end of string.
 */
export function renderIRC(text: string): string {
	let result = '';
	let i = 0;

	// Track open tags as a stack for proper nesting
	const openTags: string[] = [];

	// Toggle states
	let bold = false;
	let italic = false;
	let underline = false;
	let strike = false;
	let mono = false;
	let colored = false;

	function closeAll(): void {
		// Close in reverse order
		while (openTags.length > 0) {
			result += openTags.pop();
		}
		bold = false;
		italic = false;
		underline = false;
		strike = false;
		mono = false;
		colored = false;
	}

	function toggleTag(
		flag: boolean,
		openTag: string,
		closeTag: string
	): boolean {
		if (flag) {
			// Close this specific tag - need to handle nesting properly
			// Find and remove the close tag from the stack
			const idx = openTags.lastIndexOf(closeTag);
			if (idx !== -1) {
				// Close everything above it, then reopen
				const toReopen: string[] = [];
				for (let j = openTags.length - 1; j > idx; j--) {
					result += openTags[j];
					toReopen.push(openTags[j]);
				}
				result += closeTag;
				openTags.splice(idx);
				// Reopen the ones we closed
				for (let j = toReopen.length - 1; j >= 0; j--) {
					const close = toReopen[j];
					const open = closeToOpen(close);
					result += open;
					openTags.push(close);
				}
			}
			return false;
		} else {
			result += openTag;
			openTags.push(closeTag);
			return true;
		}
	}

	function closeToOpen(closeTag: string): string {
		switch (closeTag) {
			case '</strong>': return '<strong>';
			case '</em>': return '<em>';
			case '</u>': return '<u>';
			case '</s>': return '<s>';
			case '</code>': return '<code>';
			default: return '';
		}
	}

	while (i < text.length) {
		const ch = text[i];

		if (ch === BOLD) {
			bold = toggleTag(bold, '<strong>', '</strong>');
			i++;
		} else if (ch === ITALIC) {
			italic = toggleTag(italic, '<em>', '</em>');
			i++;
		} else if (ch === UNDERLINE) {
			underline = toggleTag(underline, '<u>', '</u>');
			i++;
		} else if (ch === STRIKETHROUGH) {
			strike = toggleTag(strike, '<s>', '</s>');
			i++;
		} else if (ch === MONOSPACE) {
			mono = toggleTag(mono, '<code>', '</code>');
			i++;
		} else if (ch === RESET) {
			closeAll();
			i++;
		} else if (ch === COLOR) {
			i++; // skip \x03

			// If currently colored, close the span first
			if (colored) {
				const idx = openTags.lastIndexOf('</span>');
				if (idx !== -1) {
					// Close everything above, close span, reopen rest
					const toReopen: string[] = [];
					for (let j = openTags.length - 1; j > idx; j--) {
						result += openTags[j];
						toReopen.push(openTags[j]);
					}
					result += '</span>';
					openTags.splice(idx);
					for (let j = toReopen.length - 1; j >= 0; j--) {
						const close = toReopen[j];
						const open = closeToOpen(close);
						result += open;
						openTags.push(close);
					}
				}
				colored = false;
			}

			// Parse foreground color number
			if (i < text.length && /\d/.test(text[i])) {
				let fgStr = text[i];
				i++;
				if (i < text.length && /\d/.test(text[i])) {
					fgStr += text[i];
					i++;
				}
				const fg = parseInt(fgStr, 10);

				let style = '';
				if (fg >= 0 && fg <= 15) {
					style = `color:${MIRC_COLORS[fg]}`;
				}

				// Check for background color
				if (i < text.length && text[i] === ',') {
					i++; // skip comma
					if (i < text.length && /\d/.test(text[i])) {
						let bgStr = text[i];
						i++;
						if (i < text.length && /\d/.test(text[i])) {
							bgStr += text[i];
							i++;
						}
						const bg = parseInt(bgStr, 10);
						if (bg >= 0 && bg <= 15) {
							style += `;background-color:${MIRC_COLORS[bg]}`;
						}
					}
				}

				if (style) {
					result += `<span style="${style}">`;
					openTags.push('</span>');
					colored = true;
				}
			}
			// Bare \x03 with no digits = color reset (already handled above)
		} else {
			result += escapeHTML(ch);
			i++;
		}
	}

	// Close any unclosed tags
	closeAll();

	return result;
}

/**
 * Convert markdown-like input to mIRC formatting codes.
 *
 * Supports: **bold**, *italic*, ~~strike~~, `code`
 * Bold must be processed before italic to avoid ambiguity.
 */
export function markdownToIRC(text: string): string {
	let result = text;

	// Bold: **text** → \x02text\x02 (must come before italic)
	result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD}`);

	// Italic: *text* → \x1Dtext\x1D
	result = result.replace(/\*(.+?)\*/g, `${ITALIC}$1${ITALIC}`);

	// Strikethrough: ~~text~~ → \x1Etext\x1E
	result = result.replace(/~~(.+?)~~/g, `${STRIKETHROUGH}$1${STRIKETHROUGH}`);

	// Inline code: `text` → \x11text\x11
	result = result.replace(/`(.+?)`/g, `${MONOSPACE}$1${MONOSPACE}`);

	return result;
}

/**
 * Auto-detect URLs and wrap them in anchor tags.
 *
 * Handles http:// and https:// URLs. Skips URLs already inside anchor tags.
 *
 * **WARNING: XSS Safety** — This function assumes the input text has already
 * been HTML-escaped (e.g. by `renderIRC()`). Calling this on raw, unescaped
 * user input WILL create an XSS vulnerability. Use `renderMessage()` instead
 * of calling this directly.
 */
export function linkify(text: string): string {
	// Don't process if already contains anchor tags (pre-linkified)
	if (/<a\s/i.test(text)) {
		return text;
	}

	return text.replace(
		/(https?:\/\/[^\s<>"]+)/g,
		(url) => {
			const href = escapeHTML(url);
			return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHTML(url)}</a>`;
		}
	);
}

/**
 * Highlight @mentions and #channel references in text.
 *
 * - @username → wrapped in span with class "mention" (or "mention mention-self" if own account)
 * - #channel → wrapped in span with class "channel-ref"
 *
 * **WARNING: XSS Safety** — This function assumes the input text has already
 * been HTML-escaped (e.g. by `renderIRC()`). Calling this on raw, unescaped
 * user input WILL create an XSS vulnerability. Use `renderMessage()` instead
 * of calling this directly.
 */
export function highlightMentions(text: string, myAccount: string): string {
	// Highlight @mentions
	let result = text.replace(/@(\w+)/g, (match, name: string) => {
		const isSelf = name.toLowerCase() === myAccount.toLowerCase();
		const cls = isSelf ? 'mention mention-self' : 'mention';
		return `<span class="${cls}">${match}</span>`;
	});

	// Highlight #channel references
	result = result.replace(/#(\w[\w-]*)/g, (match) => {
		return `<span class="channel-ref">${match}</span>`;
	});

	return result;
}

/**
 * Compute a deterministic nick color from an account name.
 *
 * Uses djb2 hash → hue, with fixed 65% saturation and 65% lightness (dark theme).
 */
export function nickColor(account: string): string {
	let hash = 5381;
	for (let i = 0; i < account.length; i++) {
		hash = ((hash << 5) + hash + account.charCodeAt(i)) | 0;
	}
	const hue = (hash >>> 0) % 360;
	return `hsl(${hue}, 65%, 65%)`;
}

/**
 * Replace :customname: patterns with inline <img> tags for custom server emoji.
 *
 * Only replaces names that exist in the custom emoji map. Unknown :name: patterns
 * are left as plain text. Skips patterns inside HTML tags or anchor hrefs.
 *
 * **WARNING: XSS Safety** — This function assumes the input text has already
 * been HTML-escaped. The emoji names are validated against the known map, and
 * URLs come from the server config (not user input).
 */
export function renderCustomEmoji(text: string): string {
	const emojiMap = getCustomEmojiMap();
	if (emojiMap.size === 0) return text;

	return text.replace(/:([a-zA-Z0-9_-]+):/g, (match, name: string) => {
		const url = emojiMap.get(name);
		if (!url) return match; // Unknown custom emoji — leave as plain text
		return `<img class="custom-emoji" src="${escapeHTML(url)}" alt=":${escapeHTML(name)}:" title=":${escapeHTML(name)}:" />`;
	});
}

/**
 * Render an IRC message to safe HTML.
 *
 * Applies the full rendering pipeline in the **required** order:
 * 1. `renderIRC()` — escapes HTML and converts mIRC formatting codes to HTML tags
 * 2. `linkify()` — wraps URLs in anchor tags (assumes pre-escaped input)
 * 3. `highlightMentions()` — wraps @mentions and #channels in styled spans
 * 4. `renderCustomEmoji()` — replaces :name: patterns with server custom emoji images
 *
 * **This is the only safe entry point** for rendering user-generated message text
 * to HTML. Do not call `linkify()` or `highlightMentions()` directly on unescaped
 * text — doing so creates an XSS vulnerability.
 */
export function renderMessage(text: string, myAccount: string): string {
	let html = renderIRC(text);
	html = linkify(html);
	html = highlightMentions(html, myAccount);
	html = renderCustomEmoji(html);
	return html;
}
