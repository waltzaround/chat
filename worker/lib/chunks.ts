/**
 * D1 allows at most 100 bound parameters per statement, so a lookup by a list of ids
 * (`inArray`) breaks once the list is long. Run it in chunks and join the results.
 */
export async function chunked<T>(values: readonly string[], run: (chunk: string[]) => Promise<T[]>, size = 90): Promise<T[]> {
  const unique = [...new Set(values)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += size) out.push(...(await run(unique.slice(i, i + size))));
  return out;
}
