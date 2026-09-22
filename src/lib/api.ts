import type { ApiErrorBody } from "@shared/types";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Minimal fetch wrapper for the JSON API. Cookies carry the session, so no
 * tokens are ever handled here.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json });
export const apiPatch = <T>(path: string, json?: unknown) => api<T>(path, { method: "PATCH", json });
export const apiPut = <T>(path: string, json?: unknown) => api<T>(path, { method: "PUT", json });
export const apiDelete = <T = void>(path: string) => api<T>(path, { method: "DELETE" });

export function isApiError(err: unknown, code?: string): err is ApiClientError {
  return err instanceof ApiClientError && (code === undefined || err.code === code);
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
