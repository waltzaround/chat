import { useCallback, useEffect, useRef, useState } from "react";
import type RTKClient from "@cloudflare/realtimekit";
import { Camera, Mic, Volume2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { readVoicePrefs, writeVoicePref } from "@/hooks/useVoicePrefs";

/**
 * Compact first-run device setup: microphone (with level meter), speaker and
 * camera (with preview). Selections persist locally. Works before a meeting
 * exists by using the browser APIs directly; when a meeting is live it also
 * applies the choice immediately.
 */
export function DeviceSetupSheet({ open, onOpenChange, onDone, meeting }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void; meeting: RTKClient | undefined }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState(readVoicePrefs);
  const [micError, setMicError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [level, setLevel] = useState(0);
  const micStream = useRef<MediaStream | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const raf = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const supportsSink = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      /* ignore */
    }
  }, []);

  const stopMic = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  }, []);

  const stopCam = useCallback(() => {
    camStream.current?.getTracks().forEach((t) => t.stop());
    camStream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startMic = useCallback(
    async (deviceId: string | null) => {
      stopMic();
      setMicError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
        micStream.current = stream;
        const ctx = new AudioContext();
        audioCtx.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += (v - 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) / 40));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
        await refreshDevices();
      } catch (err) {
        setMicError(err instanceof DOMException && err.name === "NotAllowedError" ? "Microphone access was denied. You can still join, but you will be muted until you allow it in the browser." : "No microphone available.");
      }
    },
    [refreshDevices, stopMic],
  );

  const startCam = useCallback(
    async (deviceId: string | null) => {
      stopCam();
      setCamError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true });
        camStream.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraOn(true);
        await refreshDevices();
      } catch (err) {
        setCameraOn(false);
        setCamError(err instanceof DOMException && err.name === "NotAllowedError" ? "Camera access was denied. Allow it in the browser to use video." : "No camera available.");
      }
    },
    [refreshDevices, stopCam],
  );

  useEffect(() => {
    if (!open) {
      stopMic();
      stopCam();
      setCameraOn(false);
      return;
    }
    setPrefs(readVoicePrefs());
    void startMic(readVoicePrefs().micId);
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
  }, [open, startMic, stopMic, stopCam, refreshDevices]);

  const mics = devices.filter((d) => d.kind === "audioinput");
  const speakers = devices.filter((d) => d.kind === "audiooutput");
  const cams = devices.filter((d) => d.kind === "videoinput");
  const label = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`;

  const choose = async (kind: "micId" | "speakerId" | "cameraId", deviceId: string) => {
    const value = deviceId === "default" ? null : deviceId;
    writeVoicePref(kind, value);
    setPrefs((p) => ({ ...p, [kind]: value }));
    if (kind === "micId") void startMic(value);
    if (kind === "cameraId" && cameraOn) void startCam(value);
    if (meeting) {
      try {
        if (kind === "speakerId" && value) meeting.audio.setSpeakerDevice(value);
        else if (value) {
          const dev = devices.find((d) => d.deviceId === value);
          if (dev) await meeting.self.setDevice(dev);
        }
      } catch (err) {
        console.warn("setDevice failed", err);
      }
    }
  };

  const testSpeaker = async () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.08;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      const el = new Audio();
      el.srcObject = dest.stream;
      if (prefs.speakerId && "setSinkId" in el) await (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(prefs.speakerId);
      osc.frequency.value = 660;
      osc.start();
      await el.play();
      setTimeout(() => {
        osc.stop();
        el.pause();
        void ctx.close();
      }, 500);
    } catch {
      /* ignore */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Voice & video setup</DialogTitle>
          <DialogDescription>Choose your devices once. You can change them later from the voice tray or User settings → Voice & video.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="setup-mic" className="flex items-center gap-1.5">
              <Mic className="size-3.5" aria-hidden /> Microphone
            </Label>
            <Select value={prefs.micId ?? "default"} onValueChange={(v) => void choose("micId", v)}>
              <SelectTrigger id="setup-mic" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">System default</SelectItem>
                {mics.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {label(d, i, "Microphone")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <div className="h-full rounded-full bg-success transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            {micError ? <p className="text-xs text-warning">{micError}</p> : <p className="text-xs text-muted-foreground">Speak to test — the bar should move.</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="setup-speaker" className="flex items-center gap-1.5">
              <Volume2 className="size-3.5" aria-hidden /> Speaker
            </Label>
            <div className="flex gap-2">
              <Select value={prefs.speakerId ?? "default"} onValueChange={(v) => void choose("speakerId", v)} disabled={!supportsSink}>
                <SelectTrigger id="setup-speaker" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System default</SelectItem>
                  {speakers.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {label(d, i, "Speaker")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={() => void testSpeaker()}>
                Test
              </Button>
            </div>
            {!supportsSink ? <p className="text-xs text-muted-foreground">This browser does not allow choosing an output device; the system default is used.</p> : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="setup-cam" className="flex items-center gap-1.5">
              <Camera className="size-3.5" aria-hidden /> Camera
            </Label>
            <div className="flex gap-2">
              <Select value={prefs.cameraId ?? "default"} onValueChange={(v) => void choose("cameraId", v)}>
                <SelectTrigger id="setup-cam" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System default</SelectItem>
                  {cams.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {label(d, i, "Camera")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (cameraOn) {
                    stopCam();
                    setCameraOn(false);
                  } else void startCam(prefs.cameraId);
                }}
              >
                {cameraOn ? "Stop preview" : "Preview"}
              </Button>
            </div>
            <div className="aspect-video w-full overflow-hidden rounded-md border bg-black/80">
              <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover [transform:scaleX(-1)]" aria-label="Camera preview" />
            </div>
            {camError ? <p className="text-xs text-warning">{camError}</p> : null}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Noise suppression</p>
              <p className="text-xs text-muted-foreground">Applied on your next join.</p>
            </div>
            <Switch
              checked={prefs.noiseSuppression}
              onCheckedChange={(v) => {
                writeVoicePref("noiseSuppression", v);
                setPrefs((p) => ({ ...p, noiseSuppression: v }));
              }}
              aria-label="Noise suppression"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
