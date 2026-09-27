package chat.app.android.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import chat.app.android.net.ApiException
import chat.app.android.net.DirectMessage
import chat.app.android.net.WorkspaceDetail
import chat.app.android.net.WorkspaceSummary
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the panel beside the rail shows. */
sealed interface Selection {
    data object Dms : Selection
    data class Workspace(val server: String, val id: String) : Selection

    val key: String get() = if (this is Workspace) "$server|$id" else "dms"

    companion object {
        fun from(key: String?): Selection {
            val parts = key?.split("|", limit = 2) ?: return Dms
            return if (parts.size == 2) Workspace(parts[0], parts[1]) else Dms
        }
    }
}

/** A DM, with the server it lives on. */
data class AccountDm(val server: String, val dm: DirectMessage) {
    val key get() = "$server|${dm.workspaceId}"
}

data class HomeUi(
    val workspaces: Map<String, List<WorkspaceSummary>> = emptyMap(),
    val dms: Map<String, List<DirectMessage>> = emptyMap(),
    val details: Map<String, WorkspaceDetail> = emptyMap(),
    val errors: Map<String, String> = emptyMap(),
    val lastChannel: Map<String, String> = emptyMap(),
    val loaded: Boolean = false,
    val selection: Selection = Selection.Dms,
)

/** The home screen's data: every account's workspaces and DMs, and open workspaces' channels. */
class HomeModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("chat.home", 0)
    private val _ui = MutableStateFlow(HomeUi(selection = Selection.from(prefs.getString("selection", null))))
    val ui: StateFlow<HomeUi> = _ui.asStateFlow()

    fun select(selection: Selection, state: AppState) {
        _ui.update { it.copy(selection = selection) }
        prefs.edit().putString("selection", selection.key).apply()
        if (selection is Selection.Workspace) loadDetail(selection, state)
    }

    fun rememberChannel(workspace: Selection.Workspace, channelId: String) {
        _ui.update { it.copy(lastChannel = it.lastChannel + (workspace.key to channelId)) }
    }

    fun refresh(state: AppState) {
        viewModelScope.launch {
            coroutineScope {
                state.accounts.value.map { account ->
                    async {
                        try {
                            val w = async { account.api.get<List<WorkspaceSummary>>("/api/me/workspaces") }
                            val d = async { account.api.get<List<DirectMessage>>("/api/dms") }
                            val (workspaces, dms) = w.await() to d.await()
                            _ui.update { it.copy(workspaces = it.workspaces + (account.server to workspaces), dms = it.dms + (account.server to dms), errors = it.errors - account.server) }
                        } catch (e: ApiException.SignedOut) {
                            state.handleSignedOut(account.server)
                        } catch (e: Exception) {
                            _ui.update { it.copy(errors = it.errors + (account.server to (e.message ?: "Can't reach ${account.host}"))) }
                        }
                    }
                }.forEach { it.await() }
            }
            // Forget servers you've since signed out of.
            val servers = state.accounts.value.map { it.server }.toSet()
            _ui.update { it.copy(workspaces = it.workspaces.filterKeys(servers::contains), dms = it.dms.filterKeys(servers::contains), loaded = true) }
            val selection = _ui.value.selection
            if (selection is Selection.Workspace) {
                val exists = _ui.value.workspaces[selection.server]?.any { it.id == selection.id } == true
                if (!exists) select(Selection.Dms, state) else loadDetail(selection, state)
            }
        }
    }

    fun loadDetail(selection: Selection.Workspace, state: AppState) {
        val api = state.api(selection.server) ?: return
        viewModelScope.launch {
            try {
                val detail = api.get<WorkspaceDetail>("/api/workspaces/${selection.id}")
                _ui.update { it.copy(details = it.details + (selection.key to detail)) }
            } catch (e: ApiException.SignedOut) {
                state.handleSignedOut(selection.server)
            } catch (e: Exception) {
                _ui.update { it.copy(errors = it.errors + (selection.server to (e.message ?: "Couldn't load"))) }
            }
        }
    }
}
