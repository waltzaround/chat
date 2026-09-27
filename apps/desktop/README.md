# Chat for Windows and macOS

A [Tauri](https://tauri.app) app that puts your Chat server in its own window, the way
Slack's and Discord's desktop apps work. Every feature of your server works, and the
app picks up server updates without being reinstalled.

On first launch it asks for your server's address (for example `chat.example.com`),
checks that it's a Chat server, remembers it, and opens it. Then:

- **Notifications** for mentions, replies and direct messages come from the operating
  system, even with the window closed. Turn them on in Settings → Notifications.
- **Unread badge** on the dock icon (macOS) shows unread mentions and DMs.
- **Closing the window keeps Chat running** in the background (tray icon / dock).
  Quit from the tray menu or with ⌘Q.
- **Change server** from the tray menu or at the bottom of User Settings.
- **`chat://invite/CODE` links** open that invite in the app.
- Links to other sites open in your browser. Only your server can use the app's native
  features (notifications, badge); that permission is granted to its exact address.

## Run and build

Needs Rust (`rustup`) and, on Windows, the WebView2 runtime (included in Windows 11).

```bash
pnpm desktop          # run from source
pnpm desktop:build    # build this platform's installer into src-tauri/target/release/bundle
```

Windows and universal macOS builds come from GitHub Actions: run the **Desktop app**
workflow, or push a tag like `desktop-v0.1.0` to get a draft release with installers.

## Signing

Unsigned builds work, but Windows SmartScreen and macOS Gatekeeper warn on first
launch ("unidentified developer"; on macOS, right-click → Open once).

- **macOS:** needs an Apple Developer account ($99/year). Add these repository secrets
  and the workflow signs and notarizes: `APPLE_CERTIFICATE` (base64 .p12),
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` (an app-specific password), `APPLE_TEAM_ID`.
- **Windows:** needs a code-signing certificate. See
  [Tauri's Windows signing guide](https://tauri.app/distribute/sign/windows/).

## Several servers

Each server you open registers itself with the app, which keeps the list in `servers.json` in the app's config folder. Every server's rail then shows the others' workspaces and unread counts. The tokens stored there are *linked sessions*: they can only read the workspace list, DM list and unread counts, never messages. Add a server with the globe button in the rail. Remove one under Settings → Profile → Your other servers.
