/** Safe check for localStorage availability (missing in Node/SSR). */
export function hasLocalStorage(): boolean {
	return typeof localStorage !== 'undefined';
}
