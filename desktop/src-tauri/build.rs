fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "capture_hide",
            "capture_resize",
            "capture_saved",
            "capture_writing",
            "capture_attention",
            "capture_recents",
        ]),
    ))
    .expect("failed to build desktop app")
}
