#!/usr/bin/env node
// Makes a Folio app icon that starts Folio and opens it in the browser:
//   macOS:   ~/Applications/Folio.app (find it in Launchpad or Spotlight, drag it to the Dock)
//   Windows: Folio on the Desktop and in the Start menu
//   Linux:   Folio in the applications menu
// Run with `npm run shortcut`. The installer runs it for you.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const LAUNCH = path.join(APP, "scripts", "launch.mjs")
const home = os.homedir()

const sh = (s) => `'${s.replaceAll("'", `'\\''`)}'`

// Apps opened from the Dock or Start menu don't get the terminal's PATH, so the icon
// looks for Node itself: Folio's own copy first (from the installer), then the usual places.
const findNode = `
NODE=${sh(path.join(path.dirname(APP), "node", "bin", "node"))}
if [ ! -x "$NODE" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  NODE="$(command -v node)"
fi`

function mac() {
  const bundle = path.join(home, "Applications", "Folio.app")
  fs.rmSync(bundle, { recursive: true, force: true })
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true })
  fs.mkdirSync(path.join(bundle, "Contents", "Resources"), { recursive: true })
  fs.writeFileSync(
    path.join(bundle, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Folio</string>
  <key>CFBundleDisplayName</key><string>Folio</string>
  <key>CFBundleIdentifier</key><string>local.folio.launcher</string>
  <key>CFBundleExecutable</key><string>folio</string>
  <key>CFBundleIconFile</key><string>folio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`,
  )
  const exe = path.join(bundle, "Contents", "MacOS", "folio")
  fs.writeFileSync(
    exe,
    `#!/bin/bash
${findNode}
if [ -z "$NODE" ]; then
  osascript -e 'display alert "Folio needs Node.js" message "Install the LTS version from nodejs.org, then open Folio again."'
  open https://nodejs.org
  exit 1
fi
exec "$NODE" ${sh(LAUNCH)} --background
`,
  )
  fs.chmodSync(exe, 0o755)

  // Turn the PNG into an .icns with the tools every Mac has.
  const set = path.join(os.tmpdir(), `folio-${process.pid}.iconset`)
  fs.mkdirSync(set, { recursive: true })
  const src = path.join(APP, "public", "folio-1024.png")
  for (const s of [16, 32, 128, 256, 512]) {
    spawnSync("sips", ["-z", String(s), String(s), src, "--out", path.join(set, `icon_${s}x${s}.png`)], { stdio: "ignore" })
    spawnSync("sips", ["-z", String(s * 2), String(s * 2), src, "--out", path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: "ignore" })
  }
  spawnSync("iconutil", ["-c", "icns", set, "-o", path.join(bundle, "Contents", "Resources", "folio.icns")], { stdio: "ignore" })
  fs.rmSync(set, { recursive: true, force: true })
  spawnSync("touch", [bundle]) // so Finder picks up the icon
  console.log(`  Made ${bundle}`)
  console.log("  Open Folio from Launchpad or Spotlight, or drag it from Applications to your Dock.")
}

function windows() {
  const ps = (s) => `'${s.replaceAll("'", "''")}'`
  const make = (dir) => `
$s = $w.CreateShortcut((Join-Path ${dir} 'Folio.lnk'))
$s.TargetPath = ${ps(process.execPath)}
$s.Arguments = '"' + ${ps(LAUNCH)} + '" --background'
$s.WorkingDirectory = ${ps(APP)}
$s.IconLocation = ${ps(path.join(APP, "public", "folio.ico"))}
$s.WindowStyle = 7
$s.Description = 'Folio'
$s.Save()`
  const script = `
$w = New-Object -ComObject WScript.Shell
${make("[Environment]::GetFolderPath('Desktop')")}
${make("[Environment]::GetFolderPath('Programs')")}`
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "inherit" })
  if (r.status !== 0) process.exit(1)
  console.log("  Made a Folio icon on your Desktop and in the Start menu.")
}

function linux() {
  const dir = path.join(home, ".local", "share", "applications")
  fs.mkdirSync(dir, { recursive: true })
  const runner = path.join(APP, "scripts", ".folio-open.sh")
  fs.writeFileSync(runner, `#!/bin/bash\n${findNode}\nexec "$NODE" ${sh(LAUNCH)} --background\n`)
  fs.chmodSync(runner, 0o755)
  fs.writeFileSync(
    path.join(dir, "folio.desktop"),
    `[Desktop Entry]
Type=Application
Name=Folio
Comment=Your research workspace
Exec=${runner}
Icon=${path.join(APP, "public", "icon-512.png")}
Terminal=false
Categories=Education;Office;
`,
  )
  console.log("  Added Folio to your applications menu.")
}

if (process.platform === "darwin") mac()
else if (process.platform === "win32") windows()
else linux()
