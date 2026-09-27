package chat.beacon.android.ui

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chat.beacon.android.net.ApiClient
import chat.beacon.android.net.UserSummary
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest

/** Discord-style dark palette. The app is always dark, like Discord mobile. */
object Palette {
    val accent = Color(0xFF5865F2)
    val rail = Color(0xFF1E1F22)
    val panel = Color(0xFF2B2D31)
    val chat = Color(0xFF313338)
    val field = Color(0xFF1E1F22)
    val raised = Color(0xFF383A40)
    val hover = Color(0xFF404249)
    val text = Color(0xFFDBDEE1)
    val heading = Color(0xFFF2F3F5)
    val muted = Color(0xFF949BA4)
    val faint = Color(0xFF80848E)
    val danger = Color(0xFFF23F43)
    val link = Color(0xFF00A8FC)
    val green = Color(0xFF23A55A)
    val mention = Color(0xFFF0B232)
    val mentionChip = Color(0xFFC9CDFB)
}

@Composable
fun ChatTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent,
            onPrimary = Color.White,
            background = Palette.chat,
            surface = Palette.panel,
            onSurface = Palette.text,
            onBackground = Palette.text,
            error = Palette.danger,
        ),
        content = content,
    )
}

val primaryButtonColors @Composable get() = ButtonDefaults.buttonColors(containerColor = Palette.accent, contentColor = Color.White, disabledContainerColor = Palette.accent.copy(alpha = 0.5f), disabledContentColor = Color.White.copy(alpha = 0.6f))

/** An image from a Chat server: its own files need the bearer token. */
@Composable
fun RemoteImage(path: String?, api: ApiClient?, modifier: Modifier = Modifier, placeholder: @Composable () -> Unit) {
    if (path == null || api == null) {
        Box(modifier) { placeholder() }
        return
    }
    val url = if (path.startsWith("http")) path else api.url(path)
    val request = ImageRequest.Builder(LocalContext.current)
        .data(url)
        .apply { api.authHeaderFor(url)?.let { addHeader("Authorization", it) } }
        .crossfade(true)
        .build()
    SubcomposeAsyncImage(
        model = request,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier,
        loading = { placeholder() },
        error = { placeholder() },
    )
}

private val avatarPalette = listOf(0xFF5865F2, 0xFF757E8A, 0xFF3BA55C, 0xFFFAA61A, 0xFFED4245, 0xFFEB459F).map { Color(it) }

/** Discord-style default avatar colours, picked from the user's id so each person keeps theirs. */
fun avatarColour(id: String) = avatarPalette[id.sumOf { it.code } % avatarPalette.size]

fun initials(name: String, max: Int = 2) = name.split(" ").filter { it.isNotBlank() }.take(max).joinToString("") { it.first().uppercase() }

@Composable
fun Avatar(user: UserSummary, size: Dp, api: ApiClient?, modifier: Modifier = Modifier) {
    RemoteImage(user.avatarUrl, api, modifier.size(size).clip(CircleShape)) {
        Box(Modifier.size(size).background(avatarColour(user.id), CircleShape), contentAlignment = Alignment.Center) {
            Text(initials(user.displayName), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.38f).sp)
        }
    }
}

/** Red pill with a count, as on Discord's server icons and DMs. */
@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier, ring: Color = Palette.rail) {
    if (count <= 0) return
    Box(
        modifier
            .background(ring, RoundedCornerShape(50))
            .padding(3.dp)
            .background(Palette.danger, RoundedCornerShape(50))
            .defaultMinSize(minWidth = 18.dp, minHeight = 18.dp)
            .padding(horizontal = 5.dp)
            .semantics { contentDescription = "$count unread" },
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else "$count", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun Divider(modifier: Modifier = Modifier, color: Color = Palette.raised.copy(alpha = 0.6f)) {
    Box(modifier.fillMaxWidth().height(1.dp).background(color))
}

fun parseHex(hex: String?): Color? {
    val digits = hex?.removePrefix("#") ?: return null
    if (digits.length != 6) return null
    return digits.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
}

/** The server's own pages (sign-up, password reset, settings) in a Custom Tab. */
fun openInBrowser(context: Context, url: String) {
    CustomTabsIntent.Builder()
        .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(Palette.panel.toArgb()).build())
        .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
        .build()
        .launchUrl(context, Uri.parse(url))
}

/**
 * Inline Markdown the way the web app shows it: **bold**, *italic*, `code`, ~~strike~~,
 * links, and @mentions as blurple chips.
 */
fun renderMarkdown(text: String): AnnotatedString = buildAnnotatedString {
    val pattern = Regex("""\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|~~(.+?)~~|`([^`]+)`|(https?://[^\s<]+[^\s<.,:;"')\]])|(@[A-Za-z0-9_.]+)""")
    var index = 0
    for (match in pattern.findAll(text)) {
        append(text.substring(index, match.range.first))
        val g = match.groupValues
        when {
            g[1].isNotEmpty() || g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(g[1].ifEmpty { g[2] }) }
            g[3].isNotEmpty() || g[4].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[3].ifEmpty { g[4] }) }
            g[5].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(g[5]) }
            g[6].isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Palette.rail, fontSize = 14.sp)) { append(g[6]) }
            g[7].isNotEmpty() -> withLink(LinkAnnotation.Url(g[7], TextLinkStyles(SpanStyle(color = Palette.link)))) { append(g[7]) }
            g[8].isNotEmpty() -> withStyle(SpanStyle(color = Palette.mentionChip, background = Palette.accent.copy(alpha = 0.3f), fontWeight = FontWeight.Medium)) { append(g[8]) }
        }
        index = match.range.last + 1
    }
    append(text.substring(index))
}

private inline fun <R : Any> AnnotatedString.Builder.withStyle(style: SpanStyle, block: AnnotatedString.Builder.() -> R): R {
    val i = pushStyle(style)
    return try {
        block()
    } finally {
        pop(i)
    }
}
