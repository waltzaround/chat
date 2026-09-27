# Chat push relay

Phones can only be woken through Apple (APNs) and Google (FCM), and only by whoever holds the app's keys. Self-hosted Chat servers don't have those keys, so they send through this relay. It is run once, by whoever publishes the iOS and Android apps.

**What the relay sees:** a push key (the phone's token, encrypted with the relay's key), the server's address, and a device id. It never sees message text, and neither do Apple or Google. The push only says "wake up and ask this server", and the app fetches the notification from the server itself.

## Endpoints

- `POST /v1/register {platform, token}` is called by the app. It returns `{pushKey}`.
- `POST /v1/notify {pushKey, server, device}` is called by Chat servers. It sends the push. It answers 410 when the phone is gone, and the server then forgets that phone.

## Deploy

```bash
cd apps/push-relay
npx wrangler deploy --config wrangler.jsonc
openssl rand -base64 32 | npx wrangler secret put RELAY_KEY --config wrangler.jsonc
```

Keep `RELAY_KEY` safe. Changing it invalidates every push key, so every phone has to register again.

### iOS (APNs)

1. In your Apple developer account, go to Certificates, IDs & Profiles → Keys and create a key with Apple Push Notifications.
2. Set these secrets: `APNS_KEY` (the .p8 file's contents), `APNS_KEY_ID` and `APNS_TEAM_ID`.
3. `APNS_TOPIC` is the app's bundle id. Set `APNS_SANDBOX` to `"1"` for development builds.
4. Build the app with `CHAT_PUSH_RELAY=https://your-relay.workers.dev`.

### Android (FCM)

1. Create a Firebase project and add the Android app (`chat.app.android`).
2. Put its `google-services.json` in `apps/android/app/`. The file is git-ignored.
3. Create a service account with the Firebase Messaging API enabled. Set its JSON as the `FCM_SERVICE_ACCOUNT` secret.
4. Build the app with `./gradlew assembleRelease -PchatPushRelay=https://your-relay.workers.dev`.

## Test

```bash
npx vitest run --root apps/push-relay
```
