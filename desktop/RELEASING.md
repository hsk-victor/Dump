# Release Dump for Windows

## One-time setup (Victor, on your own Windows machine)

Open PowerShell in the root of your local Dump checkout. With Node.js and GitHub CLI installed:

```powershell
Set-Location desktop
npm ci
$keyDir = Join-Path $HOME 'dump-release-signing'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
$key = Join-Path $keyDir 'dump-windows.key'
npx.cmd tauri signer generate -w "$key"
```

Enter a strong password at the prompt. Keep the private key and password in your own secure
backup. Never commit them or send them through chat or a development VM. To retrieve **only the
public key**:

```powershell
Get-Content -Raw "$key.pub"
```

Replace `REPLACE_WITH_VICTORS_TAURI_UPDATER_PUBLIC_KEY` in
`desktop/src-tauri/tauri.release.conf.json` (`plugins.updater.pubkey`) with the single line from
`dump-windows.key.pub`, without the trailing newline. Commit and push only that public-key change
to PR #44. Keep using this key pair for subsequent releases: existing installs trust its public key.

In the same PowerShell session, use your GitHub account with permission to manage repository secrets:

```powershell
gh auth login --hostname github.com
cmd.exe /d /c ('gh secret set TAURI_SIGNING_PRIVATE_KEY --repo hsk-victor/Dump < "{0}"' -f $key)
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo hsk-victor/Dump
```

Enter the key password at the last command's hidden prompt. Alternatively, add both as
**Repository secrets** under **Settings → Secrets and variables → Actions** in `hsk-victor/Dump`.
Use the contents of the file **without** `.pub` for `TAURI_SIGNING_PRIVATE_KEY`, and its password
for `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. If you deliberately generated an unencrypted key,
omit the password secret.

## Publish a release

1. Set `version` in `desktop/src-tauri/tauri.conf.json` and merge it into `main` along with the
   configured public key. From the repository root, tag the release commit and push the matching
   tag. For version `0.1.1`, for example:

   ```powershell
   git switch main
   git pull --ff-only
   git tag desktop-v0.1.1
   git push origin desktop-v0.1.1
   ```

2. The Windows release workflow creates a draft GitHub Release with the installer, its updater
   signature, and `latest.json`. Check those assets, then publish the draft as the latest release.
   The release assets must be reachable without a GitHub login.
3. Verify an upgrade from an older release that trusts the same public key. Dump checks on launch
   and hourly while running, downloads a verified update in the background, and installs it on
   exit. Open Dump again to confirm the new version is running.
