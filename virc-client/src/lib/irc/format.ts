/**
 * IRC formatting utilities.
 *
 * Handles mIRC formatting codes ↔ HTML conversion, markdown-to-IRC conversion,
 * URL auto-linking, mention highlighting, and custom emoji rendering.
 */

import { getCustomEmojiMap } from '$lib/emoji';
import { URL_PATTERN_SOURCE } from '$lib/constants';

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

/** HTML escape lookup for single-pass replacement. */
const HTML_ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};
const HTML_ESCAPE_RE = /[&<>"']/g;

/** Escape HTML special characters to prevent XSS. Single-pass for efficiency. */
function escapeHTML(text: string): string {
	return text.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]);
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
			// Check for spoiler pattern: \x11[spoiler]\x11...\x11[/spoiler]\x11
			const spoilerOpen = `${MONOSPACE}[spoiler]${MONOSPACE}`;
			const spoilerClose = `${MONOSPACE}[/spoiler]${MONOSPACE}`;
			if (text.startsWith(spoilerOpen, i)) {
				const contentStart = i + spoilerOpen.length;
				const closeIdx = text.indexOf(spoilerClose, contentStart);
				if (closeIdx !== -1) {
					const content = text.slice(contentStart, closeIdx);
					result += `<span class="spoiler">${escapeHTML(content)}</span>`;
					i = closeIdx + spoilerClose.length;
					continue;
				}
			}
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
 * Supports: **bold**, *italic*, ~~strike~~, `code`, ||spoiler||
 * Bold must be processed before italic to avoid ambiguity.
 * Spoiler must be processed before code to avoid `||` being left as plain text.
 */
export function markdownToIRC(text: string): string {
	let result = text;

	// Bold: **text** → \x02text\x02 (must come before italic)
	result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD}`);

	// Italic: *text* → \x1Dtext\x1D
	result = result.replace(/\*(.+?)\*/g, `${ITALIC}$1${ITALIC}`);

	// Strikethrough: ~~text~~ → \x1Etext\x1E
	result = result.replace(/~~(.+?)~~/g, `${STRIKETHROUGH}$1${STRIKETHROUGH}`);

	// Spoiler: ||text|| → \x11[spoiler]\x11text\x11[/spoiler]\x11
	result = result.replace(/\|\|(.+?)\|\|/g, `${MONOSPACE}[spoiler]${MONOSPACE}$1${MONOSPACE}[/spoiler]${MONOSPACE}`);

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

	// The input is already HTML-escaped by renderIRC(), so matched URLs
	// contain entities like &amp;. We must NOT double-escape them.
	// The href needs entities decoded back for a valid URL, while the
	// display text is kept as-is (already safe HTML).
	return text.replace(
		new RegExp(`(${URL_PATTERN_SOURCE})`, 'g'),
		(match) => {
			// Strip trailing punctuation that's unlikely to be part of the URL
			const trailingMatch = match.match(/[.,;:!?)]+$/);
			const trailing = trailingMatch ? trailingMatch[0] : '';
			const url = trailing ? match.slice(0, -trailing.length) : match;
			if (!url) return match;

			// Decode HTML entities back to raw URL for the href attribute
			const href = url
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'");
			return `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
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
	// Highlight @mentions (IRC nicks can contain letters, digits, -, _, [, ], {, }, \, ^)
	let result = text.replace(/@([\w\-\[\]{}\\\^]+)/g, (match, name: string) => {
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
 * Uses djb2 hash → hue, with fixed 65% saturation. Lightness adapts to theme:
 * 65% for dark/amoled/compact themes, 40% for light theme.
 */
export function nickColor(account: string, theme: 'dark' | 'light' | 'amoled' | 'compact' = 'dark'): string {
	let hash = 5381;
	for (let i = 0; i < account.length; i++) {
		hash = ((hash << 5) + hash + account.charCodeAt(i)) | 0;
	}
	const hue = (hash >>> 0) % 360;
	const lightness = theme === 'light' ? 40 : 65;
	return `hsl(${hue}, 65%, ${lightness}%)`;
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

// Language alias map for syntax highlighting
const LANG_ALIASES: Record<string, string> = {
	js: 'javascript',
	ts: 'typescript',
	py: 'python',
	rb: 'ruby',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	yml: 'yaml',
	md: 'markdown',
};

// Keyword sets per language (resolved name)
const LANG_KEYWORDS: Record<string, string[]> = {
	javascript: [
		'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
		'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
		'extends', 'import', 'export', 'default', 'from', 'async', 'await',
		'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
		'yield', 'delete', 'void', 'with', 'debugger', 'super', 'static',
	],
	typescript: [
		'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
		'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
		'extends', 'import', 'export', 'default', 'from', 'async', 'await',
		'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
		'yield', 'delete', 'void', 'with', 'debugger', 'super', 'static',
		'type', 'interface', 'enum', 'namespace', 'declare', 'implements',
		'abstract', 'as', 'is', 'keyof', 'readonly', 'private', 'protected',
		'public', 'override',
	],
	python: [
		'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break',
		'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise',
		'with', 'yield', 'lambda', 'pass', 'del', 'global', 'nonlocal', 'assert',
		'async', 'await', 'in', 'not', 'and', 'or', 'is',
	],
	go: [
		'func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case',
		'break', 'continue', 'type', 'struct', 'interface', 'map', 'chan',
		'go', 'select', 'defer', 'package', 'import', 'var', 'const',
		'fallthrough', 'default',
	],
	rust: [
		'fn', 'let', 'mut', 'const', 'return', 'if', 'else', 'for', 'while',
		'loop', 'match', 'break', 'continue', 'struct', 'enum', 'impl', 'trait',
		'pub', 'use', 'mod', 'crate', 'self', 'super', 'as', 'in', 'ref',
		'move', 'async', 'await', 'where', 'type', 'unsafe', 'extern', 'dyn',
	],
	shell: [
		'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done',
		'case', 'esac', 'function', 'return', 'exit', 'export', 'local',
		'readonly', 'set', 'unset', 'shift', 'source', 'in',
	],
	css: [
		'@import', '@media', '@keyframes', '@font-face', '@supports',
		'!important',
	],
	ruby: [
		'def', 'class', 'module', 'end', 'if', 'elsif', 'else', 'unless',
		'while', 'until', 'for', 'do', 'begin', 'rescue', 'ensure', 'raise',
		'return', 'yield', 'block_given?', 'require', 'include', 'attr_accessor',
		'attr_reader', 'attr_writer', 'self', 'super', 'nil', 'true', 'false',
		'and', 'or', 'not', 'in', 'then', 'when', 'case',
	],
};

// Literals per language
const LANG_LITERALS: Record<string, string[]> = {
	javascript: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
	typescript: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
	python: ['True', 'False', 'None'],
	go: ['true', 'false', 'nil', 'iota'],
	rust: ['true', 'false', 'None', 'Some', 'Ok', 'Err'],
	json: ['true', 'false', 'null'],
	shell: ['true', 'false'],
};

/**
 * Apply lightweight syntax highlighting to a code string.
 *
 * Tokenizes the code and wraps recognized tokens in spans with hljs-compatible
 * class names: hljs-keyword, hljs-literal, hljs-string, hljs-number, hljs-comment.
 *
 * Input code must NOT be HTML-escaped — this function handles escaping internally.
 */
function highlightCode(code: string, lang: string): string {
	const resolved = LANG_ALIASES[lang] || lang;
	const keywords = new Set(LANG_KEYWORDS[resolved] || []);
	const literals = new Set(LANG_LITERALS[resolved] || []);

	// Comment styles per language
	const hasLineComments = !['json', 'css', 'html'].includes(resolved);
	const hasBlockComments = !['python', 'shell', 'yaml'].includes(resolved);
	const hasPythonComments = resolved === 'python';
	const hasShellComments = resolved === 'shell';

	let result = '';
	let i = 0;

	while (i < code.length) {
		// Line comments: // (most langs) or # (python, shell)
		if (hasLineComments && code[i] === '/' && code[i + 1] === '/') {
			const end = code.indexOf('\n', i);
			const comment = end === -1 ? code.slice(i) : code.slice(i, end);
			result += `<span class="hljs-comment">${escapeHTML(comment)}</span>`;
			i += comment.length;
			continue;
		}
		if ((hasPythonComments || hasShellComments) && code[i] === '#') {
			const end = code.indexOf('\n', i);
			const comment = end === -1 ? code.slice(i) : code.slice(i, end);
			result += `<span class="hljs-comment">${escapeHTML(comment)}</span>`;
			i += comment.length;
			continue;
		}

		// Block comments: /* ... */
		if (hasBlockComments && code[i] === '/' && code[i + 1] === '*') {
			const end = code.indexOf('*/', i + 2);
			const comment = end === -1 ? code.slice(i) : code.slice(i, end + 2);
			result += `<span class="hljs-comment">${escapeHTML(comment)}</span>`;
			i += comment.length;
			continue;
		}

		// Strings: "..." or '...' (with backslash escapes)
		if (code[i] === '"' || code[i] === "'") {
			const quote = code[i];
			let j = i + 1;
			while (j < code.length && code[j] !== quote) {
				if (code[j] === '\\') j++; // skip escaped char
				j++;
			}
			if (j < code.length) j++; // include closing quote
			const str = code.slice(i, j);
			result += `<span class="hljs-string">${escapeHTML(str)}</span>`;
			i = j;
			continue;
		}

		// Template literals: `...`
		if (code[i] === '`' && ['javascript', 'typescript'].includes(resolved)) {
			let j = i + 1;
			while (j < code.length && code[j] !== '`') {
				if (code[j] === '\\') j++;
				j++;
			}
			if (j < code.length) j++;
			const str = code.slice(i, j);
			result += `<span class="hljs-string">${escapeHTML(str)}</span>`;
			i = j;
			continue;
		}

		// Numbers
		if (/\d/.test(code[i]) && (i === 0 || /[\s,;:=+\-*/%<>(&[{!|^~?]/.test(code[i - 1]))) {
			let j = i;
			// Hex: 0x...
			if (code[j] === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
				j += 2;
				while (j < code.length && /[0-9a-fA-F_]/.test(code[j])) j++;
			} else {
				while (j < code.length && /[0-9._eE+\-]/.test(code[j])) j++;
			}
			const num = code.slice(i, j);
			result += `<span class="hljs-number">${escapeHTML(num)}</span>`;
			i = j;
			continue;
		}

		// Words (identifiers, keywords, literals)
		if (/[a-zA-Z_$@!]/.test(code[i])) {
			let j = i;
			while (j < code.length && /[a-zA-Z0-9_$?]/.test(code[j])) j++;
			const word = code.slice(i, j);
			if (literals.has(word)) {
				result += `<span class="hljs-literal">${escapeHTML(word)}</span>`;
			} else if (keywords.has(word)) {
				result += `<span class="hljs-keyword">${escapeHTML(word)}</span>`;
			} else {
				result += escapeHTML(word);
			}
			i = j;
			continue;
		}

		// Default: escape and output character
		result += escapeHTML(code[i]);
		i++;
	}

	return result;
}

/**
 * Detect and render fenced code blocks (``` ... ```) in message text.
 *
 * Matches ``` optionally followed by a language hint, then content until
 * closing ```. Code blocks with a language hint get syntax highlighting;
 * blocks without a hint render as plain monospace.
 *
 * Text outside code blocks is returned unchanged.
 * HTML inside code blocks is escaped to prevent XSS.
 *
 * This function operates on **raw** message text (before renderIRC or linkify)
 * because code blocks should not have IRC formatting applied inside them.
 */
export function renderCodeBlocks(text: string): string {
	const FENCE = /```(\w*)\n([\s\S]*?)```/g;
	let lastIndex = 0;
	let result = '';
	let match: RegExpExecArray | null;

	while ((match = FENCE.exec(text)) !== null) {
		// Append text before this code block (unchanged)
		result += text.slice(lastIndex, match.index);

		const lang = match[1]; // language hint (may be empty)
		const code = match[2]; // code content

		if (lang) {
			const highlighted = highlightCode(code, lang);
			result += `<pre class="code-block"><code class="language-${escapeHTML(lang)}">${highlighted}</code></pre>`;
		} else {
			result += `<pre class="code-block"><code>${escapeHTML(code)}</code></pre>`;
		}

		lastIndex = FENCE.lastIndex;
	}

	// Append remaining text after last code block
	result += text.slice(lastIndex);
	return result;
}

/**
 * Render an IRC message to safe HTML.
 *
 * Applies the full rendering pipeline in the **required** order:
 * 0. `renderCodeBlocks()` — extracts and highlights fenced code blocks (before IRC processing)
 * 1. `renderIRC()` — escapes HTML and converts mIRC formatting codes to HTML tags (on non-code parts)
 * 2. `linkify()` — wraps URLs in anchor tags (assumes pre-escaped input)
 * 3. `highlightMentions()` — wraps @mentions and #channels in styled spans
 * 4. `renderCustomEmoji()` — replaces :name: patterns with server custom emoji images
 *
 * Code blocks are extracted first so their contents skip IRC formatting, linkification,
 * and mention highlighting. This prevents code examples from being mangled.
 *
 * **This is the only safe entry point** for rendering user-generated message text
 * to HTML. Do not call `linkify()` or `highlightMentions()` directly on unescaped
 * text — doing so creates an XSS vulnerability.
 */
export function renderMessage(text: string, myAccount: string): string {
	// Extract code blocks first — they must not go through IRC/linkify processing.
	// Use a random nonce in placeholders to prevent collision with user input.
	const FENCE = /```(\w*)\n([\s\S]*?)```/g;
	const blocks: { placeholder: string; html: string }[] = [];
	let blockIndex = 0;
	const nonce = Math.random().toString(36).slice(2, 10);
	const processed = text.replace(FENCE, (_match, lang: string, code: string) => {
		const placeholder = `\x00CB_${nonce}_${blockIndex++}\x00`;
		let html: string;
		if (lang) {
			const highlighted = highlightCode(code, lang);
			html = `<pre class="code-block"><code class="language-${escapeHTML(lang)}">${highlighted}</code></pre>`;
		} else {
			html = `<pre class="code-block"><code>${escapeHTML(code)}</code></pre>`;
		}
		blocks.push({ placeholder, html });
		return placeholder;
	});

	// Run normal pipeline on the non-code-block text
	let html = renderIRC(processed);
	html = linkify(html);
	html = highlightMentions(html, myAccount);
	html = renderCustomEmoji(html);

	// Restore code blocks
	for (const block of blocks) {
		html = html.replace(block.placeholder, block.html);
	}

	return html;
}
