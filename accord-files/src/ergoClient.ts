import { env } from "./env.js";
import { ERGO_TIMEOUT_MS } from "./constants.js";

/**
 * POST to an Ergo HTTP API endpoint with JSON body, Bearer auth, and timeout.
 *
 * Returns the raw Response on success. Throws on network/timeout errors
 * so callers can map failures to their own HTTP status codes.
 */
export async function ergoPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${env.ERGO_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ERGO_API_TOKEN}`,
    },
    signal: AbortSignal.timeout(ERGO_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
}

/**
 * POST to Ergo and parse the JSON response body.
 *
 * Returns `{ res, data }` where `res` is the raw Response (for status checks)
 * and `data` is the parsed JSON. Throws on network errors or invalid JSON.
 */
export async function ergoPostJson<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; data: T }> {
  const res = await ergoPost(path, body);
  const data = (await res.json()) as T;
  return { res, data };
}
