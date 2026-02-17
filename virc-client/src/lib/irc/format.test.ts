import { describe, it, expect, afterEach } from 'vitest';
import { renderIRC, markdownToIRC, linkify, highlightMentions, nickColor, renderCustomEmoji, renderMessage, renderCodeBlocks } from './format';
import { setCustomEmoji, clearCustomEmoji } from '$lib/emoji';

describe('renderIRC', () => {
	it('renders bold', () => {
		expect(renderIRC('\x02hello\x02')).toBe('<strong>hello</strong>');
	});

	it('renders italic', () => {
		expect(renderIRC('\x1Dhello\x1D')).toBe('<em>hello</em>');
	});

	it('renders underline', () => {
		expect(renderIRC('\x1Fhello\x1F')).toBe('<u>hello</u>');
	});

	it('renders strikethrough', () => {
		expect(renderIRC('\x1Ehello\x1E')).toBe('<s>hello</s>');
	});

	it('renders monospace', () => {
		expect(renderIRC('\x11hello\x11')).toBe('<code>hello</code>');
	});

	it('renders foreground color', () => {
		const result = renderIRC('\x034hello\x03');
		expect(result).toContain('style="color:');
		expect(result).toContain('hello');
		expect(result).toContain('</span>');
	});

	it('renders two-digit foreground color', () => {
		const result = renderIRC('\x0312hello\x03');
		expect(result).toContain('style="color:');
		expect(result).toContain('hello');
	});

	it('renders foreground and background color', () => {
		const result = renderIRC('\x034,2hello\x03');
		expect(result).toContain('color:');
		expect(result).toContain('background-color:');
		expect(result).toContain('hello');
	});

	it('resets all formatting with \\x0F', () => {
		const result = renderIRC('\x02bold\x0F plain');
		expect(result).toBe('<strong>bold</strong> plain');
	});

	it('handles nested formatting', () => {
		const result = renderIRC('\x02bold \x1Dand italic\x1D\x02');
		expect(result).toContain('<strong>');
		expect(result).toContain('<em>');
		expect(result).toContain('and italic');
	});

	it('returns plain text unchanged', () => {
		expect(renderIRC('hello world')).toBe('hello world');
	});

	it('escapes HTML entities in text', () => {
		expect(renderIRC('<script>alert("xss")</script>')).toBe(
			'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
		);
	});

	it('handles unclosed formatting at end of string', () => {
		const result = renderIRC('\x02bold text');
		expect(result).toBe('<strong>bold text</strong>');
	});
});

describe('markdownToIRC', () => {
	it('converts bold', () => {
		expect(markdownToIRC('**hello**')).toBe('\x02hello\x02');
	});

	it('converts italic', () => {
		expect(markdownToIRC('*hello*')).toBe('\x1Dhello\x1D');
	});

	it('converts strikethrough', () => {
		expect(markdownToIRC('~~hello~~')).toBe('\x1Ehello\x1E');
	});

	it('converts inline code', () => {
		expect(markdownToIRC('`hello`')).toBe('\x11hello\x11');
	});

	it('handles mixed formatting', () => {
		expect(markdownToIRC('**bold** and *italic*')).toBe(
			'\x02bold\x02 and \x1Ditalic\x1D'
		);
	});

	it('returns plain text unchanged', () => {
		expect(markdownToIRC('hello world')).toBe('hello world');
	});

	it('does not convert bold inside italic markers', () => {
		// **bold** should be processed before *italic*
		const result = markdownToIRC('**bold**');
		expect(result).toBe('\x02bold\x02');
	});
});

describe('linkify', () => {
	it('wraps http URLs in anchor tags', () => {
		const result = linkify('visit http://example.com today');
		expect(result).toContain('<a href="http://example.com"');
		expect(result).toContain('target="_blank"');
		expect(result).toContain('rel="noopener noreferrer"');
		expect(result).toContain('>http://example.com</a>');
	});

	it('wraps https URLs in anchor tags', () => {
		const result = linkify('visit https://example.com today');
		expect(result).toContain('<a href="https://example.com"');
	});

	it('handles URLs with paths and query strings (pre-escaped input)', () => {
		// linkify receives HTML-escaped input from renderIRC()
		const result = linkify('see https://example.com/path?q=1&amp;r=2');
		// href should have properly escaped & for the attribute
		expect(result).toContain('href="https://example.com/path?q=1&amp;r=2"');
		// Display text preserves the pre-escaped form (no double-escaping)
		expect(result).toContain('>https://example.com/path?q=1&amp;r=2</a>');
		expect(result).not.toContain('&amp;amp;');
	});

	it('does not linkify plain text', () => {
		expect(linkify('hello world')).toBe('hello world');
	});

	it('handles multiple URLs', () => {
		const result = linkify('http://a.com and http://b.com');
		expect(result).toContain('href="http://a.com"');
		expect(result).toContain('href="http://b.com"');
	});

	it('does not double-wrap URLs already in anchor tags', () => {
		const input = '<a href="http://example.com">http://example.com</a>';
		const result = linkify(input);
		expect(result).not.toContain('<a href="<a');
	});
});

describe('highlightMentions', () => {
	it('highlights @mention of own account', () => {
		const result = highlightMentions('hello @alice how are you', 'alice');
		expect(result).toContain('class="mention mention-self"');
		expect(result).toContain('@alice');
	});

	it('highlights @mention of other users', () => {
		const result = highlightMentions('hello @bob', 'alice');
		expect(result).toContain('class="mention"');
		expect(result).toContain('@bob');
	});

	it('highlights #channel references', () => {
		const result = highlightMentions('join #general', 'alice');
		expect(result).toContain('class="channel-ref"');
		expect(result).toContain('#general');
	});

	it('returns plain text unchanged', () => {
		expect(highlightMentions('hello world', 'alice')).toBe('hello world');
	});

	it('is case-insensitive for self-mention', () => {
		const result = highlightMentions('hello @Alice', 'alice');
		expect(result).toContain('class="mention mention-self"');
	});
});

describe('nickColor', () => {
	it('returns an hsl string with 65% lightness by default (dark theme)', () => {
		const color = nickColor('alice');
		expect(color).toMatch(/^hsl\(\d+, 65%, 65%\)$/);
	});

	it('returns 65% lightness for dark theme', () => {
		const color = nickColor('alice', 'dark');
		expect(color).toMatch(/^hsl\(\d+, 65%, 65%\)$/);
	});

	it('returns 40% lightness for light theme', () => {
		const color = nickColor('alice', 'light');
		expect(color).toMatch(/^hsl\(\d+, 65%, 40%\)$/);
	});

	it('returns 65% lightness for amoled theme', () => {
		const color = nickColor('alice', 'amoled');
		expect(color).toMatch(/^hsl\(\d+, 65%, 65%\)$/);
	});

	it('returns 65% lightness for compact theme', () => {
		const color = nickColor('alice', 'compact');
		expect(color).toMatch(/^hsl\(\d+, 65%, 65%\)$/);
	});

	it('returns consistent color for same account', () => {
		expect(nickColor('alice')).toBe(nickColor('alice'));
	});

	it('returns different colors for different accounts', () => {
		// While not guaranteed, these common nicks should differ
		expect(nickColor('alice')).not.toBe(nickColor('bob'));
	});

	it('returns same hue but different lightness across themes', () => {
		const dark = nickColor('alice', 'dark');
		const light = nickColor('alice', 'light');
		// Same hue, same saturation, different lightness
		const darkHue = dark.match(/^hsl\((\d+)/)?.[1];
		const lightHue = light.match(/^hsl\((\d+)/)?.[1];
		expect(darkHue).toBe(lightHue);
		expect(dark).not.toBe(light);
	});
});

describe('renderCustomEmoji', () => {
	afterEach(() => {
		clearCustomEmoji();
	});

	it('returns text unchanged when no custom emoji are set', () => {
		expect(renderCustomEmoji('hello :catjam: world')).toBe('hello :catjam: world');
	});

	it('replaces known custom emoji with img tag', () => {
		setCustomEmoji({ catjam: 'https://example.com/catjam.gif' });
		const result = renderCustomEmoji('hello :catjam: world');
		expect(result).toContain('<img');
		expect(result).toContain('class="custom-emoji"');
		expect(result).toContain('src="https://example.com/catjam.gif"');
		expect(result).toContain('alt=":catjam:"');
		expect(result).toContain('title=":catjam:"');
	});

	it('leaves unknown :name: patterns as plain text', () => {
		setCustomEmoji({ catjam: 'https://example.com/catjam.gif' });
		const result = renderCustomEmoji('hello :unknown: world');
		expect(result).toBe('hello :unknown: world');
	});

	it('handles multiple custom emoji in one message', () => {
		setCustomEmoji({
			catjam: 'https://example.com/catjam.gif',
			pepethink: 'https://example.com/pepethink.png',
		});
		const result = renderCustomEmoji(':catjam: then :pepethink:');
		expect(result).toContain('catjam.gif');
		expect(result).toContain('pepethink.png');
	});

	it('handles emoji names with hyphens and underscores', () => {
		setCustomEmoji({ 'pepe-think_v2': 'https://example.com/pepe.png' });
		const result = renderCustomEmoji(':pepe-think_v2:');
		expect(result).toContain('pepe.png');
	});

	it('escapes HTML in emoji URLs', () => {
		setCustomEmoji({ xss: 'https://example.com/x"onload="alert(1)' });
		const result = renderCustomEmoji(':xss:');
		expect(result).toContain('&quot;');
		expect(result).not.toContain('"onload=');
	});
});

describe('renderMessage with custom emoji', () => {
	afterEach(() => {
		clearCustomEmoji();
	});

	it('renders custom emoji in full pipeline', () => {
		setCustomEmoji({ catjam: 'https://example.com/catjam.gif' });
		const result = renderMessage('check this :catjam:', 'alice');
		expect(result).toContain('<img');
		expect(result).toContain('catjam.gif');
	});

	it('leaves unknown emoji as text in full pipeline', () => {
		setCustomEmoji({ catjam: 'https://example.com/catjam.gif' });
		const result = renderMessage('hello :unknown:', 'alice');
		expect(result).toContain(':unknown:');
		expect(result).not.toContain('<img');
	});
});

describe('markdownToIRC spoiler', () => {
	it('converts ||text|| to spoiler wire format', () => {
		expect(markdownToIRC('||secret||')).toBe(
			'\x11[spoiler]\x11secret\x11[/spoiler]\x11'
		);
	});

	it('converts spoiler mixed with other formatting', () => {
		expect(markdownToIRC('**bold** and ||secret||')).toBe(
			'\x02bold\x02 and \x11[spoiler]\x11secret\x11[/spoiler]\x11'
		);
	});

	it('does not convert single pipes', () => {
		expect(markdownToIRC('|not spoiler|')).toBe('|not spoiler|');
	});

	it('handles multiple spoilers in one message', () => {
		const result = markdownToIRC('||one|| and ||two||');
		expect(result).toBe(
			'\x11[spoiler]\x11one\x11[/spoiler]\x11 and \x11[spoiler]\x11two\x11[/spoiler]\x11'
		);
	});
});

describe('renderIRC spoiler', () => {
	it('renders spoiler wire format as span with spoiler class', () => {
		const wire = '\x11[spoiler]\x11secret\x11[/spoiler]\x11';
		expect(renderIRC(wire)).toBe('<span class="spoiler">secret</span>');
	});

	it('renders spoiler alongside other formatting', () => {
		const wire = '\x02bold\x02 \x11[spoiler]\x11secret\x11[/spoiler]\x11';
		const result = renderIRC(wire);
		expect(result).toContain('<strong>bold</strong>');
		expect(result).toContain('<span class="spoiler">secret</span>');
	});

	it('escapes HTML inside spoiler content', () => {
		const wire = '\x11[spoiler]\x11<script>alert(1)</script>\x11[/spoiler]\x11';
		const result = renderIRC(wire);
		expect(result).toContain('&lt;script&gt;');
		expect(result).not.toContain('<script>');
		expect(result).toContain('class="spoiler"');
	});

	it('still renders regular monospace when not spoiler pattern', () => {
		expect(renderIRC('\x11code\x11')).toBe('<code>code</code>');
	});
});

describe('renderMessage spoiler end-to-end', () => {
	it('renders spoiler from markdown input through full pipeline', () => {
		const input = '||secret stuff||';
		const wire = markdownToIRC(input);
		const html = renderMessage(wire, 'alice');
		expect(html).toContain('class="spoiler"');
		expect(html).toContain('secret stuff');
	});
});

describe('renderMessage XSS safety', () => {
	it('neutralizes script tags', () => {
		const result = renderMessage('<script>alert(1)</script>', 'me');
		expect(result).not.toContain('<script>');
		expect(result).toContain('&lt;script&gt;');
	});

	it('neutralizes img onerror payloads', () => {
		const result = renderMessage('<img onerror=alert(1) src=x>', 'me');
		expect(result).not.toContain('<img');
		expect(result).toContain('&lt;img');
	});

	it('does not create javascript: links', () => {
		const result = renderMessage('javascript:alert(1)', 'me');
		expect(result).not.toContain('href="javascript:');
	});

	it('neutralizes nested HTML in bold formatting', () => {
		const result = renderMessage('\x02<b onmouseover=alert(1)>test</b>\x02', 'me');
		// The < and > are escaped, so the browser won't parse this as a real element
		expect(result).toContain('&lt;b');
		expect(result).toContain('&gt;');
		expect(result).not.toMatch(/<b\s/); // No actual <b> HTML tag
	});

	it('neutralizes event handler attributes', () => {
		const result = renderMessage('<div onclick="alert(1)">click</div>', 'me');
		// The < and > are escaped, so the browser won't parse this as a real element
		expect(result).toContain('&lt;div');
		expect(result).not.toMatch(/<div\s/); // No actual <div> HTML tag
	});

	it('escapes HTML entities in URLs used as display text', () => {
		// renderIRC escapes &, then linkify should not double-escape
		const result = renderMessage('visit https://example.com/test&param=1', 'me');
		expect(result).toContain('href="https://example.com/test&amp;param=1"');
		// Display text has single-escaped &amp; (not double &amp;amp;)
		expect(result).toContain('>https://example.com/test&amp;param=1</a>');
		expect(result).not.toContain('&amp;amp;');
	});
});

describe('renderCodeBlocks', () => {
	it('renders fenced code block with language hint as highlighted pre/code', () => {
		const input = '```js\nconst x = 1;\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('<pre class="code-block">');
		expect(result).toContain('<code class="language-js">');
		expect(result).toContain('</code></pre>');
		// Should have some highlighted tokens for JS keyword
		expect(result).toContain('<span class="hljs-keyword">');
	});

	it('renders fenced code block without language hint as plain monospace', () => {
		const input = '```\nplain text here\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('<pre class="code-block">');
		expect(result).toContain('<code>');
		expect(result).not.toContain('class="language-');
		expect(result).toContain('plain text here');
	});

	it('preserves text outside code blocks', () => {
		const input = 'before\n```\ncode\n```\nafter';
		const result = renderCodeBlocks(input);
		expect(result).toContain('before');
		expect(result).toContain('after');
		expect(result).toContain('<pre class="code-block">');
	});

	it('handles multiple code blocks', () => {
		const input = '```js\nconst a = 1;\n```\ntext\n```py\nx = 1\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('language-js');
		expect(result).toContain('language-py');
	});

	it('escapes HTML inside code blocks', () => {
		const input = '```\n<script>alert(1)</script>\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('&lt;script&gt;');
		expect(result).not.toContain('<script>alert');
	});

	it('highlights JavaScript keywords', () => {
		const input = '```js\nconst x = true;\nfunction foo() { return null; }\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('<span class="hljs-keyword">const</span>');
		expect(result).toContain('<span class="hljs-keyword">function</span>');
		expect(result).toContain('<span class="hljs-literal">true</span>');
		expect(result).toContain('<span class="hljs-literal">null</span>');
	});

	it('highlights strings in code blocks', () => {
		const input = '```js\nconst s = "hello";\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('<span class="hljs-string">');
	});

	it('highlights comments in code blocks', () => {
		const input = '```js\n// a comment\nconst x = 1; /* block */\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('<span class="hljs-comment">');
	});

	it('highlights Python keywords', () => {
		const input = '```python\ndef foo():\n    return True\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('<span class="hljs-keyword">def</span>');
		expect(result).toContain('<span class="hljs-literal">True</span>');
	});

	it('returns input unchanged when no code blocks present', () => {
		const input = 'just regular text';
		expect(renderCodeBlocks(input)).toBe('just regular text');
	});

	it('handles typescript alias', () => {
		const input = '```ts\nconst x: number = 1;\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('language-ts');
		expect(result).toContain('<span class="hljs-keyword">const</span>');
	});

	it('handles shell/bash highlighting', () => {
		const input = '```bash\necho "hello" | grep hello\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('language-bash');
		expect(result).toContain('<span class="hljs-string">');
	});

	it('handles JSON highlighting', () => {
		const input = '```json\n{"key": "value", "num": 42, "bool": true}\n```';
		const result = renderCodeBlocks(input);
		expect(result).toContain('language-json');
		expect(result).toContain('<span class="hljs-string">');
		expect(result).toContain('<span class="hljs-number">');
		expect(result).toContain('<span class="hljs-literal">true</span>');
	});
});

describe('renderMessage with code blocks', () => {
	it('processes code blocks in full rendering pipeline', () => {
		const input = 'check this:\n```js\nconst x = 1;\n```';
		const result = renderMessage(input, 'alice');
		expect(result).toContain('<pre class="code-block">');
		expect(result).toContain('<span class="hljs-keyword">const</span>');
	});

	it('code blocks without language render as plain monospace', () => {
		const input = '```\nsome plain code\n```';
		const result = renderMessage(input, 'alice');
		expect(result).toContain('<pre class="code-block">');
		expect(result).toContain('<code>');
		expect(result).not.toContain('class="language-');
	});
});
