import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
    __turnstileReady?: Promise<void>;
  }
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__turnstileReady) {
    window.__turnstileReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Turnstile"));
      document.head.appendChild(s);
    });
  }
  return window.__turnstileReady;
}

/** Renders a Cloudflare Turnstile widget and reports the token via onToken. */
export function Turnstile({ siteKey, onToken, className }: { siteKey: string; onToken: (token: string | null) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadTurnstile()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        idRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          size: "flexible",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch((err) => console.warn(err));
    return () => {
      cancelled = true;
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current);
      idRef.current = null;
    };
  }, [siteKey, onToken]);
  return <div ref={ref} className={className} />;
}
