import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";
const KEY = "chat.theme";

export function getTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === "light" || t === "system" ? t : "dark";
}

export function applyTheme(theme: Theme): void {
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const dark = theme === "dark" || (theme === "system" && !prefersLight);
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem(KEY, theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
  return [theme, setThemeState];
}
