import { useStore } from "@/lib/store";
import type { PresenceStatus } from "@shared/types";
import { useRealtime, useRealtimeOptional, type PendingMessage } from "./RealtimeProvider";

const EMPTY: never[] = [];

export function useSocketStatus() {
  const rt = useRealtime();
  // Select primitives individually: useSyncExternalStore requires referentially stable snapshots.
  const status = useStore(rt.store, (s) => s.status);
  const attempt = useStore(rt.store, (s) => s.attempt);
  const fatal = useStore(rt.store, (s) => s.fatal);
  return { status, attempt, fatal };
}

export function usePresence(userId: string): PresenceStatus {
  const rt = useRealtimeOptional();
  return useStore(rt?.store ?? FALLBACK, (s) => s.presence[userId] ?? "offline");
}

export function usePresenceMap(): Record<string, PresenceStatus> {
  const rt = useRealtime();
  return useStore(rt.store, (s) => s.presence);
}

export function useTyping(channelId: string): string[] {
  const rt = useRealtime();
  return useStore(rt.store, (s) => s.typing[channelId] ?? EMPTY);
}

export function useVoiceParticipants(channelId: string) {
  const rt = useRealtimeOptional();
  return useStore(rt?.store ?? FALLBACK, (s) => s.voice[channelId] ?? EMPTY);
}

export function useVoiceMap() {
  const rt = useRealtime();
  return useStore(rt.store, (s) => s.voice);
}

export function usePendingMessages(channelId: string): PendingMessage[] {
  const rt = useRealtime();
  return useStore(rt.store, (s) => s.pending[channelId] ?? EMPTY);
}

export function useSyncVersion(): number {
  const rt = useRealtime();
  return useStore(rt.store, (s) => s.syncVersion);
}

// A frozen store used when a hook is rendered outside a workspace (e.g. profile pages).
import { createStore } from "@/lib/store";
import type { RealtimeState } from "./RealtimeProvider";
const FALLBACK = createStore<RealtimeState>({ status: "closed", attempt: 0, fatal: null, presence: {}, typing: {}, voice: {}, pending: {}, activeChannelId: null, syncVersion: 0 });
