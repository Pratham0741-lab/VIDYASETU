/**
 * The one HTTP client for the VIDYASETU API.
 *
 * - Base URL from VITE_API_BASE_URL.
 * - Access token in memory only; refresh token in sessionStorage only
 *   (prototype trade-off so a page refresh keeps the session). Tokens are
 *   never put in a URL, never in localStorage and never logged.
 * - A 401 on an authenticated call triggers one refresh (shared by concurrent
 *   callers) and exactly one retry. If the refresh fails the session is
 *   cleared and the "session expired" listeners run.
 * - Every non-2xx response becomes an ApiError carrying the backend's
 *   {code, message, details, requestId}. Bodies are never logged.
 */

export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'
).replace(/\/+$/, '');

const REFRESH_KEY = 'vidyasetu.refresh';

export type ErrorDetails = Record<string, unknown> | unknown[] | null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, details: ErrorDetails, requestId: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** details.reason, when the backend sent one. */
  get reason(): string | null {
    const d = this.details;
    return d && !Array.isArray(d) && typeof d.reason === 'string' ? d.reason : null;
  }

  /** details.message_key, when the backend sent one. */
  get messageKey(): string | null {
    const d = this.details;
    return d && !Array.isArray(d) && typeof d.message_key === 'string' ? d.message_key : null;
  }
}

// ------------------------------------------------------------------ tokens
let accessToken: string | null = null;

export function getRefreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts until reload.
  }
}

export function hasRefreshToken(): boolean {
  return getRefreshToken() !== null;
}

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (refresh !== undefined) writeRefreshToken(refresh);
}

export function clearTokens() {
  accessToken = null;
  writeRefreshToken(null);
}

// ------------------------------------------------------- session expired
type Listener = () => void;
const expiredListeners = new Set<Listener>();

/** Runs when a refresh fails: the session is gone and the user must log in. */
export function onSessionExpired(listener: Listener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

function sessionExpired() {
  clearTokens();
  expiredListeners.forEach((l) => l());
}

// ------------------------------------------------------------------ fetch
async function toApiError(res: Response): Promise<ApiError> {
  const headerId = res.headers.get('X-Request-ID');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (body && typeof body === 'object' && 'code' in body && 'message' in body) {
    const b = body as { code: unknown; message: unknown; details?: unknown; requestId?: unknown };
    return new ApiError(
      res.status,
      String(b.code),
      String(b.message),
      (b.details ?? null) as ErrorDetails,
      typeof b.requestId === 'string' ? b.requestId : headerId,
    );
  }
  return new ApiError(res.status, 'HTTP_ERROR', `HTTP ${res.status}`, null, headerId);
}

function networkError(): ApiError {
  return new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.', null, null);
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time; concurrent 401s wait for the same attempt. */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refresh = getRefreshToken();
      if (!refresh) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { access_token: string };
        accessToken = data.access_token;
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export interface RequestOptions {
  body?: unknown;
  /** Multipart body (uploads). Content-Type is set by the browser. */
  form?: FormData;
  /** Send the bearer token (default true). */
  auth?: boolean;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

async function send(method: string, path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let url = `${API_BASE_URL}${path}`;
  if (opts.query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) q.set(k, v);
    const s = q.toString();
    if (s) url += `?${s}`;
  }
  try {
    return await fetch(url, { method, headers, body, signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw networkError();
  }
}

/** Sends a request; on 401 refreshes once and retries once. */
async function sendWithRefresh(method: string, path: string, opts: RequestOptions): Promise<Response> {
  let res = await send(method, path, opts);
  if (res.status === 401 && opts.auth !== false && hasRefreshToken()) {
    if (await refreshAccessToken()) {
      res = await send(method, path, opts);
      if (res.status === 401) sessionExpired();
    } else {
      sessionExpired();
    }
  }
  return res;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await sendWithRefresh(method, path, opts);
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Binary GET (e.g. a document file) as a Blob, with the same bearer and
 * refresh handling. The Blob type is the response Content-Type. Callers
 * must never log the Blob or an object URL made from it.
 */
export async function requestBlob(path: string, opts: RequestOptions = {}): Promise<Blob> {
  const res = await sendWithRefresh('GET', path, opts);
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
};
