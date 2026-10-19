import type {
  AttemptResponseData,
  DeckWithProgressData,
  FamiliarityResponseData,
  SessionData,
  StatsData,
} from '../types/deck';

const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
const USER_KEY_STORAGE = 'memoquiz.userKey';
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getApiBase() {
  return API_BASE || window.location.origin;
}

export function readStoredUserKey(): string {
  try {
    return window.localStorage.getItem(USER_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveStoredUserKey(key: string) {
  try {
    window.localStorage.setItem(USER_KEY_STORAGE, key);
  } catch {
    // 隐私模式禁用 localStorage 时，仅本次会话有效。
  }
}

export function clearStoredUserKey() {
  try {
    window.localStorage.removeItem(USER_KEY_STORAGE);
  } catch {
    // 忽略。
  }
}

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined;
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return undefined;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  userKey?: string;
  adminKey?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, userKey, adminKey, signal } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (userKey) headers['X-User-Key'] = userKey;
  if (adminKey) headers['X-Admin-Key'] = adminKey;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? timeoutSignal(),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ApiError(0, 'TIMEOUT', '请求超时，请检查后端是否在运行');
    }
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接后端，请先运行 npm run dev:server');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `请求失败（HTTP ${response.status}）`,
      error?.details,
    );
  }

  return payload as T;
}

export async function createSession(label?: string): Promise<SessionData> {
  return request<SessionData>('/api/auth/session', {
    method: 'POST',
    body: label ? { label } : {},
  });
}

export async function resumeSession(userKey: string): Promise<SessionData> {
  return request<SessionData>('/api/auth/session', {
    method: 'POST',
    body: { userKey },
  });
}

export async function fetchMe(userKey: string): Promise<{ user: SessionData['user'] }> {
  return request('/api/auth/me', { userKey });
}

export async function fetchDecksWithItems(userKey: string): Promise<{ decks: DeckWithProgressData[] }> {
  return request('/api/decks?include=items', { userKey });
}

export async function fetchStats(userKey: string): Promise<StatsData> {
  return request('/api/stats', { userKey });
}

export async function putFamiliarity(
  userKey: string,
  deckId: string,
  itemId: string,
  familiarity: 'familiar' | 'normal' | 'unfamiliar' | null,
): Promise<FamiliarityResponseData> {
  return request(
    `/api/decks/${encodeURIComponent(deckId)}/items/${encodeURIComponent(itemId)}/familiarity`,
    { method: 'PUT', userKey, body: { familiarity } },
  );
}

export async function submitAttempt(
  userKey: string,
  deckId: string,
  itemId: string,
  answer: unknown,
): Promise<AttemptResponseData> {
  return request(
    `/api/decks/${encodeURIComponent(deckId)}/items/${encodeURIComponent(itemId)}/attempt`,
    { method: 'POST', userKey, body: { answer } },
  );
}

export async function putItemTags(
  userKey: string,
  deckId: string,
  itemId: string,
  tags: string[],
): Promise<{ tags: string[]; overridden: boolean }> {
  return request(
    `/api/decks/${encodeURIComponent(deckId)}/items/${encodeURIComponent(itemId)}/tags`,
    { method: 'PUT', userKey, body: { tags } },
  );
}

export async function deleteItemTags(
  userKey: string,
  deckId: string,
  itemId: string,
): Promise<{ tags: string[]; overridden: boolean }> {
  return request(
    `/api/decks/${encodeURIComponent(deckId)}/items/${encodeURIComponent(itemId)}/tags`,
    { method: 'DELETE', userKey },
  );
}

export async function fetchHealth(): Promise<{ ok: boolean; version: string; counts: Record<string, number> }> {
  return request('/api/health');
}