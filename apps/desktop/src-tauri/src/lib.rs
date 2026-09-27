//! Chat desktop: a native window around your own Chat server.
//!
//! First launch shows a bundled "choose your server" page. Once a server checks out
//! (its /api/instance answers as a Chat server), the window loads that server and
//! the server — and only that server — is allowed to use a few native features:
//! notifications, the dock/taskbar unread badge, and "change server". Links anywhere
//! else open in the system browser.
//!
//! You can belong to several servers. Each server you open registers itself here with
//! a linked session (a token that can only read its workspace list and unread counts),
//! so every server's rail can show all the others. Switching servers navigates the
//! window; each server keeps its own sign-in cookies.

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::CapabilityBuilder,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    window::Color,
    AppHandle, Manager, RunEvent, Theme, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";

/// Sign-in pages that must stay inside the app so the session lands in its cookies.
const AUTH_HOSTS: &[&str] = &["accounts.google.com", "github.com"];

/// The chosen server's origin, shared with the navigation guard.
#[derive(Default, Clone)]
struct Server(Arc<Mutex<Option<Url>>>);

impl Server {
    fn get(&self) -> Option<Url> {
        self.0.lock().unwrap().clone()
    }
    fn set(&self, url: Option<Url>) {
        *self.0.lock().unwrap() = url;
    }
}

/// A server in the rail, with its linked-session token.
#[derive(Serialize, Deserialize, Clone)]
struct Account {
    origin: String,
    token: String,
}

#[derive(Default, Clone)]
struct Accounts(Arc<Mutex<Vec<Account>>>);

impl Accounts {
    fn list(&self) -> Vec<Account> {
        self.0.lock().unwrap().clone()
    }
    fn contains(&self, origin: &str) -> bool {
        self.0.lock().unwrap().iter().any(|a| a.origin == origin)
    }
}

fn accounts_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("servers.json"))
}

fn load_accounts(app: &AppHandle) -> Vec<Account> {
    accounts_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn store_accounts(app: &AppHandle, accounts: &[Account]) -> Result<(), String> {
    let path = accounts_path(app).ok_or("No config directory")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string(accounts).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    // Tokens only: readable by this user alone.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct Saved {
    url: String,
}

fn saved_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("server.json"))
}

fn load_saved(app: &AppHandle) -> Option<Url> {
    let text = fs::read_to_string(saved_path(app)?).ok()?;
    let saved: Saved = serde_json::from_str(&text).ok()?;
    Url::parse(&saved.url).ok()
}

fn save(app: &AppHandle, url: &Url) -> Result<(), String> {
    let path = saved_path(app).ok_or("No config directory")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(&Saved { url: url.as_str().to_string() }).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Where the bundled server picker lives, per platform.
fn shell_url() -> Url {
    #[cfg(windows)]
    let base = "http://tauri.localhost/index.html";
    #[cfg(not(windows))]
    let base = "tauri://localhost/index.html";
    Url::parse(base).expect("valid shell url")
}

fn origin_of(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Let the chosen server (and nothing else remote) call the app's native features.
fn allow_server(app: &AppHandle, server: &Url) {
    let capability = CapabilityBuilder::new(format!("server-{}", origin_of(server)))
        .remote(format!("{}/*", origin_of(server)))
        .window(MAIN)
        .permission("core:default")
        .permission("notification:default")
        .permission("opener:default")
        .permission("allow-set-unread")
        .permission("allow-change-server")
        .permission("allow-linked-servers")
        .permission("allow-save-linked-server")
        .permission("allow-remove-linked-server")
        .permission("allow-switch-server");
    // Adding the same server twice is harmless; ignore "already exists".
    let _ = app.add_capability(capability);
}

/// Accepts "chat.example.com", "https://chat.example.com/any/path", etc. and returns the
/// origin once it answers as a Chat server.
#[tauri::command]
async fn check_server(input: String) -> Result<String, String> {
    verify_server(&input).await
}

async fn verify_server(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter your server's address.".into());
    }
    let with_scheme = if trimmed.contains("://") { trimmed.to_string() } else { format!("https://{trimmed}") };
    let url = Url::parse(&with_scheme).map_err(|_| "That doesn't look like a web address.".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("Use an http or https address.".into());
    }
    let origin = origin_of(&url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{origin}/api/instance"))
        .send()
        .await
        .map_err(|_| format!("Couldn't reach {origin}. Check the address and your connection."))?;
    let info: serde_json::Value = response.json().await.map_err(|_| format!("{origin} isn't a Chat server."))?;
    if info.get("software").and_then(|v| v.as_str()) != Some("chat") {
        return Err(format!("{origin} isn't a Chat server."));
    }
    Ok(origin)
}

/// Remember the server and open it.
#[tauri::command]
fn connect(app: AppHandle, server: tauri::State<Server>, origin: String) -> Result<(), String> {
    let url = Url::parse(&origin).map_err(|e| e.to_string())?;
    save(&app, &url)?;
    server.set(Some(url.clone()));
    allow_server(&app, &url);
    main_window(&app)?.navigate(url).map_err(|e| e.to_string())
}

/// Every server in the rail, with the tokens their pages use to read each other's summaries.
#[tauri::command]
fn linked_servers(accounts: tauri::State<Accounts>) -> Vec<Account> {
    accounts.list()
}

/// A server registers itself (never another server: the origin must be the caller's).
#[tauri::command]
fn save_linked_server(app: AppHandle, webview: tauri::Webview, accounts: tauri::State<Accounts>, origin: String, token: String) -> Result<(), String> {
    let caller = webview.url().map_err(|e| e.to_string())?;
    if origin_of(&caller) != origin {
        return Err("A server can only add itself".into());
    }
    let mut list = accounts.0.lock().unwrap();
    list.retain(|a| a.origin != origin);
    list.push(Account { origin, token });
    store_accounts(&app, &list)?;
    if let Ok(url) = Url::parse(&list.last().unwrap().origin) {
        allow_server(&app, &url);
    }
    Ok(())
}

/// Takes a server out of the rail.
#[tauri::command]
fn remove_linked_server(app: AppHandle, accounts: tauri::State<Accounts>, origin: String) -> Result<(), String> {
    let mut list = accounts.0.lock().unwrap();
    list.retain(|a| a.origin != origin);
    store_accounts(&app, &list)
}

/// Opens a page on another server: one from the rail, or a new one being added (which
/// must answer as a Chat server first).
#[tauri::command]
async fn switch_server(app: AppHandle, origin: String, path: String) -> Result<(), String> {
    let known = app.state::<Accounts>().contains(&origin);
    let origin = if known { origin } else { verify_server(&origin).await? };
    let url = Url::parse(&origin).map_err(|e| e.to_string())?;
    let target = url.join(if path.starts_with('/') { &path } else { "/" }).map_err(|e| e.to_string())?;
    save(&app, &url)?;
    app.state::<Server>().set(Some(url.clone()));
    allow_server(&app, &url);
    main_window(&app)?.navigate(target).map_err(|e| e.to_string())
}

#[tauri::command]
fn current_server(server: tauri::State<Server>) -> Option<String> {
    server.get().map(|u| origin_of(&u))
}

/// Back to the server picker (the saved server stays until another is chosen).
#[tauri::command]
fn change_server(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.navigate(shell_url()).map_err(|e| e.to_string())
}

/// Unread mentions and DMs, on the dock icon (macOS) or taskbar (where supported).
#[tauri::command]
fn set_unread(app: AppHandle, count: u32) -> Result<(), String> {
    let badge = if count == 0 { None } else { Some(count as i64) };
    let _ = main_window(&app)?.set_badge_count(badge);
    Ok(())
}

/// The web app's rail colour for the system theme. It shows before a page paints and
/// between pages, so it matches the launcher and the sign-in screen.
fn window_background(theme: Theme) -> Color {
    match theme {
        Theme::Light => Color(231, 231, 234, 255),
        _ => Color(11, 11, 13, 255),
    }
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN).ok_or_else(|| "The main window is gone".to_string())
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// chat://invite/CODE opens that invite on the chosen server.
fn open_deep_link(app: &AppHandle, link: &Url) {
    show(app);
    let Some(server) = app.state::<Server>().get() else { return };
    let path = format!("{}{}", link.host_str().unwrap_or_default(), link.path());
    if let (Ok(target), Ok(window)) = (server.join(&path), main_window(app)) {
        let _ = window.navigate(target);
    }
}

fn is_allowed(url: &Url, server: Option<&Url>, accounts: &[Account]) -> bool {
    if url.scheme() == "tauri" || url.scheme() == "about" || url.host_str() == Some("tauri.localhost") {
        return true;
    }
    if let Some(server) = server {
        if origin_of(url) == origin_of(server) {
            return true;
        }
    }
    if accounts.iter().any(|a| a.origin == origin_of(url)) {
        return true;
    }
    url.host_str().is_some_and(|host| AUTH_HOSTS.contains(&host))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)] // only reassigned on Windows and Linux
    let mut builder = tauri::Builder::default();

    // On Windows and Linux a second launch (e.g. from a chat:// link) hands over to
    // the running app instead of opening another window.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show(app)));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Server::default())
        .manage(Accounts::default())
        .invoke_handler(tauri::generate_handler![
            check_server,
            connect,
            current_server,
            change_server,
            set_unread,
            linked_servers,
            save_linked_server,
            remove_linked_server,
            switch_server
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let saved = load_saved(&handle);
            let server = app.state::<Server>().inner().clone();
            server.set(saved.clone());
            if let Some(url) = &saved {
                allow_server(&handle, url);
            }
            let accounts = app.state::<Accounts>().inner().clone();
            *accounts.0.lock().unwrap() = load_accounts(&handle);
            for account in accounts.list() {
                if let Ok(url) = Url::parse(&account.origin) {
                    allow_server(&handle, &url);
                }
            }

            let start = match &saved {
                Some(url) => WebviewUrl::External(url.clone()),
                None => WebviewUrl::App("index.html".into()),
            };
            let guard_server = server.clone();
            let guard_accounts = accounts.clone();
            let guard_app = handle.clone();
            let window = WebviewWindowBuilder::new(app, MAIN, start)
                .title("Chat")
                .inner_size(1200.0, 800.0)
                .min_inner_size(420.0, 520.0)
                .on_navigation(move |url| {
                    let accounts = guard_accounts.list();
                    if is_allowed(url, guard_server.get().as_ref(), &accounts) {
                        // Following a link to another of your servers makes it the current one.
                        if accounts.iter().any(|a| a.origin == origin_of(url)) {
                            if let Ok(origin) = Url::parse(&origin_of(url)) {
                                guard_server.set(Some(origin));
                            }
                        }
                        return true;
                    }
                    let _ = guard_app.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;
            if let Ok(theme) = window.theme() {
                let _ = window.set_background_color(Some(window_background(theme)));
            }

            // Tray: reopen the window, switch servers, or quit for real.
            let open = MenuItem::with_id(app, "open", "Open Chat", true, None::<&str>)?;
            let switch = MenuItem::with_id(app, "switch", "Change server…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &switch, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Chat")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "switch" => {
                        show(app);
                        let _ = change_server(app.clone());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // chat:// links, whether they launched the app or arrived while it runs.
            let links = handle.clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().first() {
                    open_deep_link(&links, url);
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(url) = urls.first() {
                    open_deep_link(&handle, url);
                }
            }
            Ok(())
        })
        // Closing the window hides it, so notifications keep coming; Quit from the tray
        // (or Cmd+Q) exits.
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::ThemeChanged(theme) => {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    let _ = webview.set_background_color(Some(window_background(*theme)));
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            // macOS: clicking the dock icon brings the hidden window back.
            if let RunEvent::Reopen { .. } = event {
                show(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn keeps_the_server_and_sign_in_pages_in_the_app() {
        let server = url("https://chat.example.com");
        let none: Vec<Account> = vec![];
        let allowed = |u: &str| is_allowed(&url(u), Some(&server), &none);
        assert!(allowed("https://chat.example.com/w/1/c/2"));
        assert!(allowed("tauri://localhost/index.html"));
        assert!(allowed("http://tauri.localhost/index.html"));
        assert!(allowed("https://accounts.google.com/o/oauth2/auth"));
        // Anything else opens in the browser, including look-alikes and other ports.
        assert!(!allowed("https://example.com"));
        assert!(!allowed("https://chat.example.com.evil.net"));
        assert!(!allowed("https://chat.example.com:8443"));
        assert!(!is_allowed(&url("https://chat.example.com"), None, &none));
    }

    #[test]
    fn keeps_your_other_servers_in_the_app() {
        let server = url("https://chat.example.com");
        let accounts = vec![Account { origin: "https://chat.other.org".into(), token: "t".into() }];
        assert!(is_allowed(&url("https://chat.other.org/w/9"), Some(&server), &accounts));
        assert!(!is_allowed(&url("https://other.org"), Some(&server), &accounts));
    }

    #[test]
    fn checks_that_an_address_is_a_chat_server() {
        let run = |input: &str| tauri::async_runtime::block_on(check_server(input.to_string()));
        assert_eq!(run("  ").unwrap_err(), "Enter your server's address.");
        assert!(run("ftp://chat.example.com").is_err());
        // Needs a local server: set CHAT_TEST_SERVER=http://localhost:8799 to run this part.
        if let Ok(server) = std::env::var("CHAT_TEST_SERVER") {
            assert_eq!(run(&format!("{server}/some/page")).unwrap(), server);
            assert!(run("http://localhost:1").unwrap_err().contains("Couldn't reach"));
        }
    }
}
