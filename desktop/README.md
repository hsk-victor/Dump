# Dump desktop (Windows test build)

A minimal [Tauri 2](https://tauri.app) shell around the Dump server. On launch it starts the bundled
Next.js standalone server with its own `node.exe` on `127.0.0.1:47913` (any free port if that is taken),
waits for it, and loads it in the app window. Closing the app stops the server.

- **Data:** `%APPDATA%\app.dump.desktop` (SQLite DB + uploads), passed to the server as `DUMP_DATA_DIR`.
- **Server log:** `%LOCALAPPDATA%\app.dump.desktop\logs\server.log`.
- **Installer:** NSIS, per-user (`%LOCALAPPDATA%\Dump`), no admin prompt.

## Build (Windows x64)

Needs Node 20+, Rust (stable, MSVC toolchain) and the Visual Studio C++ Build Tools.

```bash
npm ci                 # repo root: native modules for this machine
cd desktop
npm ci
npm run build          # stages the server, then `tauri build`
```

The installer lands in `src-tauri/target/release/bundle/nsis/Dump_<version>_x64-setup.exe`.

`npm run stage` alone builds the server (`DUMP_STANDALONE=1 next build`, which switches Next to
`output: "standalone"`) and copies it, `.next/static`, `public/`, `server-entry.cjs` and the `node.exe`
running the script into `src-tauri/server/`, the folder Tauri ships as a resource.

## Gotchas

- The bundled `node.exe` is the one that ran `npm run stage`, and the native modules (better-sqlite3,
  sharp) are the ones `npm ci` installed for it, so build on Windows x64 with the Node you want to ship.
- The window origin must stay fixed: localStorage (theme, density) is per origin, so a random port per
  launch would reset them. Hence the preferred port.
- `server-entry.cjs` polls the app's pid and exits when it is gone, so a crashed or killed app does not
  leave a Node server running in the background.
- The in-app updater (`/api/update`) needs a git checkout; in the packaged app it reports unsupported.
- WebView2 is the only system dependency. Windows 10/11 ship it; the installer downloads it if missing.
