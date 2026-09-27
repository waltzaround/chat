# Chat for iOS

A native SwiftUI client (iOS 17+), laid out like Discord mobile: a rail of workspaces beside the channel list or your messages, a floating profile pill, and dark channels with replies, reactions and live updates.

You can sign in to several Chat servers (different domains) at once. All their workspaces share the rail, and their DMs share the Messages list. Add one with **+** in the rail; log out of one from the profile pill.

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

## Push notifications

Notifications go through the push relay (`apps/push-relay`). Set its address with `CHAT_PUSH_RELAY=https://…` when building. With it empty, push is off.

The `NotificationService` extension fetches each notification's text from your server, so Apple never sees message content. Push needs a real device and a signing team with the Push Notifications capability and the `group.chat.beacon.ios` app group.

To test a notification in the Simulator, drag an `.apns` file onto it or run `xcrun simctl push`.

## Layout

- `Chat/Networking`: the API client, JSON models, Keychain and realtime socket.
- `Chat/App`: the app model (server and session) and the per-channel store.
- `Chat/Design`: Discord-style colours and shared controls.
- `Chat/Views`: the screens.

## Not yet

Threads, uploads, editing and deleting messages, and voice. Use the web app for these for now.
