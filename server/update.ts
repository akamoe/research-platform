// "Check for updates" in Settings. Folio is either a git clone (developers) or a
// copy downloaded by scripts/install.sh / install.ps1 (students). A git clone is
// updated with `git pull --ff-only`; a downloaded copy gets the new code from
// GitHub's tarball, with its commit kept in `.folio-version`. Then
// `launch.mjs --setup` runs `npm ci` / `vite build` only when needed, and a
// detached `launch.mjs --background --after <pid>` starts the new server once
// this one has exited.

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HttpError } from "./paths.ts"

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPO = process.env.RP_UPDATE_REPO ?? "akamoe/research-platform"
const BRANCH = "main"
const GITHUB_API = process.env.RP_GITHUB_API ?? "https://api.github.com"
const CODELOAD = process.env.RP_CODELOAD_URL ?? "https://codeload.github.com"
const STAMP = path.join(APP, ".folio-version")
/** Things in the app folder that a downloaded update must not replace. */
const KEEP = new Set(["node_modules", "dist", ".folio-version", ".folio.pid", "folio.log", ".git"])

export interface Commit {
  sha: string
  title: string
  date: string
}
export interface UpdateCheck {
  kind: "git" | "download" | "desktop"
  /** The Mac app's version (desktop only). */
  version?: string
  current: { sha: string | null; date: string | null }
  latest: Commit | null
  /** Commits on main that this copy doesn't have, newest first (at most 20). */
  behind: number
  commits: Commit[]
  available: boolean
  /** Why updating in one click won't work here (local changes, another branch, dev mode). */
  blocked?: string
}
export interface UpdateJob {
  state: "idle" | "running" | "restarting" | "done" | "error"
  step: string
  error?: string
}

let job: UpdateJob = { state: "idle", step: "" }
export const progress = () => job

const isGit = () => fs.existsSync(path.join(APP, ".git"))
const devMode = () => process.env.npm_lifecycle_event === "dev"

function git(args: string[], timeout = 60_000) {
  const r = spawnSync("git", args, { cwd: APP, encoding: "utf8", timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (r.error) throw new HttpError(500, "Git isn't available on this computer")
  if (r.status !== 0) throw new HttpError(502, (r.stderr || r.stdout).trim().split("\n").pop() || `git ${args[0]} failed`)
  return r.stdout.trim()
}

const firstLine = (s: string) => s.split("\n")[0].trim()

async function github<T>(p: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${p}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "Folio" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new HttpError(502, "Couldn't reach GitHub. Check your internet connection.")
  })
  if (res.status === 403 || res.status === 429) throw new HttpError(502, "GitHub is limiting requests right now. Try again in a while.")
  if (!res.ok) throw new HttpError(502, `GitHub answered ${res.status}`)
  return (await res.json()) as T
}

interface GhCommit {
  sha: string
  commit: { message: string; committer: { date: string } }
}
const toCommit = (c: GhCommit): Commit => ({ sha: c.sha, title: firstLine(c.commit.message), date: c.commit.committer.date })

function readStamp(): { sha: string; date: string | null } | null {
  try {
    const s = JSON.parse(fs.readFileSync(STAMP, "utf8"))
    return typeof s.sha === "string" ? { sha: s.sha, date: s.date ?? null } : null
  } catch {
    return null
  }
}

export async function check(): Promise<UpdateCheck> {
  // Inside the Mac app the code lives in the app bundle, which updates itself.
  if (process.env.RP_DESKTOP === "1") {
    const version = process.env.RP_DESKTOP_VERSION ?? ""
    return {
      kind: "desktop",
      version,
      current: { sha: null, date: null },
      latest: null,
      behind: 0,
      commits: [],
      available: false,
      blocked: `This is Folio for Mac ${version}. It checks for updates by itself each time it opens.`,
    }
  }
  if (isGit()) return checkGit()
  return checkDownload()
}

function checkGit(): UpdateCheck {
  const sha = git(["rev-parse", "HEAD"])
  const date = git(["log", "-1", "--format=%cI"])
  git(["fetch", "--quiet", "origin", BRANCH], 120_000)
  const behind = Number(git(["rev-list", "--count", `HEAD..origin/${BRANCH}`]))
  const log = (range: string, n: number) =>
    git(["log", `-${n}`, "--format=%H%x09%cI%x09%s", range])
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [s, d, ...t] = l.split("\t")
        return { sha: s, date: d, title: t.join("\t") }
      })
  const latest = log(`origin/${BRANCH}`, 1)[0] ?? null
  const commits = behind ? log(`HEAD..origin/${BRANCH}`, 20) : []
  let blocked: string | undefined
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch !== BRANCH) blocked = `This copy is on the branch "${branch}", not ${BRANCH}. Switch to ${BRANCH} to update here.`
  else if (Number(git(["rev-list", "--count", `origin/${BRANCH}..HEAD`]))) blocked = `This copy has commits that aren't on ${BRANCH}. Update it with git.`
  else if (devMode()) blocked = "Folio is running with npm run dev. Pull with git; the dev server reloads by itself."
  return { kind: "git", current: { sha, date }, latest, behind, commits, available: behind > 0, blocked }
}

async function checkDownload(): Promise<UpdateCheck> {
  const stamp = readStamp()
  const latest = toCommit(await github<GhCommit>(`/repos/${REPO}/commits/${BRANCH}`))
  let behind = 0
  let commits: Commit[] = []
  if (!stamp) {
    // Installed before Folio kept a version stamp: we can't tell, so offer the latest.
    behind = 1
    commits = [latest]
  } else if (stamp.sha !== latest.sha) {
    const cmp = await github<{ behind_by: number; ahead_by: number; commits: GhCommit[] }>(
      `/repos/${REPO}/compare/${stamp.sha}...${latest.sha}`,
    ).catch(() => null)
    behind = cmp ? cmp.ahead_by : 1
    commits = cmp ? cmp.commits.map(toCommit).reverse().slice(0, 20) : [latest]
  }
  return {
    kind: "download",
    current: stamp ?? { sha: null, date: null },
    latest,
    behind,
    commits,
    available: behind > 0,
    blocked: devMode() ? "Folio is running with npm run dev, so it can't restart itself." : undefined,
  }
}

/** Starts the update in the background; the app polls progress(). */
export async function start(): Promise<UpdateJob> {
  if (job.state === "running" || job.state === "restarting") return job
  const c = await check()
  if (c.blocked) throw new HttpError(409, c.blocked)
  if (!c.available || !c.latest) throw new HttpError(409, "Folio is already up to date")
  job = { state: "running", step: "Downloading the new version" }
  void run(c).catch((e) => {
    job = { state: "error", step: job.step, error: (e as Error).message }
  })
  return job
}

async function run(c: UpdateCheck) {
  if (c.kind === "git") {
    git(["pull", "--ff-only", "--quiet", "origin", BRANCH], 300_000)
  } else {
    await download(c.latest!)
  }
  job = { state: "running", step: "Installing and building (this can take a few minutes)" }
  await setup()
  job = { state: "restarting", step: "Restarting Folio" }
  restart()
}

/** Downloads main's tarball at `latest.sha` and swaps it into the app folder. */
async function download(latest: Commit) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "folio-update-"))
  try {
    const res = await fetch(`${CODELOAD}/${REPO}/tar.gz/${latest.sha}`, { signal: AbortSignal.timeout(300_000) }).catch(() => {
      throw new HttpError(502, "Couldn't download the update. Check your internet connection.")
    })
    if (!res.ok) throw new HttpError(502, `The download failed (${res.status})`)
    const file = path.join(tmp, "folio.tar.gz")
    await fs.promises.writeFile(file, new Uint8Array(await res.arrayBuffer()))
    const src = path.join(tmp, "src")
    await fs.promises.mkdir(src)
    // tar ships with macOS, Linux and Windows 10+.
    const r = spawnSync("tar", ["-xzf", file, "-C", src, "--strip-components", "1"], { encoding: "utf8" })
    if (r.status !== 0) throw new HttpError(500, `Couldn't unpack the update: ${(r.stderr || "").trim()}`)
    if (!fs.existsSync(path.join(src, "package.json")) || !fs.existsSync(path.join(src, "scripts", "launch.mjs"))) {
      throw new HttpError(500, "The download doesn't look like Folio")
    }
    // Move the old files aside first, so a failed swap can be put back.
    const old = path.join(tmp, "old")
    await fs.promises.mkdir(old)
    const moved: string[] = []
    try {
      for (const name of await fs.promises.readdir(APP)) {
        if (KEEP.has(name)) continue
        await fs.promises.rename(path.join(APP, name), path.join(old, name))
        moved.push(name)
      }
      for (const name of await fs.promises.readdir(src)) {
        if (KEEP.has(name)) continue
        await fs.promises.rename(path.join(src, name), path.join(APP, name))
      }
    } catch (e) {
      for (const name of moved) {
        await fs.promises.rm(path.join(APP, name), { recursive: true, force: true }).catch(() => {})
        await fs.promises.rename(path.join(old, name), path.join(APP, name)).catch(() => {})
      }
      throw new HttpError(500, `Couldn't replace Folio's files: ${(e as Error).message}`)
    }
    await fs.promises.writeFile(STAMP, JSON.stringify({ sha: latest.sha, date: latest.date }) + "\n")
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/** `npm ci` when package-lock changed and `vite build` when sources changed (launch.mjs decides). */
function setup() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(APP, "scripts", "launch.mjs"), "--setup"], {
      cwd: APP,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(out.trim().split("\n").filter(Boolean).pop() ?? "Installing the update failed"))
    })
  })
}

/** Starts a fresh Folio that waits for this one to exit, then exits. */
function restart() {
  const child = spawn(
    process.execPath,
    [path.join(APP, "scripts", "launch.mjs"), "--background", "--no-open", "--after", String(process.pid)],
    { cwd: APP, detached: true, stdio: "ignore", windowsHide: true },
  )
  child.unref()
  // Give the app a moment to read the "restarting" state.
  setTimeout(() => process.exit(0), 1500)
}
