#!/usr/bin/env node
// Builds what the Mac app carries, before `tauri build` / `tauri dev`:
//   src-tauri/resources/app/        Folio's server, the built web app and only the server's packages
//   src-tauri/binaries/node-aarch64-apple-darwin   a checksum-checked Node.js to run them
//
//   node scripts/desktop/prepare.mjs [--skip-build]

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { NODE, serverDeps, serverPackage, sha256File } from "./lib.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const OUT = path.join(ROOT, "src-tauri", "resources", "app")
const BIN = path.join(ROOT, "src-tauri", "binaries", "node-aarch64-apple-darwin")
const CACHE = path.join(os.homedir(), "Library", "Caches", "folio-desktop")

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`)
}

if (!process.argv.includes("--skip-build")) run("npx", ["vite", "build"], ROOT)

// The app folder: server code (no tests), the built UI, and the server's packages only.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
const deps = serverDeps(path.join(ROOT, "server"), pkg)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.cpSync(path.join(ROOT, "server"), path.join(OUT, "server"), {
  recursive: true,
  filter: (src) => !src.endsWith(".test.ts"),
})
fs.cpSync(path.join(ROOT, "dist"), path.join(OUT, "dist"), { recursive: true })
fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify(serverPackage(pkg, deps), null, 2) + "\n")
fs.copyFileSync(path.join(ROOT, "package-lock.json"), path.join(OUT, "package-lock.json"))
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], OUT)

// Node.js, downloaded once into the cache and refused if the checksum doesn't match.
fs.mkdirSync(CACHE, { recursive: true })
const tarball = path.join(CACHE, NODE.file)
if (!fs.existsSync(tarball) || (await sha256File(tarball)) !== NODE.sha256) {
  console.log(`  Downloading ${NODE.file}`)
  const res = await fetch(`https://nodejs.org/dist/v${NODE.version}/${NODE.file}`)
  if (!res.ok) throw new Error(`Node download failed: ${res.status}`)
  fs.writeFileSync(tarball, Buffer.from(await res.arrayBuffer()))
}
if ((await sha256File(tarball)) !== NODE.sha256) {
  fs.rmSync(tarball)
  throw new Error(`${NODE.file} doesn't match its checksum; refusing to bundle it`)
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "folio-node-"))
const inner = `${NODE.file.replace(/\.tar\.gz$/, "")}/bin/node`
run("tar", ["-xzf", tarball, "-C", tmp, inner], ROOT)
fs.mkdirSync(path.dirname(BIN), { recursive: true })
fs.copyFileSync(path.join(tmp, inner), BIN)
fs.chmodSync(BIN, 0o755)
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n  Ready: ${deps.length} server packages, Node ${NODE.version}`)
