# Chat for iOS

A native SwiftUI client (iOS 17+), laid out like Discord mobile: a server rail and channel list on Home, a You tab, and dark channels with replies, reactions and live updates.

It talks to any Chat server over the same API as the web app. It signs in with a bearer token (kept in the Keychain) and receives live updates over the workspace WebSocket. Signing up, resetting a password and profile settings open the server's own web pages in an in-app browser.

## Build and run

You need Xcode 16+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
cd apps/ios
xcodegen generate
open Chat.xcodeproj
```

Pick a simulator and press Run. To reach a local server, enter `http://localhost:8787` (or whatever port `npm run dev` uses); the app allows plain HTTP to local addresses only.

From the command line:

```bash
xcodebuild -project Chat.xcodeproj -scheme Chat -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build \
  CODE_SIGN_IDENTITY=- build
```

Keep the ad-hoc signing (`CODE_SIGN_IDENTITY=-`). An unsigned build can't write to the Keychain, so you'd be signed out on every launch.

## Layout

- `Chat/Networking`: the API client, JSON models, Keychain and realtime socket.
- `Chat/App`: the app model (server and session) and the per-channel store.
- `Chat/Design`: Discord-style colours and shared controls.
- `Chat/Views`: the screens.

## Not yet

Push notifications (APNs), threads, uploads, editing and deleting messages, and voice. Use the web app for these for now.
