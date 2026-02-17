export interface EmojiEntry {
	emoji: string;
	name: string;
	keywords: string[];
}

export interface EmojiCategory {
	name: string;
	emoji: EmojiEntry[];
}

/** A custom server emoji: name → image URL. */
export interface CustomEmoji {
	name: string;
	url: string;
}

/**
 * Module-level store for custom emoji from the server's virc.json.
 * Set once during connection init; read by emoji picker and format pipeline.
 */
let _customEmojiMap: Map<string, string> = new Map();

/** Set the custom emoji map (called when virc.json is fetched). */
export function setCustomEmoji(emojiMap: Record<string, string>): void {
	_customEmojiMap = new Map(Object.entries(emojiMap));
}

/** Get the custom emoji map. */
export function getCustomEmojiMap(): Map<string, string> {
	return _customEmojiMap;
}

/** Get custom emoji as a list for display. */
export function getCustomEmojiList(): CustomEmoji[] {
	return Array.from(_customEmojiMap.entries()).map(([name, url]) => ({ name, url }));
}

/** Look up a custom emoji URL by name. Returns undefined if not found. */
export function getCustomEmojiUrl(name: string): string | undefined {
	return _customEmojiMap.get(name);
}

/** Clear the custom emoji map (e.g. on disconnect). */
export function clearCustomEmoji(): void {
	_customEmojiMap = new Map();
}

const smileys: EmojiEntry[] = [
	{ emoji: '😀', name: 'grinning face', keywords: ['happy', 'smile', 'joy'] },
	{ emoji: '😄', name: 'grinning face with smiling eyes', keywords: ['happy', 'laugh'] },
	{ emoji: '😅', name: 'grinning face with sweat', keywords: ['hot', 'relief'] },
	{ emoji: '🤣', name: 'rolling on the floor laughing', keywords: ['lol', 'rofl', 'funny'] },
	{ emoji: '😂', name: 'face with tears of joy', keywords: ['cry', 'laugh', 'funny'] },
	{ emoji: '🙂', name: 'slightly smiling face', keywords: ['smile'] },
	{ emoji: '🙃', name: 'upside-down face', keywords: ['sarcasm', 'silly'] },
	{ emoji: '😉', name: 'winking face', keywords: ['wink', 'flirt'] },
	{ emoji: '😊', name: 'smiling face with smiling eyes', keywords: ['blush', 'happy'] },
	{ emoji: '🥰', name: 'smiling face with hearts', keywords: ['love', 'adore'] },
	{ emoji: '😍', name: 'heart eyes', keywords: ['love', 'crush', 'adore'] },
	{ emoji: '🤩', name: 'star-struck', keywords: ['wow', 'amazing', 'star'] },
	{ emoji: '😘', name: 'face blowing a kiss', keywords: ['kiss', 'love'] },
	{ emoji: '🥲', name: 'smiling face with tear', keywords: ['sad', 'happy', 'grateful'] },
	{ emoji: '😋', name: 'face savoring food', keywords: ['yummy', 'delicious', 'tongue'] },
	{ emoji: '😜', name: 'winking face with tongue', keywords: ['tongue', 'silly', 'wink'] },
	{ emoji: '🤗', name: 'hugging face', keywords: ['hug', 'warm'] },
	{ emoji: '🤔', name: 'thinking face', keywords: ['think', 'hmm', 'consider'] },
	{ emoji: '🤫', name: 'shushing face', keywords: ['quiet', 'secret', 'shh'] },
	{ emoji: '🤨', name: 'face with raised eyebrow', keywords: ['suspicious', 'skeptical'] },
	{ emoji: '😐', name: 'neutral face', keywords: ['meh', 'blank'] },
	{ emoji: '😏', name: 'smirking face', keywords: ['smirk', 'suggestive'] },
	{ emoji: '😒', name: 'unamused face', keywords: ['bored', 'unimpressed'] },
	{ emoji: '🙄', name: 'face with rolling eyes', keywords: ['eyeroll', 'annoyed'] },
	{ emoji: '😬', name: 'grimacing face', keywords: ['awkward', 'nervous'] },
	{ emoji: '😴', name: 'sleeping face', keywords: ['sleep', 'zzz', 'tired'] },
	{ emoji: '🤮', name: 'face vomiting', keywords: ['sick', 'puke', 'gross'] },
	{ emoji: '🥵', name: 'hot face', keywords: ['hot', 'sweating', 'heat'] },
	{ emoji: '🥶', name: 'cold face', keywords: ['cold', 'freezing', 'ice'] },
	{ emoji: '🤯', name: 'exploding head', keywords: ['mind blown', 'shocked'] },
	{ emoji: '😎', name: 'smiling face with sunglasses', keywords: ['cool', 'sunglasses'] },
	{ emoji: '🤓', name: 'nerd face', keywords: ['nerd', 'geek', 'glasses'] },
	{ emoji: '😕', name: 'confused face', keywords: ['confused', 'puzzled'] },
	{ emoji: '😲', name: 'astonished face', keywords: ['shocked', 'amazed'] },
	{ emoji: '😳', name: 'flushed face', keywords: ['embarrassed', 'blush'] },
	{ emoji: '🥺', name: 'pleading face', keywords: ['puppy eyes', 'please', 'beg'] },
	{ emoji: '😢', name: 'crying face', keywords: ['cry', 'sad', 'tear'] },
	{ emoji: '😭', name: 'loudly crying face', keywords: ['cry', 'sob', 'sad'] },
	{ emoji: '😱', name: 'face screaming in fear', keywords: ['scream', 'horror'] },
	{ emoji: '😤', name: 'face with steam from nose', keywords: ['angry', 'triumph'] },
	{ emoji: '😡', name: 'pouting face', keywords: ['angry', 'mad', 'rage'] },
	{ emoji: '🤬', name: 'face with symbols on mouth', keywords: ['swear', 'cursing'] },
	{ emoji: '💀', name: 'skull', keywords: ['dead', 'death', 'skeleton'] },
	{ emoji: '💩', name: 'pile of poo', keywords: ['poop', 'shit'] },
	{ emoji: '🤡', name: 'clown face', keywords: ['clown', 'joker'] },
	{ emoji: '👻', name: 'ghost', keywords: ['ghost', 'halloween', 'boo'] },
	{ emoji: '👽', name: 'alien', keywords: ['alien', 'ufo', 'extraterrestrial'] },
	{ emoji: '🤖', name: 'robot', keywords: ['robot', 'bot', 'machine'] },
];

const people: EmojiEntry[] = [
	{ emoji: '👋', name: 'waving hand', keywords: ['wave', 'hello', 'bye', 'hi'] },
	{ emoji: '✋', name: 'raised hand', keywords: ['stop', 'high five'] },
	{ emoji: '👌', name: 'OK hand', keywords: ['ok', 'perfect', 'fine'] },
	{ emoji: '🤌', name: 'pinched fingers', keywords: ['italian', 'chef kiss'] },
	{ emoji: '✌️', name: 'victory hand', keywords: ['peace', 'v'] },
	{ emoji: '🤞', name: 'crossed fingers', keywords: ['luck', 'hope'] },
	{ emoji: '🤘', name: 'sign of the horns', keywords: ['rock', 'metal'] },
	{ emoji: '👈', name: 'backhand index pointing left', keywords: ['left', 'point'] },
	{ emoji: '👉', name: 'backhand index pointing right', keywords: ['right', 'point'] },
	{ emoji: '👆', name: 'backhand index pointing up', keywords: ['up', 'point'] },
	{ emoji: '👇', name: 'backhand index pointing down', keywords: ['down', 'point'] },
	{ emoji: '👍', name: 'thumbs up', keywords: ['like', 'approve', 'yes', 'good', '+1'] },
	{ emoji: '👎', name: 'thumbs down', keywords: ['dislike', 'disapprove', 'no', 'bad', '-1'] },
	{ emoji: '✊', name: 'raised fist', keywords: ['fist', 'power'] },
	{ emoji: '👊', name: 'oncoming fist', keywords: ['punch', 'fist bump'] },
	{ emoji: '👏', name: 'clapping hands', keywords: ['clap', 'applause', 'bravo'] },
	{ emoji: '🙌', name: 'raising hands', keywords: ['hooray', 'celebration', 'praise'] },
	{ emoji: '🤝', name: 'handshake', keywords: ['deal', 'agreement'] },
	{ emoji: '🙏', name: 'folded hands', keywords: ['pray', 'please', 'thank you', 'namaste'] },
	{ emoji: '💪', name: 'flexed biceps', keywords: ['strong', 'muscle', 'flex'] },
	{ emoji: '🖕', name: 'middle finger', keywords: ['flip off', 'rude'] },
];

const nature: EmojiEntry[] = [
	{ emoji: '🐶', name: 'dog face', keywords: ['dog', 'puppy', 'pet'] },
	{ emoji: '🐱', name: 'cat face', keywords: ['cat', 'kitten', 'pet'] },
	{ emoji: '🐰', name: 'rabbit face', keywords: ['rabbit', 'bunny'] },
	{ emoji: '🦊', name: 'fox', keywords: ['fox', 'clever'] },
	{ emoji: '🐻', name: 'bear', keywords: ['bear', 'teddy'] },
	{ emoji: '🐼', name: 'panda', keywords: ['panda', 'bear'] },
	{ emoji: '🐯', name: 'tiger face', keywords: ['tiger', 'cat'] },
	{ emoji: '🦁', name: 'lion', keywords: ['lion', 'king'] },
	{ emoji: '🐸', name: 'frog', keywords: ['frog', 'toad', 'pepe'] },
	{ emoji: '🙈', name: 'see-no-evil monkey', keywords: ['monkey', 'shy', 'hide'] },
	{ emoji: '🙉', name: 'hear-no-evil monkey', keywords: ['monkey', 'deaf'] },
	{ emoji: '🙊', name: 'speak-no-evil monkey', keywords: ['monkey', 'mute', 'secret'] },
	{ emoji: '🐧', name: 'penguin', keywords: ['penguin', 'linux'] },
	{ emoji: '🐦', name: 'bird', keywords: ['bird', 'tweet'] },
	{ emoji: '🐝', name: 'honeybee', keywords: ['bee', 'honey', 'buzz'] },
	{ emoji: '🐛', name: 'bug', keywords: ['bug', 'insect'] },
	{ emoji: '🦋', name: 'butterfly', keywords: ['butterfly', 'pretty'] },
	{ emoji: '🐍', name: 'snake', keywords: ['snake', 'python'] },
	{ emoji: '🐢', name: 'turtle', keywords: ['turtle', 'slow'] },
	{ emoji: '🐙', name: 'octopus', keywords: ['octopus', 'tentacle'] },
	{ emoji: '🐳', name: 'spouting whale', keywords: ['whale', 'docker'] },
	{ emoji: '🌸', name: 'cherry blossom', keywords: ['flower', 'spring', 'sakura'] },
	{ emoji: '🌹', name: 'rose', keywords: ['flower', 'romance', 'love'] },
	{ emoji: '🌲', name: 'evergreen tree', keywords: ['tree', 'pine', 'nature'] },
	{ emoji: '🌈', name: 'rainbow', keywords: ['rainbow', 'pride', 'colorful'] },
];

const food: EmojiEntry[] = [
	{ emoji: '🍎', name: 'red apple', keywords: ['apple', 'fruit'] },
	{ emoji: '🍌', name: 'banana', keywords: ['banana', 'fruit'] },
	{ emoji: '🍉', name: 'watermelon', keywords: ['watermelon', 'fruit', 'summer'] },
	{ emoji: '🍓', name: 'strawberry', keywords: ['strawberry', 'fruit', 'berry'] },
	{ emoji: '🍑', name: 'peach', keywords: ['peach', 'fruit'] },
	{ emoji: '🥑', name: 'avocado', keywords: ['avocado', 'guacamole'] },
	{ emoji: '🌮', name: 'taco', keywords: ['taco', 'mexican'] },
	{ emoji: '🍕', name: 'pizza', keywords: ['pizza', 'cheese'] },
	{ emoji: '🍔', name: 'hamburger', keywords: ['burger', 'fast food'] },
	{ emoji: '🍟', name: 'french fries', keywords: ['fries', 'chips', 'fast food'] },
	{ emoji: '🍿', name: 'popcorn', keywords: ['popcorn', 'movie', 'cinema'] },
	{ emoji: '🍩', name: 'doughnut', keywords: ['donut', 'dessert'] },
	{ emoji: '🍪', name: 'cookie', keywords: ['cookie', 'biscuit', 'dessert'] },
	{ emoji: '🎂', name: 'birthday cake', keywords: ['cake', 'birthday', 'party'] },
	{ emoji: '🍫', name: 'chocolate bar', keywords: ['chocolate', 'candy'] },
	{ emoji: '☕', name: 'hot beverage', keywords: ['coffee', 'tea', 'drink'] },
	{ emoji: '🍺', name: 'beer mug', keywords: ['beer', 'drink', 'alcohol'] },
	{ emoji: '🍻', name: 'clinking beer mugs', keywords: ['beer', 'cheers'] },
	{ emoji: '🥂', name: 'clinking glasses', keywords: ['champagne', 'cheers', 'toast'] },
	{ emoji: '🍷', name: 'wine glass', keywords: ['wine', 'drink', 'alcohol'] },
];

const activities: EmojiEntry[] = [
	{ emoji: '⚽', name: 'soccer ball', keywords: ['soccer', 'football', 'sport'] },
	{ emoji: '🏀', name: 'basketball', keywords: ['basketball', 'sport'] },
	{ emoji: '🏈', name: 'american football', keywords: ['football', 'nfl', 'sport'] },
	{ emoji: '🎾', name: 'tennis', keywords: ['tennis', 'sport'] },
	{ emoji: '🎮', name: 'video game', keywords: ['game', 'gaming', 'controller'] },
	{ emoji: '🎲', name: 'game die', keywords: ['dice', 'game', 'random'] },
	{ emoji: '🎯', name: 'bullseye', keywords: ['target', 'dart', 'goal'] },
	{ emoji: '🎸', name: 'guitar', keywords: ['guitar', 'music', 'rock'] },
	{ emoji: '🎵', name: 'musical note', keywords: ['music', 'note', 'song'] },
	{ emoji: '🎶', name: 'musical notes', keywords: ['music', 'song', 'melody'] },
	{ emoji: '🎤', name: 'microphone', keywords: ['mic', 'karaoke', 'sing'] },
	{ emoji: '🎬', name: 'clapper board', keywords: ['movie', 'film', 'action'] },
	{ emoji: '🎨', name: 'artist palette', keywords: ['art', 'paint', 'creative'] },
	{ emoji: '🎭', name: 'performing arts', keywords: ['theater', 'drama', 'mask'] },
	{ emoji: '🏆', name: 'trophy', keywords: ['trophy', 'win', 'champion'] },
	{ emoji: '🥇', name: 'gold medal', keywords: ['first', 'winner', 'gold'] },
];

const travel: EmojiEntry[] = [
	{ emoji: '🚗', name: 'automobile', keywords: ['car', 'drive', 'vehicle'] },
	{ emoji: '🚀', name: 'rocket', keywords: ['rocket', 'space', 'launch', 'ship'] },
	{ emoji: '✈️', name: 'airplane', keywords: ['plane', 'flight', 'travel'] },
	{ emoji: '🚂', name: 'locomotive', keywords: ['train', 'railway'] },
	{ emoji: '🚢', name: 'ship', keywords: ['ship', 'boat', 'cruise'] },
	{ emoji: '🚲', name: 'bicycle', keywords: ['bike', 'cycle'] },
	{ emoji: '🏠', name: 'house', keywords: ['house', 'home'] },
	{ emoji: '🏢', name: 'office building', keywords: ['office', 'building', 'work'] },
	{ emoji: '🌍', name: 'globe Europe-Africa', keywords: ['earth', 'world', 'globe'] },
	{ emoji: '🌙', name: 'crescent moon', keywords: ['moon', 'night', 'sleep'] },
	{ emoji: '⭐', name: 'star', keywords: ['star', 'favorite'] },
	{ emoji: '🌟', name: 'glowing star', keywords: ['star', 'sparkle', 'shine'] },
	{ emoji: '❄️', name: 'snowflake', keywords: ['snow', 'cold', 'winter'] },
	{ emoji: '🔥', name: 'fire', keywords: ['fire', 'hot', 'flame', 'lit'] },
	{ emoji: '💧', name: 'droplet', keywords: ['water', 'drop', 'rain'] },
	{ emoji: '🌊', name: 'water wave', keywords: ['wave', 'ocean', 'sea'] },
];

const objects: EmojiEntry[] = [
	{ emoji: '💻', name: 'laptop', keywords: ['computer', 'laptop', 'code', 'dev'] },
	{ emoji: '🖥️', name: 'desktop computer', keywords: ['computer', 'monitor', 'pc'] },
	{ emoji: '📱', name: 'mobile phone', keywords: ['phone', 'mobile', 'cell'] },
	{ emoji: '📧', name: 'e-mail', keywords: ['email', 'mail', 'message'] },
	{ emoji: '📷', name: 'camera', keywords: ['camera', 'photo', 'picture'] },
	{ emoji: '🔑', name: 'key', keywords: ['key', 'lock', 'password'] },
	{ emoji: '🔒', name: 'locked', keywords: ['lock', 'secure', 'private'] },
	{ emoji: '📝', name: 'memo', keywords: ['note', 'write', 'memo', 'document'] },
	{ emoji: '📚', name: 'books', keywords: ['book', 'read', 'library'] },
	{ emoji: '📎', name: 'paperclip', keywords: ['clip', 'attachment'] },
	{ emoji: '📁', name: 'file folder', keywords: ['folder', 'directory'] },
	{ emoji: '🗑️', name: 'wastebasket', keywords: ['trash', 'delete', 'bin'] },
	{ emoji: '🔧', name: 'wrench', keywords: ['tool', 'fix', 'settings'] },
	{ emoji: '⚙️', name: 'gear', keywords: ['settings', 'config', 'cog'] },
	{ emoji: '💡', name: 'light bulb', keywords: ['idea', 'light', 'bright'] },
	{ emoji: '🔔', name: 'bell', keywords: ['bell', 'notification', 'alert'] },
	{ emoji: '🎁', name: 'wrapped gift', keywords: ['gift', 'present', 'birthday'] },
	{ emoji: '💰', name: 'money bag', keywords: ['money', 'dollar', 'rich'] },
	{ emoji: '🛡️', name: 'shield', keywords: ['shield', 'protect', 'security'] },
];

const symbols: EmojiEntry[] = [
	{ emoji: '❤️', name: 'red heart', keywords: ['love', 'heart', 'like'] },
	{ emoji: '🧡', name: 'orange heart', keywords: ['love', 'heart'] },
	{ emoji: '💛', name: 'yellow heart', keywords: ['love', 'heart'] },
	{ emoji: '💚', name: 'green heart', keywords: ['love', 'heart'] },
	{ emoji: '💙', name: 'blue heart', keywords: ['love', 'heart'] },
	{ emoji: '💜', name: 'purple heart', keywords: ['love', 'heart'] },
	{ emoji: '🖤', name: 'black heart', keywords: ['love', 'heart', 'dark'] },
	{ emoji: '💔', name: 'broken heart', keywords: ['heartbreak', 'sad'] },
	{ emoji: '💯', name: 'hundred points', keywords: ['100', 'perfect', 'score'] },
	{ emoji: '💥', name: 'collision', keywords: ['boom', 'crash', 'explosion'] },
	{ emoji: '💬', name: 'speech balloon', keywords: ['chat', 'message', 'talk'] },
	{ emoji: '✅', name: 'check mark button', keywords: ['yes', 'done', 'complete'] },
	{ emoji: '❌', name: 'cross mark', keywords: ['no', 'wrong', 'delete'] },
	{ emoji: '❓', name: 'question mark', keywords: ['question', 'what', 'help'] },
	{ emoji: '❗', name: 'exclamation mark', keywords: ['important', 'alert', 'warning'] },
	{ emoji: '⚠️', name: 'warning', keywords: ['warning', 'caution', 'alert'] },
	{ emoji: '🚫', name: 'prohibited', keywords: ['no', 'forbidden', 'banned'] },
	{ emoji: '🔴', name: 'red circle', keywords: ['red', 'circle', 'dot'] },
	{ emoji: '🟢', name: 'green circle', keywords: ['green', 'circle', 'dot', 'online'] },
	{ emoji: '🚩', name: 'triangular flag', keywords: ['flag', 'red flag', 'warning'] },
	{ emoji: '🔗', name: 'link', keywords: ['link', 'url', 'chain'] },
	{ emoji: '📣', name: 'megaphone', keywords: ['announce', 'megaphone', 'loud'] },
	{ emoji: '🎉', name: 'party popper', keywords: ['party', 'celebrate', 'tada', 'congrats'] },
];

export const categories: EmojiCategory[] = [
	{ name: 'Smileys', emoji: smileys },
	{ name: 'People', emoji: people },
	{ name: 'Nature', emoji: nature },
	{ name: 'Food', emoji: food },
	{ name: 'Activities', emoji: activities },
	{ name: 'Travel', emoji: travel },
	{ name: 'Objects', emoji: objects },
	{ name: 'Symbols', emoji: symbols },
];

export const allEmoji: EmojiEntry[] = categories.flatMap((c) => c.emoji);

export function searchEmoji(query: string): EmojiEntry[] {
	if (!query.trim()) return allEmoji;
	const q = query.toLowerCase().trim();
	return allEmoji.filter(
		(e) =>
			e.name.toLowerCase().includes(q) ||
			e.keywords.some((k) => k.toLowerCase().includes(q))
	);
}

/** Search custom emoji by name substring. Returns matching custom emoji. */
export function searchCustomEmoji(query: string): CustomEmoji[] {
	const list = getCustomEmojiList();
	if (!query.trim()) return list;
	const q = query.toLowerCase().trim();
	return list.filter((e) => e.name.toLowerCase().includes(q));
}

const FREQUENT_KEY = 'accord:frequent-emoji';
const MAX_FREQUENT = 16;

export function getFrequentEmoji(): string[] {
	try {
		const stored = localStorage.getItem(FREQUENT_KEY);
		if (!stored) return [];
		return JSON.parse(stored) as string[];
	} catch {
		return [];
	}
}

export function recordEmojiUse(emoji: string): void {
	try {
		const frequent = getFrequentEmoji().filter((e) => e !== emoji);
		frequent.unshift(emoji);
		localStorage.setItem(FREQUENT_KEY, JSON.stringify(frequent.slice(0, MAX_FREQUENT)));
	} catch {
		// localStorage unavailable — ignore
	}
}
