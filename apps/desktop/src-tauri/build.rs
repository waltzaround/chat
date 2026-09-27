fn main() {
    // App commands get permissions ("allow-set-unread", ...) that capabilities can grant:
    // the local server picker gets some, the chosen server gets others (see lib.rs).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "check_server",
            "connect",
            "current_server",
            "change_server",
            "set_unread",
            "linked_servers",
            "save_linked_server",
            "remove_linked_server",
            "linked_fetch",
            "switch_server",
        ]),
    ))
    .expect("failed to run tauri-build");
}
