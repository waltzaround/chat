//! Chat desktop: a native window around your own Chat server.
//!
//! First launch shows a bundled "choose your server" page. Once a server checks out
//! (its /api/instance answers as a Chat server), the window loads that server and
//! the server — and only that server — is allowed to use a few native features:
//! notifications, the dock/taskbar unread badge, and "change server". Links anywhere
//! else open in the system browser.

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
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
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
        .permission("allow-change-server");
    // Adding the same server twice is harmless; ignore "already exists".
    let _ = app.add_capability(capability);
}

/// Accepts "chat.example.com", "https://chat.example.com/any/path", etc. and returns the
/// origin once it answers as a Chat server.
#[tauri::command]
async fn check_server(input: String) -> Result<String, String> {
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
    if info.get("software").and_then(|v| v.as_str()) != Some("beacon-chat") {
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

fn is_allowed(url: &Url, server: Option<&Url>) -> bool {
    if url.scheme() == "tauri" || url.scheme() == "about" || url.host_str() == Some("tauri.localhost") {
        return true;
    }
    if let Some(server) = server {
        if origin_of(url) == origin_of(server) {
            return true;
        }
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
        .invoke_handler(tauri::generate_handler![check_server, connect, current_server, change_server, set_unread])
        .setup(|app| {
            let handle = app.handle().clone();
            let saved = load_saved(&handle);
            let server = app.state::<Server>().inner().clone();
            server.set(saved.clone());
            if let Some(url) = &saved {
                allow_server(&handle, url);
            }

            let start = match &saved {
                Some(url) => WebviewUrl::External(url.clone()),
                None => WebviewUrl::App("index.html".into()),
            };
            let guard_server = server.clone();
            let guard_app = handle.clone();
            WebviewWindowBuilder::new(app, MAIN, start)
                .title("Chat")
                .inner_size(1200.0, 800.0)
                .min_inner_size(420.0, 520.0)
                .on_navigation(move |url| {
                    if is_allowed(url, guard_server.get().as_ref()) {
                        return true;
                    }
                    let _ = guard_app.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;

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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
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
        assert!(is_allowed(&url("https://chat.example.com/w/1/c/2"), Some(&server)));
        assert!(is_allowed(&url("tauri://localhost/index.html"), Some(&server)));
        assert!(is_allowed(&url("http://tauri.localhost/index.html"), Some(&server)));
        assert!(is_allowed(&url("https://accounts.google.com/o/oauth2/auth"), Some(&server)));
        // Anything else opens in the browser, including look-alikes and other ports.
        assert!(!is_allowed(&url("https://example.com"), Some(&server)));
        assert!(!is_allowed(&url("https://chat.example.com.evil.net"), Some(&server)));
        assert!(!is_allowed(&url("https://chat.example.com:8443"), Some(&server)));
        assert!(!is_allowed(&url("https://chat.example.com"), None));
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
