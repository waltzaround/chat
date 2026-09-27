# Chat for Android

A native Kotlin and Jetpack Compose client (Android 8.0+), laid out like Discord mobile. It matches the iOS app:

- a rail of workspaces beside the channel list or your messages;
- a floating profile pill;
- dark channels with replies, reactions, Markdown and live updates.

You can sign in to several Chat servers on different domains at once. All their workspaces share the rail, and all their DMs share the Messages list.

It uses the same API as the web app. It signs in with a bearer token and keeps tokens in EncryptedSharedPreferences, backed by the Android Keystore. Live updates come over the workspace WebSocket. Signing up, resetting a password and profile settings open the server's own pages in a Custom Tab.

## Build and run

You need Android Studio, or a JDK 17+ and the Android SDK (platform 35).

```bash
cd apps/android
./gradlew :app:installDebug
```

Or open `apps/android` in Android Studio and press Run.

### A local server from the emulator

Forward the port so the emulator's `localhost` reaches your Mac or PC:

```bash
adb reverse tcp:8787 tcp:8787
```

Then enter `http://localhost:8787` in the app. Plain HTTP is allowed only for `localhost`, `127.0.0.1` and `10.0.2.2`, the emulator's name for the host.

## Release builds

`./gradlew :app:assembleRelease` builds a minified, unsigned APK. To publish, sign it with your upload key, or add a `signingConfig` to `app/build.gradle.kts`.

## Push notifications

Notifications go through the push relay (`apps/push-relay`). Add your Firebase `google-services.json` to `app/` (it is git-ignored). Then build with `-PchatPushRelay=https://…`. Without both, push is off.

The relay only wakes the phone. The app then fetches the notification's text from your server, so Google never sees message content.

## Layout

- `net/`: API client, JSON models, realtime socket.
- `data/`: accounts (`AppState`), the home screen's data (`HomeModel`), and one open channel (`ChannelStore`).
- `ui/`: Compose screens and the Discord palette.

## Not yet

Voice and video, files other than images, and pinning. Use the web app or desktop app for these for now.
