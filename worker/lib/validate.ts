import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors";

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw ApiError.validation(undefined, "Request body must be JSON");
  }
  const result = schema.safeParse(json);
  if (!result.success) throw ApiError.validation(result.error.issues);
  return result.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw ApiError.validation(result.error.issues);
  return result.data;
}
