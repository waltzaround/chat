import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { LogOut, Monitor, Moon, Sun, User, Bell, Mic, Server } from "lucide-react";
import { toast } from "sonner";
import { SettingsLayout } from "./SettingsLayout";
import { RegistrationPolicyPicker } from "@/components/onboarding/RegistrationPolicyPicker";
import { EmailStatus, ServerAccounts } from "./ServerAccounts";
import { ImagePicker } from "@/components/common/ImagePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useMe, useUpdateMe } from "@/lib/queries";
import { useTheme, type Theme } from "@/lib/theme";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PreferredStatus } from "@shared/types";

const TABS = [
  { id: "profile", label: "Profile", icon: <User className="size-3.5" /> },
  { id: "appearance", label: "Appearance", icon: <Monitor className="size-3.5" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="size-3.5" /> },
  { id: "voice", label: "Voice & Video", icon: <Mic className="size-3.5" /> },
];

/** Only the server owner sees this one. */
const SERVER_TAB = { id: "server", label: "Server", icon: <Server className="size-3.5" /> };

export function UserSettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const isServerOwner = useMe().data?.isServerOwner ?? false;
  const tabs = isServerOwner ? [...TABS, SERVER_TAB] : TABS;
  const activeTab = tabs.find((t) => t.id === tab)?.id ?? "profile";

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.assign("/login");
  };

  const bottomContent = (
    <button
      type="button"
      onClick={() => void handleLogout()}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
    >
      <LogOut className="size-3.5" aria-hidden />
      Log out
    </button>
  );

  return (
    <SettingsLayout
      tabs={tabs}
      activeTab={activeTab}
      basePath="/settings"
      closePath="/"
      title="User Settings"
      bottomContent={bottomContent}
    >
      {activeTab === "profile" && (
        <div className="grid gap-10">
          <ProfileTab />
          <ChangePassword />
        </div>
      )}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "voice" && <VoiceTab />}
      {activeTab === "server" && <ServerTab />}
    </SettingsLayout>
  );
}

// ---------------------------------------------------------------------------
// Profile tab
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { data: me } = useMe();
  const update = useUpdateMe();

  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState<PreferredStatus>("online");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName);
    setUsername(me.username);
    setBio(me.bio ?? "");
    setStatus(me.status);
  }, [me]);

  const markDirty = () => setDirty(true);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        displayName: displayName.trim() || undefined,
        username: username.trim() || undefined,
        bio: bio.trim() || null,
        status,
        ...(avatarKey !== null ? { avatarKey } : {}),
      });
      setDirty(false);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <div>
        <h2 className="mb-4 text-base font-semibold">Profile</h2>
        <div className="flex items-start gap-5">
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">Avatar</Label>
            <ImagePicker
              purpose="avatar"
              value={avatarKey}
              onChange={(k) => { setAvatarKey(k); markDirty(); }}
              label="Change avatar"
              fallbackText={me?.displayName ?? "?"}
              currentUrl={me?.avatarUrl}
            />
          </div>
          <div className="flex-1 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
                maxLength={48}
                placeholder="Your display name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => { setUsername(e.target.value.toLowerCase()); markDirty(); }}
                maxLength={32}
                minLength={2}
                pattern="[a-z0-9_.]+"
                placeholder="username"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, dots and underscores. 2–32 characters.</p>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={me?.email ?? ""} readOnly disabled className="opacity-60" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => { setBio(e.target.value); markDirty(); }}
            maxLength={190}
            rows={3}
            placeholder="Tell people a little about yourself"
            className="resize-none"
          />
          <p className="text-right text-xs text-muted-foreground">{bio.length}/190</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status">Preferred status</Label>
          <Select value={status} onValueChange={(v) => { setStatus(v as PreferredStatus); markDirty(); }}>
            <SelectTrigger id="status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="idle">Idle</SelectItem>
              <SelectItem value="dnd">Do Not Disturb</SelectItem>
              <SelectItem value="invisible">Invisible</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" onClick={() => {
            if (!me) return;
            setDisplayName(me.displayName);
            setUsername(me.username);
            setBio(me.bio ?? "");
            setStatus(me.status);
            setAvatarKey(null);
            setDirty(false);
          }}>
            Reset
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Appearance tab
// ---------------------------------------------------------------------------

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
  { value: "light", label: "Light", icon: <Sun className="size-4" /> },
  { value: "system", label: "System", icon: <Monitor className="size-4" /> },
];

function AppearanceTab() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="grid gap-6">
      <h2 className="text-base font-semibold">Appearance</h2>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Theme</Label>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={cn(
                "flex flex-1 flex-col items-center gap-2 rounded-md border px-4 py-3 text-sm transition-colors hover:bg-accent",
                theme === opt.value && "border-primary bg-accent font-medium",
              )}
              aria-pressed={theme === opt.value}
            >
              <span aria-hidden>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server tab (owner only)
// ---------------------------------------------------------------------------

function ServerTab() {
  return (
    <div className="grid max-w-lg gap-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Server</h2>
        <p className="text-sm text-muted-foreground">You own this server, so these settings apply to everyone on it.</p>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Who can create an account</p>
        <RegistrationPolicyPicker />
        <p className="text-xs text-muted-foreground">Invite links from any workspace let people sign up, whichever you choose.</p>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Accounts and password resets</p>
        <EmailStatus />
        <ServerAccounts />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change password (Profile tab)
// ---------------------------------------------------------------------------

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.code === "INVALID_PASSWORD" ? "Your current password is wrong" : (res.error.message ?? "Could not change your password"));
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed. Other devices are signed out.");
  };

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      <Separator />
      <h2 className="text-base font-semibold">Password</h2>
      <div className="grid gap-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <Input id="current-password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
        <p className="text-xs text-muted-foreground">At least 8 characters. Changing it signs out your other devices.</p>
      </div>
      <div>
        <Button type="submit" disabled={busy || !current || next.length < 8}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Notifications tab
// ---------------------------------------------------------------------------

function NotificationsTab() {
  return (
    <div className="grid gap-6">
      <h2 className="text-base font-semibold">Notifications</h2>
      <p className="text-sm text-muted-foreground">Notification preferences are coming soon.</p>
      <div className="grid gap-3">
        {[
          { id: "desktop", label: "Desktop notifications", description: "Show a browser notification when you receive a message" },
          { id: "sounds", label: "Sounds", description: "Play sounds for incoming messages and events" },
        ].map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-md border border-border px-4 py-3 opacity-50">
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
            <Switch disabled aria-label={item.label} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">These settings are not wired yet and will be enabled in a future update.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice & Video tab
// ---------------------------------------------------------------------------

const MIC_KEY = "chat.voice.micId";
const SPEAKER_KEY = "chat.voice.speakerId";
const CAMERA_KEY = "chat.voice.cameraId";
const NOISE_KEY = "chat.voice.noiseSuppression";
const ECHO_KEY = "chat.voice.echoCancellation";

function VoiceTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permDenied, setPermDenied] = useState(false);
  const [micId, setMicId] = useState(() => localStorage.getItem(MIC_KEY) ?? "");
  const [speakerId, setSpeakerId] = useState(() => localStorage.getItem(SPEAKER_KEY) ?? "");
  const [cameraId, setCameraId] = useState(() => localStorage.getItem(CAMERA_KEY) ?? "");
  const [noiseSupp, setNoiseSupp] = useState(() => localStorage.getItem(NOISE_KEY) !== "false");
  const [echoCanc, setEchoCanc] = useState(() => localStorage.getItem(ECHO_KEY) !== "false");

  const loadDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => { void loadDevices(); }, []);

  const grantPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermDenied(false);
      await loadDevices();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermDenied(true);
      }
    }
  };

  const mics = devices.filter((d) => d.kind === "audioinput");
  const speakers = devices.filter((d) => d.kind === "audiooutput");
  const cameras = devices.filter((d) => d.kind === "videoinput");
  const hasLabels = devices.some((d) => !!d.label);

  const DeviceSelect = ({
    id, label, value, onChange, list, placeholder,
  }: {
    id: string; label: string; value: string; onChange: (v: string) => void; list: MediaDeviceInfo[]; placeholder: string;
  }) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || "default"} onValueChange={(v) => { onChange(v === "default" ? "" : v); localStorage.setItem(id === "mic" ? MIC_KEY : id === "speaker" ? SPEAKER_KEY : CAMERA_KEY, v === "default" ? "" : v); }}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          {list.map((d) => (
            <SelectItem key={d.deviceId} value={d.deviceId}>
              {d.label || `Device ${d.deviceId.slice(0, 8)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="grid gap-6">
      <h2 className="text-base font-semibold">Voice & Video</h2>

      {!hasLabels && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
          <p className="mb-2 text-sm text-muted-foreground">Grant microphone permission to see device names.</p>
          {permDenied && <p className="mb-2 text-xs text-destructive">Permission was denied. Enable it in your browser settings.</p>}
          <Button type="button" size="sm" variant="outline" onClick={() => void grantPermission()}>
            Grant permission
          </Button>
        </div>
      )}

      <div className="grid gap-4">
        <DeviceSelect id="mic" label="Microphone" value={micId} onChange={(v) => { setMicId(v); localStorage.setItem(MIC_KEY, v); }} list={mics} placeholder="Default microphone" />
        <DeviceSelect id="speaker" label="Speaker" value={speakerId} onChange={(v) => { setSpeakerId(v); localStorage.setItem(SPEAKER_KEY, v); }} list={speakers} placeholder="Default speaker" />
        <DeviceSelect id="camera" label="Camera" value={cameraId} onChange={(v) => { setCameraId(v); localStorage.setItem(CAMERA_KEY, v); }} list={cameras} placeholder="Default camera" />
      </div>

      <Separator />

      <div className="grid gap-3">
        <h3 className="text-sm font-medium">Processing</h3>
        <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Noise suppression</p>
            <p className="text-xs text-muted-foreground">Reduce background noise from your microphone</p>
          </div>
          <Switch
            id="noise-suppression"
            checked={noiseSupp}
            onCheckedChange={(v) => { setNoiseSupp(v); localStorage.setItem(NOISE_KEY, String(v)); }}
            aria-label="Noise suppression"
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Echo cancellation</p>
            <p className="text-xs text-muted-foreground">Prevent audio feedback from your speakers</p>
          </div>
          <Switch
            id="echo-cancellation"
            checked={echoCanc}
            onCheckedChange={(v) => { setEchoCanc(v); localStorage.setItem(ECHO_KEY, String(v)); }}
            aria-label="Echo cancellation"
          />
        </div>
      </div>
    </div>
  );
}
