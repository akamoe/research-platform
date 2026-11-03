#!/usr/bin/env node
// Starts Folio and opens it in the browser. Used by the Folio app icon, the
// "Start Folio" files and `npm run folio`. Plain Node, no dependencies, so it
// can run before `npm ci`.
//
//   node scripts/launch.mjs               set up if needed, start, open the browser; Ctrl+C stops
//   node scripts/launch.mjs --background  same, but Folio keeps running in the background
//   node scripts/launch.mjs --stop        stop a Folio started in the background
//   node scripts/launch.mjs --setup       only install and build (the installer uses this)
//   --no-open                             don't open the browser
//   --after <pid>                         first wait for that process to exit (used by "Check for updates")

import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PORT = Number(process.env.RP_PORT ?? 5174)
const URL_ = `http://localhost:${PORT}`
const PID_FILE = path.join(APP, ".folio.pid")
const LOG_FILE = path.join(APP, "folio.log")
const NODE = process.execPath
const WIN = process.platform === "win32"
const MAC = process.platform === "darwin"
const args = new Set(process.argv.slice(2))
const background = args.has("--background")
const afterPid = Number(process.argv[process.argv.indexOf("--after") + 1]) || 0

// npm sits next to whichever node runs this (the installer's own copy, or the system one).
const env = { ...process.env, PATH: path.dirname(NODE) + path.delimiter + (process.env.PATH ?? "") }

function say(msg) {
  console.log(`  ${msg}`)
}

function notify(msg) {
  if (MAC && background) spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title "Folio"`])
}

function fail(msg) {
  console.error(`\n  ${msg}\n`)
  if (background && MAC) {
    spawnSync("osascript", ["-e", `display alert "Folio could not start" message ${JSON.stringify(msg)} as critical`])
  } else if (background && WIN) {
    const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${psQuote(msg)}, 'Folio could not start') | Out-Null`
    spawnSync("powershell.exe", ["-NoProfile", "-Command", ps])
  }
  process.exit(1)
}

function psQuote(s) {
  return `'${s.replaceAll("'", "''")}'`
}

async function running() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok && (await res.json()).app === "folio"
  } catch {
    return false
  }
}

async function openBrowser() {
  if (args.has("--no-open")) return
  try {
    const { default: open } = await import("open")
    await open(URL_)
  } catch {
    say(`Open ${URL_} in your browser.`)
  }
}

function run(cmd, cmdArgs, what) {
  const r = spawnSync(cmd, cmdArgs, { cwd: APP, env, stdio: background ? "ignore" : "inherit", shell: WIN && cmd === "npm" })
  if (r.status !== 0) fail(`${what} failed. Run "npm ci" in ${APP} to see why.`)
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

/** Newest modification time under the paths that go into the built app. */
function newest(paths) {
  let t = 0
  const walk = (p) => {
    let st
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f))
    else t = Math.max(t, st.mtimeMs)
  }
  for (const p of paths) walk(path.join(APP, p))
  return t
}

function setup() {
  const lock = path.join(APP, "package-lock.json")
  const stamp = path.join(APP, "node_modules", ".folio-lock")
  const current = hash(lock)
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== current) {
    notify("Getting Folio ready. The first time takes a few minutes.")
    say("Installing Folio's parts (the first time takes a few minutes)...")
    run("npm", ["ci", "--no-audit", "--no-fund"], "Installing")
    fs.writeFileSync(stamp, current)
  }
  const built = path.join(APP, "dist", "index.html")
  const inputs = ["src", "public", "index.html", "vite.config.ts", "package-lock.json", "tsconfig.app.json"]
  if (!fs.existsSync(built) || newest(inputs) > fs.statSync(built).mtimeMs) {
    notify("Building Folio. This takes about a minute.")
    say("Building Folio (about a minute)...")
    run(NODE, [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "build", "--logLevel", "error"], "Building")
  }
}

function stop() {
  let pid
  try {
    pid = Number(fs.readFileSync(PID_FILE, "utf8"))
  } catch {
    return false
  }
  try {
    process.kill(pid)
  } catch {}
  fs.rmSync(PID_FILE, { force: true })
  return true
}

const server = [path.join(APP, "node_modules", "tsx", "dist", "cli.mjs"), path.join(APP, "server", "index.ts")]

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === "EPERM"
  }
}

if (afterPid) for (let i = 0; i < 120 && alive(afterPid); i++) await new Promise((r) => setTimeout(r, 250))

if (args.has("--stop")) {
  say(stop() ? "Folio stopped." : "Folio wasn't running in the background.")
  process.exit(0)
}

if (await running()) {
  say(`Folio is already running at ${URL_}`)
  await openBrowser()
  process.exit(0)
}

const [major] = process.versions.node.split(".").map(Number)
if (major < 20) fail(`Folio needs Node.js 20 or newer (this is ${process.versions.node}). Get it from nodejs.org.`)

setup()
if (args.has("--setup")) process.exit(0)

if (background) {
  const log = fs.openSync(LOG_FILE, "a")
  const child = spawn(NODE, server, { cwd: APP, env, detached: true, stdio: ["ignore", log, log], windowsHide: true })
  fs.writeFileSync(PID_FILE, String(child.pid))
  child.unref()
  for (let i = 0; i < 60 && !(await running()); i++) await new Promise((r) => setTimeout(r, 500))
  if (!(await running())) fail(`Folio didn't start. The details are in ${LOG_FILE}`)
  await openBrowser()
  process.exit(0)
}

// Foreground: the server prints its address and opens the browser itself.
const child = spawn(NODE, [...server, "--open"], { cwd: APP, env, stdio: "inherit" })
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig))
child.on("exit", (code) => process.exit(code ?? 0))
