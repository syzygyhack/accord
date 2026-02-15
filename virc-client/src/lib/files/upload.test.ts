import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadFile, type UploadResult } from './upload';

describe('uploadFile', () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn();
		vi.stubGlobal('fetch', mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends multipart/form-data POST to /api/upload with auth header', async () => {
		const successResponse: UploadResult = {
			url: '/api/files/abc-123.png',
			filename: 'cat.png',
			size: 2400000,
			mimetype: 'image/png',
		};

		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(successResponse),
		});

		const file = new File(['fake-image-data'], 'cat.png', { type: 'image/png' });
		const result = await uploadFile(file, 'jwt-token-123', 'https://files.example.com');

		expect(result).toEqual(successResponse);

		// Verify fetch was called correctly
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://files.example.com/api/upload');
		expect(options.method).toBe('POST');
		expect(options.headers['Authorization']).toBe('Bearer jwt-token-123');
		// Body should be FormData
		expect(options.body).toBeInstanceOf(FormData);
		expect(options.body.get('file')).toBeInstanceOf(File);
		expect((options.body.get('file') as File).name).toBe('cat.png');
	});

	it('throws on non-OK response with server error message', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 413,
			json: () => Promise.resolve({ error: 'File too large' }),
		});

		const file = new File(['x'.repeat(100)], 'big.zip', { type: 'application/zip' });

		await expect(
			uploadFile(file, 'jwt-token', 'https://files.example.com'),
		).rejects.toThrow('File too large');
	});

	it('throws generic error when server returns non-JSON error', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			json: () => Promise.reject(new Error('not json')),
		});

		const file = new File(['data'], 'test.txt', { type: 'text/plain' });

		await expect(
			uploadFile(file, 'jwt-token', 'https://files.example.com'),
		).rejects.toThrow('Upload failed (500)');
	});

	it('throws on network error', async () => {
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		const file = new File(['data'], 'test.txt', { type: 'text/plain' });

		await expect(
			uploadFile(file, 'jwt-token', 'https://files.example.com'),
		).rejects.toThrow('Failed to fetch');
	});

	it('formats the full URL correctly with trailing slash on filesUrl', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				url: '/api/files/abc.png',
				filename: 'test.png',
				size: 100,
				mimetype: 'image/png',
			}),
		});

		const file = new File(['data'], 'test.png', { type: 'image/png' });
		await uploadFile(file, 'token', 'https://files.example.com/');

		const [url] = mockFetch.mock.calls[0];
		// Should not double up the slash
		expect(url).toBe('https://files.example.com/api/upload');
	});
});
