package chat.beacon.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

sealed class ApiException(message: String) : Exception(message) {
    class Server(val status: Int, message: String) : ApiException(message)
    class SignedOut : ApiException("You've been signed out.")
    class NotAChatServer : ApiException("That address isn't a Chat server.")
}

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/** Talks to one Chat server with a bearer token (see the server's bearer plugin). */
class ApiClient(val server: String, val token: String?) {

    companion object {
        /** Native apps authenticate with the token only: no cookie jar. */
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()

        private val JSON_TYPE = "application/json".toMediaType()

        /** Turns "chat.example.com" or "https://chat.example.com/w/1" into the server's origin. */
        fun normalize(input: String): String? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
            val url = withScheme.toHttpUrlOrNull() ?: return null
            val port = if (url.port == okhttp3.HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
            return "${url.scheme}://${url.host}$port"
        }

        /** Checks the address answers as a Chat server before anyone signs in. */
        suspend fun instance(server: String): InstanceInfo = withContext(Dispatchers.IO) {
            val info = runCatching {
                http.newCall(Request.Builder().url("$server/api/instance").build()).execute().use { res ->
                    if (!res.isSuccessful) null else json.decodeFromString<InstanceInfo>(res.body!!.string())
                }
            }.getOrNull()
            if (info?.software != "beacon-chat") throw ApiException.NotAChatServer()
            info
        }

        private fun errorMessage(body: String, fallback: String): String = runCatching {
            val obj = json.parseToJsonElement(body).jsonObject
            val error = obj["error"]
            (if (error is JsonObject) error["message"] else obj["message"])?.jsonPrimitive?.content
        }.getOrNull() ?: fallback
    }

    fun url(path: String): String = server + (if (path.startsWith("/")) path else "/$path")

    private fun request(path: String, method: String, body: String?): Request {
        val builder = Request.Builder().url(url(path))
        token?.let { builder.header("Authorization", "Bearer $it") }
        builder.method(method, body?.toRequestBody(JSON_TYPE) ?: if (method == "GET" || method == "DELETE") null else "{}".toRequestBody(JSON_TYPE))
        return builder.build()
    }

    suspend fun raw(path: String, method: String = "GET", body: String? = null): String = withContext(Dispatchers.IO) {
        http.newCall(request(path, method, body)).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (res.code == 401) throw ApiException.SignedOut()
            if (!res.isSuccessful) throw ApiException.Server(res.code, errorMessage(text, "Something went wrong (${res.code})."))
            text
        }
    }

    suspend inline fun <reified T> get(path: String): T = json.decodeFromString(raw(path))

    suspend inline fun <reified T> send(path: String, method: String, body: JsonElement? = null): T =
        json.decodeFromString(raw(path, method, body?.toString()))

    /** Signs in and returns the session token from the set-auth-token header. */
    suspend fun signIn(email: String, password: String): String = withContext(Dispatchers.IO) {
        val body = """{"email":${json.encodeToString(kotlinx.serialization.serializer<String>(), email)},"password":${json.encodeToString(kotlinx.serialization.serializer<String>(), password)}}"""
        http.newCall(request("/api/auth/sign-in/email", "POST", body)).execute().use { res ->
            val text = res.body?.string().orEmpty()
            val token = res.header("set-auth-token")
            if (!res.isSuccessful || token == null) throw ApiException.Server(res.code, errorMessage(text, "Sign in failed."))
            token
        }
    }

    suspend fun signOut() {
        runCatching { raw("/api/auth/sign-out", "POST", "{}") }
    }

    /** Server paths get the token; anything else (e.g. another host) doesn't. */
    fun authHeaderFor(url: String): String? {
        val target = url.toHttpUrlOrNull() ?: return null
        val own = server.toHttpUrlOrNull() ?: return null
        return if (target.host == own.host && target.port == own.port && token != null) "Bearer $token" else null
    }
}
