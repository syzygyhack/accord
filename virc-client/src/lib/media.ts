/**
 * Media URL detection for inline message previews.
 *
 * Extracts URLs pointing to images, videos, and audio files from message text.
 */

import { urlPattern } from '$lib/constants';

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaUrl {
	url: string;
	type: MediaType;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|ogg|flac)$/i;

/**
 * Determine media type from a URL based on file extension.
 *
 * Strips query strings and fragments before checking the extension.
 * Returns null if the URL doesn't point to a recognized media type.
 */
function getMediaType(url: string): MediaType | null {
	// Strip query string and hash for extension matching
	const path = url.replace(/[?#].*$/, '');

	if (IMAGE_EXTENSIONS.test(path)) return 'image';
	if (VIDEO_EXTENSIONS.test(path)) return 'video';
	if (AUDIO_EXTENSIONS.test(path)) return 'audio';
	return null;
}

/**
 * Extract media URLs from message text.
 *
 * Finds all http/https URLs that point to recognized media file types.
 * Returns an array of { url, type } objects.
 */
export function extractMediaUrls(text: string): MediaUrl[] {
	const re = urlPattern();
	const results: MediaUrl[] = [];
	let match: RegExpExecArray | null;

	while ((match = re.exec(text)) !== null) {
		const url = match[0];
		const type = getMediaType(url);
		if (type) {
			results.push({ url, type });
		}
	}

	return results;
}
