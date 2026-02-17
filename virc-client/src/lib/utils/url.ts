/** Normalize a base URL by stripping trailing slashes. */
export function normalizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, '');
}
