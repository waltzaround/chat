# Cloudflare RealtimeKit Core SDK — Custom UI Reference

Packages: `@cloudflare/realtimekit` v2 · `@cloudflare/realtimekit-react` v2  
Ground truth sources: `.d.ts` files in `node_modules/@cloudflare/realtimekit{,-react}/dist/index.d.ts`; supplementary: `https://developers.cloudflare.com/realtime/realtimekit/core/`

---

## A. React package — `@cloudflare/realtimekit-react`

### Named exports

```ts
// Source: node_modules/@cloudflare/realtimekit-react/dist/index.d.ts

// 1. Hook that manages and initialises the RTKClient instance
const useRealtimeKitClient: (
  clientParams?: { resetOnLeave?: boolean }
) => [RTKClient, (options: RTKClientOptions) => Promise<RTKClient | undefined>];

// RTKClientOptions = ClientOptions from @cloudflare/realtimekit:
interface ClientOptions {
  authToken: string;
  defaults?: {
    video?: boolean;
    audio?: boolean;
    recording?: RecordingConfig;
    autoSwitchAudioDevice?: boolean;
    mediaConfiguration?: {
      video?: VideoQualityConstraints;    // { width, height, frameRate }
      audio?: AudioQualityConstraints;
      screenshare?: ScreenshareQualityConstraints;
    };
    isNonPreferredDevice?: (device: MediaDeviceInfo) => boolean;
    plugins?: ClientPluginConfig[];
  };
  modules?: {
    pip?: boolean; chat?: boolean; poll?: boolean; stage?: boolean;
    plugin?: boolean; recording?: boolean; livestream?: boolean;
    devTools?: { logs: boolean; logLevel?: string };
    experimentalAudioPlayback?: boolean;
  };
  overrides?: {
    simulcastConfig?: { disable?: boolean; encodings?: RTCRtpEncodingParameters[] };
    forceRelay?: boolean;
  };
  onError?: (error: ClientError) => void;
}

// 2. Context provider — wrap your app after meeting is initialised
declare function RealtimeKitProvider(props: {
  value: RTKClient | undefined;
  children: ReactNode;
  fallback?: ReactNode;
}): React.JSX.Element;

// 3. Consume the meeting instance from context
const useRealtimeKitMeeting: () => { meeting: RTKClient };

// 4. Subscribe to derived state, re-renders on any SDK update
const useRealtimeKitSelector: <StateSlice>(
  selector: (state: RTKClient) => StateSlice
) => StateSlice;
```

Also re-exports all core types from `@cloudflare/realtimekit` (RTKSelf, RTKParticipant, RTKParticipants, RTKMeta, RTKChat, etc.).

### Minimal usage

```tsx
import { useEffect } from 'react';
import {
  useRealtimeKitClient,
  RealtimeKitProvider,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from '@cloudflare/realtimekit-react';

export function App() {
  const [meeting, initMeeting] = useRealtimeKitClient();

  useEffect(() => {
    initMeeting({
      authToken: '<participant-auth-token>',
      defaults: { audio: true, video: true },
    });
  }, []);

  useEffect(() => {
    if (!meeting) return;
    meeting.join();               // join the room
    return () => { meeting.leave(); };
  }, [meeting]);

  return <RealtimeKitProvider value={meeting}><Call /></RealtimeKitProvider>;
}

function Call() {
  const { meeting } = useRealtimeKitMeeting();
  // Re-render when audio state changes:
  const audioEnabled = useRealtimeKitSelector(m => m.self.audioEnabled);
  return <button onClick={() => audioEnabled
    ? meeting.self.disableAudio()
    : meeting.self.enableAudio()
  }>{audioEnabled ? 'Mute' : 'Unmute'}</button>;
}
```

---

## B. Local user — `meeting.self` (`RTKSelf` / `Self`)

Source: `node_modules/@cloudflare/realtimekit/dist/index.d.ts` — class `Self extends SelfMedia`

### Properties

| Property | Type | Notes |
|---|---|---|
| `id` | `string` | Peer ID in the session |
| `userId` | `string` | Application user ID |
| `customParticipantId` | `string` | Your app-assigned ID |
| `name` | `string` | Display name |
| `picture` | `string` | Avatar URL |
| `roomState` | `'init' \| 'joined' \| 'waitlisted' \| LeaveRoomState` | Current room state |
| `roomJoined` | `boolean` | True once in room |
| `isPinned` | `boolean` | |
| `audioEnabled` | `boolean` | |
| `videoEnabled` | `boolean` | |
| `screenShareEnabled` | `boolean` | |
| `audioTrack` | `MediaStreamTrack` | Processed (middleware applied) |
| `rawAudioTrack` | `MediaStreamTrack` | Raw mic track |
| `videoTrack` | `MediaStreamTrack` | Processed |
| `rawVideoTrack` | `MediaStreamTrack` | Raw camera track |
| `screenShareTracks` | `{ audio: MediaStreamTrack; video: MediaStreamTrack }` | |
| `mediaPermissions` | `{ audio?, video?, screenshare? }` | Each is `'NOT_REQUESTED' \| 'ACCEPTED' \| 'DENIED' \| 'SYSTEM_DENIED' \| 'COULD_NOT_START' \| 'NO_DEVICES_AVAILABLE' \| 'CANCELED'` |
| `permissions` | `PermissionPreset` | From preset (canProduceAudio, kickParticipant, etc.) |

### Methods

```ts
self.enableAudio(customTrack?: MediaStreamTrack): Promise<void>
self.disableAudio(): Promise<void>
self.enableVideo(customTrack?: MediaStreamTrack): Promise<void>
self.disableVideo(): Promise<void>
self.enableScreenShare(): Promise<void>
self.disableScreenShare(): Promise<void>

// Device management
self.setDevice(device: MediaDeviceInfo): Promise<void>      // routes by device.kind
self.getCurrentDevices(): { audio: MediaDeviceInfo; video: MediaDeviceInfo; speaker: MediaDeviceInfo }
self.getAudioDevices(): Promise<MediaDeviceInfo[]>
self.getVideoDevices(): Promise<MediaDeviceInfo[]>
self.getSpeakerDevices(): Promise<MediaDeviceInfo[]>
self.getDeviceById(deviceId: string, kind: 'audio'|'video'|'speaker'): Promise<MediaDeviceInfo>

// Other
self.setName(name: string): void
self.setIsPinned(isPinned: boolean, emitEvent?: boolean): void
self.pin(): Promise<void>
self.unpin(): Promise<void>
self.getAllDevices(): Promise<InputDeviceInfo[]>
```

### Events (`self.on(event, handler)`)

```ts
type SelfEvents = {
  'roomJoined':            (payload: { reconnected: boolean }) => void;
  'roomLeft':              (payload: { state: LeaveRoomState }) => void;
  'audioUpdate':           (payload: { audioEnabled: boolean; audioTrack: MediaStreamTrack }) => void;
  'videoUpdate':           (payload: { videoEnabled: boolean; videoTrack: MediaStreamTrack }) => void;
  'screenShareUpdate':     (payload: { screenShareEnabled: boolean; screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack } }) => void;
  'deviceUpdate':          (payload: { device: MediaDeviceInfo }) => void;
  'deviceListUpdate':      (payload: { added: MediaDeviceInfo[]; removed: MediaDeviceInfo[]; devices: MediaDeviceInfo[] }) => void;
  'mediaPermissionUpdate': (payload: { message: keyof typeof MediaPermission; kind: 'audio'|'video'|'screenshare' }) => void;
  'mediaPermissionError':  (payload: { message: keyof typeof MediaPermission; constraints: any; kind: 'audio'|'video'|'screenshare' }) => void;
  'pinned':                (payload: Self) => void;
  'unpinned':              (payload: Self) => void;
  'waitlisted':            () => void;
  'autoplayError':         (error: Error) => void;
  'toggleTile':            (payload: { hidden: boolean }) => void;
};
```

**`LeaveRoomState`** values: `'kicked' | 'ended' | 'left' | 'rejected' | 'connected-meeting' | 'disconnected' | 'failed' | 'stageLeft'`

---

## C. Remote participants — `meeting.participants`

Source: `node_modules/@cloudflare/realtimekit/dist/index.d.ts` — class `Participants`

### Collections

All are `ParticipantMap` (extends `Map<string, Participant>`):

```ts
meeting.participants.joined      // all participants currently in the room
meeting.participants.active      // currently visible/rendering subset
meeting.participants.pinned      // pinned participants
meeting.participants.waitlisted  // in waiting room (tracks stripped)
meeting.participants.all         // BasicParticipantsMap — all ever added (lightweight, no tracks)
meeting.participants.lastActiveSpeaker  // string: peerId of last active speaker
```

### ParticipantMap API

```ts
map.toArray(): Participant[]
map.get(participantId: string): Participant
map.on(event, handler)   // see events below

// ParticipantMap events (prepended with the Participant object):
type ParticipantMapEvents = {
  'participantJoined':    (payload: Participant) => void;
  'participantLeft':      (payload: Participant) => void;
  'participantsCleared':  () => void;
  'participantsUpdate':   () => void;
  'kicked':               (payload: { id: string }) => void;
};
// Per-participant events bubble up from the participant:
// 'videoUpdate', 'audioUpdate', 'screenShareUpdate', 'pinned', 'unpinned'
// called as: handler(participant, payload)
```

### Participants-level events

```ts
meeting.participants.on('activeSpeaker', (payload: { peerId: string; volume: number }) => { ... });
meeting.participants.on('broadcastedMessage', (payload: { type: string; payload: BroadcastMessagePayload; timestamp: number }) => { ... });
meeting.participants.on('viewModeChanged', (payload: { viewMode: string; currentPage: number; pageCount: number }) => { ... });
meeting.participants.on('poorConnection', (payload: { participantId: string; score: number; kind: string }) => { ... });
```

### Participant object properties

```ts
class Participant {
  id: string;
  userId: string;
  name: string;
  picture: string;
  customParticipantId?: string;
  isPinned: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
  audioTrack: MediaStreamTrack;
  videoTrack: MediaStreamTrack;
  screenShareTracks: { audio: MediaStreamTrack; video: MediaStreamTrack };
  stageStatus: StageStatus;   // 'OFF_STAGE' | 'REQUESTED_TO_JOIN_STAGE' | 'ACCEPTED_TO_JOIN_STAGE' | 'ON_STAGE'
  presetName?: string;

  // Moderation (requires permission):
  pin(): Promise<void>
  unpin(): Promise<void>
  disableAudio(): Promise<void>
  disableVideo(): Promise<void>
  kick(): Promise<void>
}
```

### Per-participant events

```ts
type ParticipantEvents = {
  'audioUpdate':       (payload: { audioEnabled: boolean; audioTrack: MediaStreamTrack }) => void;
  'videoUpdate':       (payload: { videoEnabled: boolean; videoTrack: MediaStreamTrack }) => void;
  'screenShareUpdate': (payload: { screenShareEnabled: boolean; screenShareTracks: { audio: MediaStreamTrack; video: MediaStreamTrack } }) => void;
  'pinned':            (payload: Participant) => void;
  'unpinned':          (payload: Participant) => void;
  'kicked':            () => void;
  'poorConnection':    (payload: { score: number; kind: string }) => void;
  'stageStatusUpdate': (payload: Participant) => void;
};
```

---

## D. Rendering tracks in React

### Video / screenshare

Attach a `MediaStreamTrack` to a `<video>` element via `new MediaStream([track])`:

```tsx
import { useEffect, useRef } from 'react';

function VideoTile({ track }: { track: MediaStreamTrack | null }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!ref.current || !track) return;
    ref.current.srcObject = new MediaStream([track]);
    ref.current.play().catch(() => {/* autoplay may require user gesture */});
  }, [track]);

  return <video ref={ref} autoPlay playsInline muted style={{ width: '100%' }} />;
}
```

Note: local self video should be `muted` to avoid echo.

### Remote audio — SDK auto-manages playback

The SDK exposes `meeting.audio: AudioPlaybackManager` which **automatically plays remote audio tracks** as participants join. You do NOT need to attach remote audio tracks to `<audio>` elements yourself for them to be heard.

```ts
// SDK internal: called automatically when remote audio track arrives
meeting.audio.addParticipantTrack(participantId: string, track: MediaStreamTrack): void
meeting.audio.removeParticipantTrack(participantId: string): void
```

**IMPORTANT — autoplay policy:** The `autoplayError` event fires on `meeting.self` if the browser blocks audio (requires a prior user gesture). Gate `meeting.join()` behind a button click to satisfy the browser's autoplay policy.

### Speaker output routing

```ts
// Route all SDK audio output to a specific speaker device:
meeting.audio.setSpeakerDevice(deviceId: string): void

// Get available speaker devices:
const speakers = await meeting.self.getSpeakerDevices(); // MediaDeviceInfo[]
// Then pass the deviceId:
meeting.audio.setSpeakerDevice(speakers[0].deviceId);
```

`setSpeakerDevice` calls `setSinkId` internally on the managed audio element.

---

## E. Connection state

### `meeting.meta` (`RTKMeta` / `Meta`)

```ts
meeting.meta.meetingId: string
meeting.meta.meetingTitle: string
meeting.meta.sessionId: string
meeting.meta.viewType: string            // 'GROUP_CALL' | 'WEBINAR' | etc.
meeting.meta.socketState: SocketConnectionState
// SocketConnectionState = { state: 'connected'|'disconnected'|'reconnecting'|'failed'; reconnected: boolean; reconnectionAttempt: number }
meeting.meta.mediaState: MediaConnectionState
// MediaConnectionState = { recv: { state: TransportState; sfuSessionId? }; send: { state: TransportState; sfuSessionId? } }
// TransportState = 'new'|'connecting'|'reconnecting'|'disconnected'|'connected'|'failed'|'closed'
```

### Meta events

```ts
meeting.meta.on('socketConnectionUpdate', (state: SocketConnectionState) => { ... });
meeting.meta.on('mediaConnectionUpdate', (payload: { transport: 'send'|'recv'; state: string; sfuSessionId?: string }) => { ... });
meeting.meta.on('poorConnection', (payload: { score: number }) => { ... });
```

### Disconnect / reconnect / kicked / meeting ended

```ts
// Self events:
meeting.self.on('roomLeft', ({ state }: { state: LeaveRoomState }) => {
  // state === 'kicked'       — you were removed by a host
  // state === 'ended'        — host ended the meeting for everyone
  // state === 'left'         — you called meeting.leave()
  // state === 'disconnected' — network lost, SDK gave up reconnecting
  // state === 'failed'       — unrecoverable error
});

meeting.self.on('roomJoined', ({ reconnected }: { reconnected: boolean }) => {
  // reconnected=true if this was a reconnect after a drop
});

meeting.self.on('waitlisted', () => {
  // placed in waiting room; waiting for host admission
});
```

**Room state polling:** `meeting.self.roomState` reflects `'init' | 'joined' | 'waitlisted' | LeaveRoomState`.

---

## F. Presets — REST API

### Endpoint

```
POST /accounts/{account_id}/realtime/kit/{app_id}/presets
Authorization: Bearer <cf_api_token>
Content-Type: application/json
```

Source: `https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/`

### Key request body fields

```
name          string       — unique name for the preset
config
  view_type   enum         — "GROUP_CALL" | "WEBINAR" | "AUDIO_ROOM" | "LIVESTREAM"
                             GROUP_CALL: full mesh, all participants see each other
                             WEBINAR: stage model (hosts on stage, attendees view only by default)
  media
    video.quality          — "vga" | "hd" | "fhd" | "uhd" | "qvga"
    video.frame_rate       — number (max 30)
    video.simulcast        — boolean (enable SVC layers)
    screenshare.quality    — same enum
    screenshare.frame_rate — number
    audio.enable_high_bitrate — boolean
    audio.enable_stereo    — boolean
  max_video_streams.desktop  — number
  max_video_streams.mobile   — number
  max_screenshare_count      — number
permissions
  accept_waiting_requests         — boolean (can admit waiting room entrants)
  can_accept_production_requests  — boolean (can grant "present" requests)
  can_change_participant_permissions — boolean
  can_edit_display_name           — boolean
  can_record                      — boolean
  can_spotlight                   — boolean
  kick_participant                 — boolean
  pin_participant                  — boolean
  disable_participant_audio        — boolean (can force-mute others)
  disable_participant_video        — boolean
  disable_participant_screensharing — boolean
  hidden_participant               — boolean
  show_participant_list            — boolean
  waiting_room_type    enum       — "NONE"|"SKIP"|"ON_PRIVILEGED_USER_ENTRY"|"SKIP_ON_ACCEPT"
  media
    video.can_produce    enum     — "ALLOWED"|"NOT_ALLOWED"|"CAN_REQUEST"
    audio.can_produce    enum     — "ALLOWED"|"NOT_ALLOWED"|"CAN_REQUEST"
    screenshare.can_produce enum  — "ALLOWED"|"NOT_ALLOWED"|"CAN_REQUEST"
  chat
    public.can_send — boolean
    public.text     — boolean
    public.files    — boolean
    private.can_send, private.can_receive, private.text, private.files
  polls.can_create, polls.can_vote, polls.can_view
  plugins.can_start, plugins.can_close
```

**`can_produce` enum values** (from SDK `StreamPermissionType`):  
`"ALLOWED"` — can produce unconditionally  
`"NOT_ALLOWED"` — cannot produce  
`"CAN_REQUEST"` — must request permission from a host

### Ready-to-send bodies

#### `commons_full` — full participant (group call, no waiting room, can produce everything)

```json
{
  "name": "commons_full",
  "config": {
    "view_type": "GROUP_CALL",
    "media": {
      "video": { "quality": "hd", "frame_rate": 30, "simulcast": true },
      "screenshare": { "quality": "hd", "frame_rate": 15 },
      "audio": { "enable_high_bitrate": false, "enable_stereo": false }
    },
    "max_video_streams": { "desktop": 9, "mobile": 4 },
    "max_screenshare_count": 1
  },
  "permissions": {
    "accept_waiting_requests": false,
    "can_accept_production_requests": false,
    "can_change_participant_permissions": false,
    "can_edit_display_name": true,
    "can_record": false,
    "can_spotlight": false,
    "kick_participant": false,
    "pin_participant": true,
    "disable_participant_audio": false,
    "disable_participant_video": false,
    "disable_participant_screensharing": false,
    "hidden_participant": false,
    "show_participant_list": true,
    "waiting_room_type": "NONE",
    "media": {
      "video":       { "can_produce": "ALLOWED" },
      "audio":       { "can_produce": "ALLOWED" },
      "screenshare": { "can_produce": "ALLOWED" }
    },
    "chat": {
      "public":  { "can_send": true, "text": true, "files": true },
      "private": { "can_send": true, "can_receive": true, "text": true, "files": true }
    },
    "polls":   { "can_create": true, "can_vote": true, "can_view": true },
    "plugins": { "can_start": false, "can_close": false }
  }
}
```

#### `commons_listen` — view-only attendee (cannot produce audio, video, or screenshare)

```json
{
  "name": "commons_listen",
  "config": {
    "view_type": "GROUP_CALL",
    "media": {
      "video": { "quality": "hd", "frame_rate": 30, "simulcast": false },
      "screenshare": { "quality": "hd", "frame_rate": 15 },
      "audio": { "enable_high_bitrate": false, "enable_stereo": false }
    },
    "max_video_streams": { "desktop": 9, "mobile": 4 },
    "max_screenshare_count": 1
  },
  "permissions": {
    "accept_waiting_requests": false,
    "can_accept_production_requests": false,
    "can_change_participant_permissions": false,
    "can_edit_display_name": true,
    "can_record": false,
    "can_spotlight": false,
    "kick_participant": false,
    "pin_participant": false,
    "disable_participant_audio": false,
    "disable_participant_video": false,
    "disable_participant_screensharing": false,
    "hidden_participant": false,
    "show_participant_list": true,
    "waiting_room_type": "NONE",
    "media": {
      "video":       { "can_produce": "NOT_ALLOWED" },
      "audio":       { "can_produce": "NOT_ALLOWED" },
      "screenshare": { "can_produce": "NOT_ALLOWED" }
    },
    "chat": {
      "public":  { "can_send": true, "text": true, "files": false },
      "private": { "can_send": false, "can_receive": true, "text": false, "files": false }
    },
    "polls":   { "can_create": false, "can_vote": true, "can_view": true },
    "plugins": { "can_start": false, "can_close": false }
  }
}
```

---

## Sources per section

- **A**: `node_modules/@cloudflare/realtimekit-react/dist/index.d.ts`; `https://developers.cloudflare.com/realtime/realtimekit/core/`
- **B**: `node_modules/@cloudflare/realtimekit/dist/index.d.ts` — class `Self`, `SelfMedia`, `SelfEvents` type (~lines 2312–4271)
- **C**: same file — class `Participant`, `Participants`, `ParticipantEvents`, `ParticipantMapEvents`, `ParticipantsEvents` types (~lines 2279–2584)
- **D**: same file — class `AudioPlayback`, `AudioPlaybackManager` (~lines 4093–4106); `Client.audio` getter (~line 4748)
- **E**: same file — class `Meta`, `MetaEvents`, `SocketConnectionState`, `LeaveRoomState` (~lines 2088–2116, 1765–1769, 3020)
- **F**: `https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/`; `PresetV2CamelCased` type in `index.d.ts` (~lines 2781–2912)
