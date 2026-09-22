import { useCallback, useEffect, useState } from "react";

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or privacy mode */
    }
  }, [key, value]);
  const set = useCallback((v: T | ((prev: T) => T)) => setValue((prev) => (typeof v === "function" ? (v as (p: T) => T)(prev) : v)), []);
  return [value, set];
}
