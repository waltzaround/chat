package chat.beacon.android.data

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import chat.beacon.android.net.ApiClient
import chat.beacon.android.net.ApiException
import chat.beacon.android.net.CurrentUser
import chat.beacon.android.net.json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** One server you're signed in to. */
data class Account(val server: String, val token: String, val me: CurrentUser? = null) {
    val api get() = ApiClient(server, token)
    val host: String get() = server.substringAfter("://")
}

@Serializable
private data class SavedAccount(val server: String, val token: String)

/**
 * Every server you're signed in to, with tokens in EncryptedSharedPreferences
 * (keys held by the Android Keystore).
 */
class AppState(app: Application) : AndroidViewModel(app) {
    private val prefs: SharedPreferences = openPrefs(app)

    private val _accounts = MutableStateFlow(load())
    val accounts: StateFlow<List<Account>> = _accounts.asStateFlow()

    /** A chat:// link waiting to be opened, e.g. an invite. */
    val pendingLink = MutableStateFlow<String?>(null)

    fun account(server: String) = _accounts.value.firstOrNull { it.server == server }

    fun api(server: String) = account(server)?.api

    /** Checks an address answers as a Chat server; returns its origin. */
    suspend fun checkServer(input: String): String {
        val server = ApiClient.normalize(input) ?: throw ApiException.Server(0, "That doesn't look like a web address.")
        ApiClient.instance(server)
        return server
    }

    suspend fun signIn(server: String, email: String, password: String) {
        val token = ApiClient(server, null).signIn(email, password)
        val me = runCatching { ApiClient(server, token).get<CurrentUser>("/api/me") }.getOrNull()
        _accounts.update { list -> list.filterNot { it.server == server } + Account(server, token, me) }
        save()
    }

    fun signOut(server: String) {
        val account = account(server) ?: return
        viewModelScope.launch { account.api.signOut() }
        remove(server)
    }

    /** The server said 401: that session ended (signed out elsewhere, suspended, deleted). */
    fun handleSignedOut(server: String) = remove(server)

    fun loadProfiles() {
        for (account in _accounts.value.filter { it.me == null }) {
            viewModelScope.launch {
                try {
                    val me = account.api.get<CurrentUser>("/api/me")
                    _accounts.update { list -> list.map { if (it.server == account.server) it.copy(me = me) else it } }
                } catch (e: ApiException.SignedOut) {
                    handleSignedOut(account.server)
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun remove(server: String) {
        _accounts.update { list -> list.filterNot { it.server == server } }
        save()
    }

    private fun load(): List<Account> = runCatching {
        json.decodeFromString<List<SavedAccount>>(prefs.getString(KEY, "[]")!!).map { Account(it.server, it.token) }
    }.getOrDefault(emptyList())

    private fun save() {
        prefs.edit().putString(KEY, json.encodeToString(kotlinx.serialization.builtins.ListSerializer(SavedAccount.serializer()), _accounts.value.map { SavedAccount(it.server, it.token) })).apply()
    }

    private companion object {
        const val KEY = "accounts"

        fun openPrefs(context: Context): SharedPreferences {
            val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            return EncryptedSharedPreferences.create(
                context,
                "chat.sessions",
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}
