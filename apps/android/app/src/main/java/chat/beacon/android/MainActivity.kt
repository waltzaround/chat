package chat.beacon.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import chat.beacon.android.data.AppState
import chat.beacon.android.data.HomeModel
import chat.beacon.android.ui.AddAccountFlow
import chat.beacon.android.ui.ChannelRoute
import chat.beacon.android.ui.ChannelScreen
import chat.beacon.android.ui.ChatTheme
import chat.beacon.android.ui.HomeScreen
import chat.beacon.android.ui.openInBrowser

class MainActivity : ComponentActivity() {
    private val state: AppState by viewModels()
    private val home: HomeModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(0), navigationBarStyle = SystemBarStyle.dark(0))
        super.onCreate(savedInstanceState)
        handleLink(intent)
        setContent {
            ChatTheme {
                val accounts by state.accounts.collectAsState()
                val link by state.pendingLink.collectAsState()
                val context = LocalContext.current
                var channel by remember { mutableStateOf<ChannelRoute?>(null) }

                // chat://invite/CODE opens that invite's page on your first server.
                LaunchedEffect(link, accounts.firstOrNull()) {
                    val server = accounts.firstOrNull()?.server ?: return@LaunchedEffect
                    link?.let {
                        state.pendingLink.value = null
                        openInBrowser(context, "$server/${it.removePrefix("chat://")}")
                    }
                }
                // A channel on a server you've just signed out of closes.
                LaunchedEffect(accounts) { if (channel != null && accounts.none { it.server == channel?.server }) channel = null }

                if (accounts.isEmpty()) {
                    AddAccountFlow(state, adding = false, onDone = {})
                } else {
                    BackHandler(enabled = channel != null) { channel = null }
                    AnimatedContent(
                        targetState = channel,
                        transitionSpec = {
                            if (targetState != null) slideInHorizontally { it } togetherWith slideOutHorizontally { -it / 4 }
                            else slideInHorizontally { -it / 4 } togetherWith slideOutHorizontally { it }
                        },
                        label = "screen",
                    ) { route ->
                        if (route == null) {
                            HomeScreen(state, home) { channel = it }
                        } else {
                            ChannelScreen(state, route) {
                                channel = null
                                home.refresh(state)
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    private fun handleLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "chat") state.pendingLink.value = data.toString()
    }
}
