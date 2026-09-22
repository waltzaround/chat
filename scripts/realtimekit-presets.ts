/**
 * Creates the two RealtimeKit presets Chat relies on:
 *   - chat_full   → can produce audio, video and screen share
 *   - chat_listen → view/listen only (used when a member lacks SPEAK)
 *
 * Usage (reads the same variables as .dev.vars):
 *   CLOUDFLARE_ACCOUNT_ID=... REALTIMEKIT_APP_ID=... CLOUDFLARE_REALTIME_API_TOKEN=... npx tsx scripts/realtimekit-presets.ts
 *
 * Safe to re-run: existing presets are left untouched.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const appId = process.env.REALTIMEKIT_APP_ID;
const token = process.env.CLOUDFLARE_REALTIME_API_TOKEN;
if (!accountId || !appId || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID, REALTIMEKIT_APP_ID and CLOUDFLARE_REALTIME_API_TOKEN");
  process.exit(1);
}
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const common = {
  config: {
    view_type: "GROUP_CALL",
    media: {
      video: { quality: "hd", frame_rate: 30, simulcast: true },
      screenshare: { quality: "hd", frame_rate: 15 },
      audio: { enable_high_bitrate: false, enable_stereo: false },
    },
    max_video_streams: { desktop: 9, mobile: 4 },
    max_screenshare_count: 2,
  },
};

const basePermissions = {
  accept_waiting_requests: false,
  can_accept_production_requests: false,
  can_change_participant_permissions: false,
  can_edit_display_name: false,
  can_record: false,
  can_spotlight: false,
  kick_participant: false,
  pin_participant: true,
  disable_participant_audio: false,
  disable_participant_video: false,
  disable_participant_screensharing: false,
  hidden_participant: false,
  show_participant_list: true,
  waiting_room_type: "NONE",
  chat: { public: { can_send: false, text: false, files: false }, private: { can_send: false, can_receive: false, text: false, files: false } },
  polls: { can_create: false, can_vote: false, can_view: false },
  plugins: { can_start: false, can_close: false },
};

const presets = [
  {
    name: process.env.REALTIMEKIT_PRESET_FULL ?? "chat_full",
    ...common,
    permissions: { ...basePermissions, media: { video: { can_produce: "ALLOWED" }, audio: { can_produce: "ALLOWED" }, screenshare: { can_produce: "ALLOWED" } } },
  },
  {
    name: process.env.REALTIMEKIT_PRESET_LISTEN ?? "chat_listen",
    ...common,
    permissions: { ...basePermissions, pin_participant: false, media: { video: { can_produce: "NOT_ALLOWED" }, audio: { can_produce: "NOT_ALLOWED" }, screenshare: { can_produce: "NOT_ALLOWED" } } },
  },
];

async function main() {
  const listRes = await fetch(`${base}/presets`, { headers });
  const list = (await listRes.json()) as { success: boolean; data?: Array<{ name: string }>; errors?: unknown };
  if (!listRes.ok || !list.success) {
    console.error("Failed to list presets", listRes.status, JSON.stringify(list.errors ?? list));
    process.exit(1);
  }
  const existing = new Set((list.data ?? []).map((p) => p.name));
  for (const preset of presets) {
    if (existing.has(preset.name)) {
      console.log(`✓ preset ${preset.name} already exists`);
      continue;
    }
    const res = await fetch(`${base}/presets`, { method: "POST", headers, body: JSON.stringify(preset) });
    const body = (await res.json()) as { success: boolean; errors?: unknown };
    if (!res.ok || !body.success) {
      console.error(`✗ failed to create ${preset.name}`, res.status, JSON.stringify(body.errors ?? body));
      process.exit(1);
    }
    console.log(`✓ created preset ${preset.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
