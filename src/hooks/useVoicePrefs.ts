export const VOICE_PREF_KEYS = {
  micId: "commons.voice.micId",
  speakerId: "commons.voice.speakerId",
  cameraId: "commons.voice.cameraId",
  noiseSuppression: "commons.voice.noiseSuppression",
  echoCancellation: "commons.voice.echoCancellation",
  setupDone: "commons.voice.setupDone",
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
