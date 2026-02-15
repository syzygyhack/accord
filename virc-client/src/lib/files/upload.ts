/**
 * File upload utility for virc-client.
 *
 * Sends files to the virc-files server via POST /api/upload
 * with multipart/form-data encoding.
 */

export interface UploadResult {
	url: string;
	filename: string;
	size: number;
	mimetype: string;
}

/**
 * Upload a file to the virc-files server.
 *
 * @param file     - The File object to upload
 * @param token    - JWT auth token
 * @param filesUrl - Base URL of the virc-files server (e.g. "https://files.example.com")
 * @returns The upload result with URL, filename, size, and mimetype
 * @throws {Error} on network failure or non-OK server response
 */
export async function uploadFile(
	file: File,
	token: string,
	filesUrl: string,
): Promise<UploadResult> {
	const baseUrl = filesUrl.replace(/\/+$/, '');

	const form = new FormData();
	form.append('file', file);

	const res = await fetch(`${baseUrl}/api/upload`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
		},
		body: form,
	});

	if (!res.ok) {
		let message: string;
		try {
			const body = await res.json() as { error?: string };
			message = body.error ?? `Upload failed (${res.status})`;
		} catch {
			message = `Upload failed (${res.status})`;
		}
		throw new Error(message);
	}

	return (await res.json()) as UploadResult;
}
