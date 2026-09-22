import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@shared/types";

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "rate_limited"
  | "turnstile_required"
  | "turnstile_failed"
  | "payload_too_large"
  | "not_configured"
  | "upstream_error"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static unauthenticated(message = "You need to sign in") {
    return new ApiError(401, "unauthenticated", message);
  }
  static forbidden(message = "You do not have permission to do that") {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(what = "Resource") {
    return new ApiError(404, "not_found", `${what} not found`);
  }
  static validation(details: unknown, message = "Invalid request") {
    return new ApiError(400, "validation_failed", message, details);
  }
  static conflict(message: string) {
    return new ApiError(409, "conflict", message);
  }
  static rateLimited(retryAfterSeconds: number) {
    return new ApiError(429, "rate_limited", "Too many requests, slow down", { retryAfterSeconds });
  }
  static notConfigured(what: string) {
    return new ApiError(503, "not_configured", `${what} is not configured on this deployment`);
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ApiError) {
    const res = c.json(err.toBody(), err.status as 400);
    if (err.code === "rate_limited") {
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 5;
      res.headers.set("Retry-After", String(retry));
    }
    return res;
  }
  if (err instanceof ZodError) {
    return c.json(ApiError.validation(err.issues).toBody(), 400);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: err.message } }, err.status);
  }
  console.error("Unhandled error", err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
}
