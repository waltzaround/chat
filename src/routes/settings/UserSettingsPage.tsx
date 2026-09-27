import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { LogOut, Monitor, Moon, Sun, User, Bell, Mic, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SettingsLayout } from "./SettingsLayout";
import { RegistrationPolicyPicker, WorkspaceCreationPicker } from "@/components/onboarding/RegistrationPolicyPicker";
import { EmailStatus, ServerAccounts } from "./ServerAccounts";
import { AccountSection } from "./AccountSection";
import { LinkedServersSection } from "./LinkedServersSection";
import { ReportsPanel } from "./ReportsPanel";
import { ImagePicker } from "@/components/common/ImagePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useAuthConfig, useBlocks, useMe, useServerSettings, useSetBlocked, useUpdateMe, useUpdateServerSettings, useWorkspaces } from "@/lib/queries";
import { UserAvatar } from "@/components/common/UserAvatar";
import { browserNotificationsSupported, useNotificationPrefs } from "@/lib/notifications";
import { disablePush, enablePush, isPushEnabled, needsHomeScreen, pushSupported, syncPushPrefs } from "@/lib/push";
import { changeDesktopServer, desktopNotificationsAllowed, isDesktopApp, requestDesktopNotifications } from "@/lib/desktop";
import { useTheme, type Theme } from "@/lib/theme";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PreferredStatus } from "@shared/types";

const TABS = [
  { id: "profile", label: "Profile", icon: <User className="size-3.5" /> },
  { id: "appearance", label: "Appearance", icon: <Monitor className="size-3.5" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="size-3.5" /> },
  { id: "privacy", label: "Privacy", icon: <ShieldCheck className="size-3.5" /> },
  { id: "voice", label: "Voice & Video", icon: <Mic className="size-3.5" /> },
];

/** Only the server owner sees this one. */
const SERVER_TAB = { id: "server", label: "Server", icon: <Server className="size-3.5" /> };

export function UserSettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const me = useMe().data;
  const isServerOwner = me?.isServerOwner ?? false;
  const tabs = isServerOwner ? [...TABS, SERVER_TAB] : TABS;
  const activeTab = tabs.find((t) => t.id === tab)?.id ?? "profile";

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.assign("/login");
  };

  const bottomContent = (
    <>
    {isDesktopApp() ? (
      <button
        type="button"
        onClick={changeDesktopServer}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Server className="size-3.5" aria-hidden />
        Change server
      </button>
    ) : null}
    <button
      type="button"
      onClick={() => void handleLogout()}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
    >
      <LogOut className="size-3.5" aria-hidden />
      Log out
    </button>
    </>
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
          {me?.hasPassword ? <ChangePassword /> : null}
          <LinkedServersSection />
          <AccountSection />
        </div>
      )}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "privacy" && <PrivacyTab />}
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
  const emailOn = useAuthConfig().data?.passwordResetEmail ?? false;
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
          {emailOn && me ? (
            me.emailVerified ? (
              <p className="text-xs text-muted-foreground">Confirmed.</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not confirmed yet.{" "}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => void authClient.sendVerificationEmail({ email: me.email, callbackURL: "/settings/profile" }).then(() => toast.success("Check your inbox for the link"))}
                >
                  Send a confirmation link
                </button>
              </p>
            )
          ) : null}
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
      <ServerBrandingSettings />
      <div className="grid gap-2">
        <p className="text-sm font-medium">Who can create an account</p>
        <RegistrationPolicyPicker />
        <p className="text-xs text-muted-foreground">Invite links from any workspace let people sign up, whichever you choose.</p>
      </div>
      <VerifiedEmailSetting />
      <div className="grid gap-2">
        <p className="text-sm font-medium">Who can create workspaces</p>
        <WorkspaceCreationPicker />
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Accounts</p>
        <EmailStatus />
        <ServerAccounts />
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Reported direct messages</p>
        <p className="text-xs text-muted-foreground">Direct messages have no moderators, so reports about them come to you.</p>
        <ReportsPanel source="server" />
      </div>
    </div>
  );
}

/** Name, icon and description shown on the sign-in page and in the apps. */
function ServerBrandingSettings() {
  const current = useServerSettings().data;
  const update = useUpdateServerSettings();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [iconRemoved, setIconRemoved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!current || dirty) return;
    setName(current.name ?? "");
    setDescription(current.description ?? "");
  }, [current, dirty]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: name.trim() || null,
        description: description.trim() || null,
        ...(iconKey ? { iconKey } : iconRemoved ? { iconKey: null } : {}),
      });
      setDirty(false);
      setIconKey(null);
      setIconRemoved(false);
      toast.success("Server details saved");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">How your server appears</p>
        <p className="text-xs text-muted-foreground">Shown on the sign-in page and in the Chat apps before anyone signs in.</p>
      </div>
      <ImagePicker
        purpose="workspace-icon"
        value={iconKey}
        currentUrl={iconRemoved ? null : current?.iconUrl}
        onChange={(key) => {
          setIconKey(key);
          setIconRemoved(key === null);
          setDirty(true);
        }}
        label="Server icon"
        fallbackText={name.trim().slice(0, 2).toUpperCase() || "S"}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="server-name">Name</Label>
        <Input id="server-name" value={name} maxLength={60} placeholder="Kiwi Devs" onChange={(e) => { setName(e.target.value); setDirty(true); }} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="server-description">Description (optional)</Label>
        <Textarea id="server-description" value={description} maxLength={300} rows={2} placeholder="What this server is for" onChange={(e) => { setDescription(e.target.value); setDirty(true); }} />
      </div>
      <div>
        <Button type="submit" disabled={!dirty || update.isPending}>
          Save
        </Button>
      </div>
    </form>
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

function VerifiedEmailSetting() {
  const settings = useServerSettings().data;
  const update = useUpdateServerSettings();
  if (!settings) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
      <div>
        <p className="text-sm font-medium">Require a confirmed email</p>
        <p className="text-xs text-muted-foreground">
          {settings.emailEnabled
            ? "New accounts must open the link we email them before they can sign in. Existing accounts aren't affected."
            : "Needs email, which needs the Workers Paid plan. Set it up with npm run setup."}
        </p>
      </div>
      <Switch
        checked={settings.requireVerifiedEmail}
        disabled={!settings.emailEnabled || update.isPending}
        onCheckedChange={(v) => update.mutate({ requireVerifiedEmail: v }, { onError: (err) => toast.error(errorMessage(err)) })}
        aria-label="Require a confirmed email"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy tab
// ---------------------------------------------------------------------------

function PrivacyTab() {
  const blocks = useBlocks();
  const setBlocked = useSetBlocked();
  return (
    <div className="grid max-w-lg gap-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Privacy</h2>
        <p className="text-sm text-muted-foreground">
          When you block someone, neither of you can send direct messages to the other, their mentions and replies don't notify you, and their messages are hidden behind "Show message". They aren't told. Block someone from their profile card.
        </p>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Blocked people</p>
        {blocks.data?.length ? (
          <ul className="divide-y rounded-md border">
            {blocks.data.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                <UserAvatar user={u} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {u.displayName} <span className="text-muted-foreground">@{u.username}</span>
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => setBlocked.mutate({ userId: u.id, blocked: false })} disabled={setBlocked.isPending}>
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">{blocks.isPending ? "Loading…" : "You haven't blocked anyone."}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications tab
// ---------------------------------------------------------------------------

function NotificationsTab() {
  const [prefs, setPrefs] = useNotificationPrefs();
  const workspaces = useWorkspaces().data ?? [];
  // The desktop app asks the operating system; a browser asks for the site.
  const desktopApp = isDesktopApp();
  const supported = desktopApp || browserNotificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(desktopApp ? "default" : supported ? Notification.permission : "unsupported");
  useEffect(() => {
    if (desktopApp) void desktopNotificationsAllowed().then((ok) => setPermission(ok ? "granted" : "default"));
  }, [desktopApp]);

  const setDesktop = async (on: boolean) => {
    if (on && permission !== "granted") {
      const granted = desktopApp ? await requestDesktopNotifications() : (await Notification.requestPermission()) === "granted";
      setPermission(granted ? "granted" : "denied");
      if (!granted) {
        toast.error(desktopApp ? "Notifications are turned off for Chat. Allow them in your system's notification settings." : "Your browser blocked notifications. Allow them for this site in the browser's settings, then try again.");
        return;
      }
    }
    setPrefs((p) => ({ ...p, desktop: on }));
  };

  const toggleMuted = (id: string, muted: boolean) =>
    setPrefs((p) => ({ ...p, mutedWorkspaces: muted ? [...p.mutedWorkspaces, id] : p.mutedWorkspaces.filter((w) => w !== id) }));

  // Push: notifications even when every tab is closed.
  const [push, setPush] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (pushSupported()) void isPushEnabled().then(setPush);
  }, []);
  useEffect(() => {
    if (push) void syncPushPrefs({ mutedWorkspaces: prefs.mutedWorkspaces, hideText: !prefs.showText });
  }, [push, prefs.mutedWorkspaces, prefs.showText]);
  const setPushOn = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) await enablePush({ mutedWorkspaces: prefs.mutedWorkspaces, hideText: !prefs.showText });
      else await disablePush();
      setPush(on);
      if (on) setPermission("granted");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="grid max-w-lg gap-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">You're notified when someone mentions you (@you, @everyone or @here), replies to you, or sends you a direct message. These settings are for this device.</p>
      </div>
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Desktop notifications</p>
            <p className="text-xs text-muted-foreground">
              {!supported
                ? "This browser doesn't support notifications."
                : permission === "denied"
                  ? "Blocked by your browser. Allow notifications for this site in the browser's settings."
                  : desktopApp
                    ? "Show a notification for mentions and messages, even while the window is closed."
                    : "Show a notification while this app is open in a tab."}
            </p>
          </div>
          <Switch checked={prefs.desktop && permission === "granted"} onCheckedChange={(v) => void setDesktop(v)} disabled={!supported || permission === "denied"} aria-label="Desktop notifications" />
        </div>
        {desktopApp ? null : (
        <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Push notifications on this device</p>
            <p className="text-xs text-muted-foreground">
              {!pushSupported()
                ? "This browser doesn't support push notifications."
                : needsHomeScreen()
                  ? "On iPhone and iPad, add this app to your Home Screen first (Share → Add to Home Screen), then turn this on there."
                  : "Get notified even when every tab is closed."}
            </p>
          </div>
          <Switch checked={!!push} onCheckedChange={(v) => void setPushOn(v)} disabled={!pushSupported() || needsHomeScreen() || pushBusy || push === null} aria-label="Push notifications on this device" />
        </div>
        )}
        <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Show message text</p>
            <p className="text-xs text-muted-foreground">Turn off to show only who sent it, e.g. on a shared screen.</p>
          </div>
          <Switch checked={prefs.showText} onCheckedChange={(v) => setPrefs((p) => ({ ...p, showText: v }))} aria-label="Show message text" />
        </div>
      </div>
      {workspaces.length ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Workspaces</p>
          <p className="text-xs text-muted-foreground">A muted workspace never shows desktop notifications. Mention badges still count.</p>
          <ul className="divide-y rounded-md border">
            {workspaces.map((w) => {
              const muted = prefs.mutedWorkspaces.includes(w.id);
              return (
                <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="truncate text-sm">{w.name}</span>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Mute
                    <Switch checked={muted} onCheckedChange={(v) => toggleMuted(w.id, v)} aria-label={`Mute ${w.name}`} />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
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
