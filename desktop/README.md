# Dump desktop (Windows test build)

A minimal [Tauri 2](https://tauri.app) shell around the Dump server. On launch it starts the bundled
Next.js standalone server with its own `node.exe` on `127.0.0.1:47913` (any free port if that is taken),
waits for it, and loads it in the app window. Closing the app stops the server.

- **Data:** `%APPDATA%\app.dump.desktop` (SQLite DB + uploads), passed to the server as `DUMP_DATA_DIR`.
- **Server log:** `%LOCALAPPDATA%\app.dump.desktop\logs\server.log`.
- **Access:** the server requires a per-launch secret (`DUMP_DESKTOP_TOKEN`, see `src/middleware.ts`) so other
  Windows accounts on the PC can't use the library through the loopback port. The app opens
  `/?dump_token=<secret>` and the window keeps it as an HttpOnly cookie; anything else gets 403.
  The bookmarklet, which runs in the user's browser, carries `k=<key>` instead: a key kept in
  `%APPDATA%pp.dump.desktopookmarklet.key` (made on first launch) that only opens `/dump`.
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
- WebView2 is the only system dependency. Windows 10/11 ship it; the installer downloads it if missing.

## Publish a Windows update

Set the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY` to the contents of the desktop
updater's private key file. Do not commit or rotate that key without planning how existing
installations will receive a new trusted public key.

1. Set `version` in `src-tauri/tauri.conf.json` and push a matching tag (for example, `desktop-v0.1.1`).
2. The Windows release workflow builds the installer and uploads it, its signature and `latest.json`
   to a draft GitHub Release. Review the artifacts, then publish the draft as the latest release.
3. Dump checks GitHub on launch and hourly while open. It verifies and downloads newer releases in
   the background and installs the update when you close the app. Open Dump again to use it.

The public release and its assets must be reachable without a GitHub login; Dump does not ship a
GitHub credential. If an update fails, the installed version still runs and retries later.
