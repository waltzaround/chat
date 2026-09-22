export const VOICE_PREF_KEYS = {
  micId: "chat.voice.micId",
  speakerId: "chat.voice.speakerId",
  cameraId: "chat.voice.cameraId",
  noiseSuppression: "chat.voice.noiseSuppression",
  echoCancellation: "chat.voice.echoCancellation",
  setupDone: "chat.voice.setupDone",
} as const;

export interface VoicePrefs {
  micId: string | null;
  speakerId: string | null;
  cameraId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  setupDone: boolean;
}

export function readVoicePrefs(): VoicePrefs {
  const get = (k: string) => localStorage.getItem(k);
  return {
    micId: get(VOICE_PREF_KEYS.micId),
    speakerId: get(VOICE_PREF_KEYS.speakerId),
    cameraId: get(VOICE_PREF_KEYS.cameraId),
    noiseSuppression: get(VOICE_PREF_KEYS.noiseSuppression) !== "false",
    echoCancellation: get(VOICE_PREF_KEYS.echoCancellation) !== "false",
    setupDone: get(VOICE_PREF_KEYS.setupDone) === "true",
  };
}

export function writeVoicePref<K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]): void {
  const storageKey = VOICE_PREF_KEYS[key];
  if (value === null) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, String(value));
}
