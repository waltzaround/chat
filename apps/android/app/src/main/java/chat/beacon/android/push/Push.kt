package chat.beacon.android.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import chat.beacon.android.BuildConfig
import chat.beacon.android.MainActivity
import chat.beacon.android.R
import chat.beacon.android.net.ApiClient
import chat.beacon.android.net.json
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Phone notifications. The app gets an FCM token, trades it with the push relay
 * (BuildConfig.PUSH_RELAY, set by whoever publishes the app) for a push key, and gives
 * that key to each server it's signed in to. Servers wake the phone through the relay
 * with a data message naming the server; this asks that server what's new and shows it.
 * No message text passes through the relay or Google.
 */
object Push {
    const val CHANNEL = "messages"
    private const val PREFS = "chat.push"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val enabled get() = BuildConfig.PUSH_RELAY.isNotEmpty()

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(CHANNEL, "Messages and mentions", NotificationManager.IMPORTANCE_HIGH)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** Registers with every signed-in server that doesn't know this phone yet. */
    fun sync(context: Context, accounts: List<Pair<String, String>>) {
        if (!enabled || FirebaseApp.getApps(context).isEmpty()) return
        scope.launch {
            val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return@launch
            val key = pushKey(context, token) ?: return@launch
            val known = prefs(context).getStringSet("servers", emptySet())!!.toMutableSet()
            val servers = accounts.map { it.first }.toSet()
            known.retainAll(servers)
            for ((server, sessionToken) in accounts) {
                if (server in known) continue
                val body = buildJsonObject {
                    put("platform", "android")
                    put("relay", BuildConfig.PUSH_RELAY)
                    put("pushKey", key)
                }
                runCatching { ApiClient(server, sessionToken).raw("/api/push/devices", "POST", body.toString()) }.onSuccess { known += server }
            }
            prefs(context).edit().putStringSet("servers", known).apply()
        }
    }

    /** A new FCM token: every server needs the new key. */
    fun tokenChanged(context: Context) {
        prefs(context).edit().remove("key").remove("servers").apply()
    }

    private suspend fun pushKey(context: Context, token: String): String? {
        val p = prefs(context)
        if (p.getString("token", null) == token) p.getString("key", null)?.let { return it }
        val request = Request.Builder()
            .url("${BuildConfig.PUSH_RELAY}/v1/register")
            .post(buildJsonObject { put("platform", "android"); put("token", token) }.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val key = runCatching {
            ApiClient.http.newCall(request).execute().use { res ->
                if (!res.isSuccessful) null else json.decodeFromString<Registered>(res.body!!.string()).pushKey
            }
        }.getOrNull() ?: return null
        p.edit().putString("token", token).putString("key", key).remove("servers").apply()
        return key
    }

    @Serializable
    private data class Registered(val pushKey: String)
}

@Serializable
private data class PendingPush(
    val title: String,
    val body: String,
    val kind: String? = null,
    val workspaceId: String? = null,
    val channelId: String,
    val channelName: String? = null,
)

/** Reads the app's saved session for one server. */
private object SessionReader {
    fun token(context: Context, server: String): String? = chat.beacon.android.data.AppState.tokens(context)[server]
}

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Push.tokenChanged(this)
    }

    /** "Wake up, ask <server>": fetch what's new with that account's token and show it. */
    override fun onMessageReceived(message: RemoteMessage) {
        val server = message.data["server"] ?: return
        val token = SessionReader.token(this, server) ?: return
        val items = runCatching {
            runBlocking { json.decodeFromString<List<PendingPush>>(ApiClient(server, token).raw("/api/push/pending")) }
        }.getOrNull() ?: return
        val latest = items.lastOrNull() ?: return
        show(server, latest)
    }

    private fun show(server: String, item: PendingPush) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        Push.createChannel(this)
        val open = Intent(this, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .putExtra("server", server)
            .putExtra("workspaceId", item.workspaceId)
            .putExtra("channelId", item.channelId)
            .putExtra("title", if (item.kind == "dm") item.title else item.channelName ?: "")
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val id = "$server|${item.channelId}".hashCode()
        val notification = NotificationCompat.Builder(this, Push.CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(item.title)
            .setContentText(item.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(item.body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        // One notification per conversation: a newer one replaces it.
        NotificationManagerCompat.from(this).notify(id, notification)
    }
}
