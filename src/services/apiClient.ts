import { getApiConfig } from "../config";

/**
 * A failed call to the backend. `status` is the HTTP status the backend answered with, or 0 when
 * it never answered at all (unreachable, DNS failure, timeout).
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

const INVALID_TENANT_KEY = "INVALID_TENANT_KEY";

let invalidKeyHandler: (() => void) | undefined;

/**
 * Registers what to do when the backend says the tenant key is not valid (404 + INVALID_TENANT_KEY).
 * The app can't work with such a key, so main.ts uses this to shut down. Being offline is a
 * different case (status 0) and never triggers it.
 */
export function onInvalidTenantKey(handler: () => void): void {
  invalidKeyHandler = handler;
}

const REQUEST_TIMEOUT_MS = 15_000;

function describeNetworkFailure(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") return `no answer within ${REQUEST_TIMEOUT_MS / 1000}s`;
  if (err instanceof Error) {
    const code = (err.cause as { code?: string } | undefined)?.code;
    return code ?? err.message;
  }
  return String(err);
}

/**
 * The one place that talks to the backend: adds the tenant key as the Authorization header, sends
 * and reads JSON, and turns every failure into an ApiError carrying the backend's own message
 * (its `{ error }` body). Resolves to undefined for a 204.
 */
export async function apiRequest<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const { apiUrl, tenantKey } = getApiConfig();

  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tenantKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(`Cannot reach the backend at ${apiUrl} (${describeNetworkFailure(err)}).`, 0);
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code: string | undefined = payload?.code;
    if (code === INVALID_TENANT_KEY) invalidKeyHandler?.();
    throw new ApiError(payload?.error ?? res.statusText, res.status, code);
  }
  return payload as T;
}
