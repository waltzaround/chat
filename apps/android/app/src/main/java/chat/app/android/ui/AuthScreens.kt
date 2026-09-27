package chat.app.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chat.app.android.data.AppState
import kotlinx.coroutines.launch

/**
 * Server address, then sign in: the first screens on first launch, and "Add a server"
 * afterwards.
 */
@Composable
fun AddAccountFlow(state: AppState, adding: Boolean, onDone: () -> Unit, onCancel: () -> Unit = {}) {
    var server by remember { mutableStateOf<String?>(null) }
    var registering by remember { mutableStateOf<chat.app.android.net.InstanceInfo?>(null) }
    val chosen = server
    val signUp = registering
    when {
        chosen == null -> ServerPicker(state, adding, onChosen = { server = it }, onCancel = onCancel)
        signUp != null -> RegisterScreen(state, chosen, signUp, onBack = { registering = null }, onDone = onDone)
        else -> SignIn(state, chosen, onBack = { server = null }, onRegister = { registering = it }, onDone = onDone)
    }
}

@Composable
private fun AuthScaffold(onBack: (() -> Unit)?, backLabel: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(Palette.chat).systemBarsPadding().imePadding()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).widthIn(max = 480.dp).align(Alignment.TopCenter),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(if (onBack != null) 56.dp else 48.dp))
            content()
            Spacer(Modifier.height(24.dp))
        }
        if (onBack != null) {
            IconButton(onClick = onBack, modifier = Modifier.padding(4.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = backLabel, tint = Palette.heading)
            }
        }
    }
}

@Composable
private fun ServerPicker(state: AppState, adding: Boolean, onChosen: (String) -> Unit, onCancel: () -> Unit) {
    var address by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun connect() {
        if (address.isBlank() || checking) return
        error = null
        checking = true
        scope.launch {
            try {
                val server = state.checkServer(address)
                if (state.account(server) != null) error = "You're already signed in to ${server.substringAfter("://")}." else onChosen(server)
            } catch (e: Exception) {
                error = e.message ?: "Couldn't reach that server. Check the address and your connection."
            }
            checking = false
        }
    }

    AuthScaffold(onBack = if (adding) onCancel else null, backLabel = "Cancel") {
        Box(Modifier.size(88.dp).background(Palette.accent, RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Forum, contentDescription = null, tint = Palette.onAccent, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(28.dp))
        Text(if (adding) "Add a server" else "Welcome to Chat", color = Palette.heading, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            if (adding) "Belong to another Chat server? Its workspaces join your server list." else "Chat runs on servers that communities host themselves. Enter the address of yours to get started.",
            color = Palette.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        FieldLabel("Server address")
        FilledField(address, { address = it }, placeholder = "chat.example.com", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, onIme = ::connect, autoFocus = true)
        Spacer(Modifier.height(8.dp))
        Text(
            error ?: "The address you use for Chat in your browser. Ask whoever invited you if you're not sure.",
            color = if (error == null) Palette.muted else Palette.danger,
            fontSize = 13.sp,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(24.dp))
        PrimaryButton(if (checking) null else "Continue", enabled = address.isNotBlank() && !checking, onClick = ::connect)
    }
}

@Composable
private fun SignIn(state: AppState, server: String, onBack: () -> Unit, onRegister: (chat.app.android.net.InstanceInfo) -> Unit, onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val passwordFocus = remember { FocusRequester() }

    fun signIn() {
        if (email.isBlank() || password.isEmpty() || busy) return
        error = null
        busy = true
        scope.launch {
            try {
                state.signIn(server, email.trim(), password)
                onDone()
            } catch (e: Exception) {
                error = e.message ?: "Sign in failed."
            }
            busy = false
        }
    }

    AuthScaffold(onBack = onBack, backLabel = "Use a different server") {
        var instance by remember { mutableStateOf<chat.app.android.net.InstanceInfo?>(null) }
        androidx.compose.runtime.LaunchedEffect(server) { instance = runCatching { chat.app.android.net.ApiClient.instance(server) }.getOrNull() }
        val branding = instance?.server
        ServerCard(server, branding)
        Spacer(Modifier.height(24.dp))
        Text("Log in to continue", color = Palette.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        FieldLabel("Email")
        FilledField(email, { email = it }, keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, onIme = { passwordFocus.requestFocus() }, autoFocus = true)
        Spacer(Modifier.height(20.dp))
        FieldLabel("Password")
        FilledField(password, { password = it }, keyboardType = KeyboardType.Password, imeAction = ImeAction.Go, onIme = ::signIn, password = true, focusRequester = passwordFocus)
        TextButton(onClick = { openInBrowser(context, "$server/forgot-password") }, modifier = Modifier.align(Alignment.Start)) {
            Text("Forgot your password?", color = Palette.link, fontWeight = FontWeight.Medium)
        }
        error?.let {
            Text(it, color = Palette.danger, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp))
        }
        Spacer(Modifier.height(8.dp))
        PrimaryButton(if (busy) null else "Log In", enabled = email.isNotBlank() && password.isNotEmpty() && !busy, onClick = ::signIn)
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Need an account?", color = Palette.muted, fontSize = 14.sp)
            TextButton(onClick = {
                // Open sign-up happens here; invite-only servers need the invite link.
                val info = instance
                if (info?.signUp?.open == true) onRegister(info) else openInBrowser(context, "$server/register")
            }) { Text("Register", color = Palette.link, fontWeight = FontWeight.Medium) }
        }
    }
}

/**
 * Which server you're signing in to: the owner's icon, name and description, and its
 * address. Servers without a name show their address.
 */
@Composable
private fun ServerCard(server: String, branding: chat.app.android.net.ServerBranding?) {
    val host = server.substringAfter("://")
    val name = branding?.name ?: host
    Row(
        Modifier.fillMaxWidth().background(Palette.panel, RoundedCornerShape(16.dp)).border(1.dp, Palette.raised, RoundedCornerShape(16.dp)).padding(16.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        val placeholder = @Composable {
            Box(Modifier.size(56.dp).background(Palette.accent, RoundedCornerShape(17.dp)), contentAlignment = Alignment.Center) {
                if (branding?.name != null) Text(initials(branding.name), color = Palette.onAccent, fontWeight = FontWeight.SemiBold, fontSize = fixedSp(20f))
                else Icon(Icons.Filled.Forum, contentDescription = null, tint = Palette.onAccent)
            }
        }
        RemoteImage(branding?.iconUrl, chat.app.android.net.ApiClient(server, null), Modifier.size(56.dp).clip(RoundedCornerShape(17.dp))) { placeholder() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(name, color = Palette.heading, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            branding?.description?.let { Text(it, color = Palette.text, style = MaterialTheme.typography.bodyMedium) }
            if (branding?.name != null) Text(host, color = Palette.faint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Creating an account in the app, on servers where the owner allows open sign-up. */
@Composable
private fun RegisterScreen(state: AppState, server: String, info: chat.app.android.net.InstanceInfo, onBack: () -> Unit, onDone: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var usernameEdited by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var checkEmail by remember { mutableStateOf(false) }
    var challenging by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val ready = username.isNotBlank() && "@" in email && password.length >= 8
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val next = { focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Down); Unit }

    fun submit(token: String?) {
        error = null
        busy = true
        scope.launch {
            try {
                val display = name.trim().ifEmpty { username }
                if (state.register(server, display, username.trim(), email.trim(), password, token)) onDone() else checkEmail = true
            } catch (e: Exception) {
                error = e.message ?: "Couldn't create the account."
            }
            busy = false
        }
    }

    AuthScaffold(onBack = onBack, backLabel = "Back to log in") {
        ServerCard(server, info.server)
        Spacer(Modifier.height(24.dp))
        if (checkEmail) {
            Text("Check your email", color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("We sent a link to $email. Open it to confirm your address, then log in.", color = Palette.muted, modifier = Modifier.fillMaxWidth())
            return@AuthScaffold
        }
        Text("Create your account", color = Palette.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        FieldLabel("Your name")
        FilledField(name, { name = it; if (!usernameEdited) username = usernameFrom(it) }, autoFocus = true, imeAction = ImeAction.Next, onIme = next)
        Spacer(Modifier.height(20.dp))
        FieldLabel("Username")
        FilledField(username, { username = it.lowercase(); usernameEdited = true }, imeAction = ImeAction.Next, onIme = next)
        Text("People mention you as @${username.ifEmpty { "username" }}. Lowercase letters, numbers, dots and underscores.", color = Palette.faint, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
        Spacer(Modifier.height(20.dp))
        FieldLabel("Email")
        FilledField(email, { email = it }, keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, onIme = next)
        Spacer(Modifier.height(20.dp))
        FieldLabel("Password")
        FilledField(password, { password = it }, keyboardType = KeyboardType.Password, password = true, imeAction = ImeAction.Done)
        Text("At least 8 characters.", color = Palette.faint, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
        error?.let { Text(it, color = Palette.danger, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) }
        Spacer(Modifier.height(24.dp))
        PrimaryButton(if (busy) null else "Create Account", enabled = ready && !busy) {
            if (info.signUp?.challenge == true) challenging = true else submit(null)
        }
        Spacer(Modifier.height(12.dp))
        val agreement = androidx.compose.ui.text.buildAnnotatedString {
            append("By creating an account you agree to the ")
            withLink(androidx.compose.ui.text.LinkAnnotation.Clickable("terms") { openInBrowser(context, "$server/terms") }) {
                withStyle(androidx.compose.ui.text.SpanStyle(color = Palette.link)) { append("terms") }
            }
            append(" and ")
            withLink(androidx.compose.ui.text.LinkAnnotation.Clickable("privacy") { openInBrowser(context, "$server/privacy") }) {
                withStyle(androidx.compose.ui.text.SpanStyle(color = Palette.link)) { append("privacy policy") }
            }
            append(".")
        }
        Text(agreement, color = Palette.muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth())
    }

    if (challenging) {
        androidx.compose.ui.window.Dialog(onDismissRequest = { challenging = false }) {
            ChallengeWebView("$server/app-challenge") { token ->
                challenging = false
                submit(token)
            }
        }
    }
}

/** "Walter Lim" → "walter.lim", like the web sign-up. */
private fun usernameFrom(name: String) = name.lowercase().replace(' ', '.').filter { it in 'a'..'z' || it.isDigit() || it == '.' || it == '_' }.take(32)

/** The server's /app-challenge page; solving it navigates to chat://challenge?token=… */
@android.annotation.SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ChallengeWebView(url: String, done: (String) -> Unit) {
    androidx.compose.ui.viewinterop.AndroidView(
        modifier = Modifier.fillMaxWidth().height(320.dp).clip(RoundedCornerShape(16.dp)),
        factory = { context ->
            android.webkit.WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                webViewClient = object : android.webkit.WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: android.webkit.WebView, request: android.webkit.WebResourceRequest): Boolean {
                        val uri = request.url
                        if (uri.scheme == "chat" && uri.host == "challenge") {
                            uri.getQueryParameter("token")?.let(done)
                            return true
                        }
                        return false
                    }
                }
                loadUrl(url)
            }
        },
    )
}

/** Uppercase label above a filled field, like Discord's forms. */
@Composable
fun FieldLabel(text: String) {
    Text(text.uppercase(), color = Palette.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
}

@Composable
fun FilledField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Done,
    onIme: () -> Unit = {},
    password: Boolean = false,
    autoFocus: Boolean = false,
    focusRequester: FocusRequester = remember { FocusRequester() },
) {
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(color = Palette.heading, fontSize = 17.sp, fontFamily = PublicSans),
        cursorBrush = SolidColor(Palette.accent),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onAny = { onIme() }),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
        decorationBox = { inner ->
            Box(Modifier.fillMaxWidth().heightIn(min = 50.dp).background(Palette.field, RoundedCornerShape(8.dp)).padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = Palette.faint, fontSize = 17.sp)
                inner()
            }
        },
    )
    if (autoFocus) androidx.compose.runtime.LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }
}

/** Full-width accent button; a null label shows a spinner. */
@Composable
fun PrimaryButton(label: String?, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, colors = primaryButtonColors, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
        if (label == null) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp)) else Text(label, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}
