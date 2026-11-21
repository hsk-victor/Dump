fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "capture_hide",
            "capture_resize",
            "capture_saved",
            "capture_writing",
        ]),
    ))
    .expect("failed to build desktop app")
}
