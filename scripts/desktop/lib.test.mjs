import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { serverDeps, serverPackage, sha256File } from "./lib.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))

function tempServer(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "folio-deps-"))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

test("finds the packages Folio's real server imports", () => {
  const deps = serverDeps(path.join(ROOT, "server"), rootPkg)
  for (const name of ["hono", "@hono/node-server", "zod", "@citation-js/plugin-bibtex", "@firecrawl/pdf-inspector", "tesseract.js"]) {
    assert.ok(deps.includes(name), `missing ${name}`)
  }
  assert.ok(deps.every((d) => !d.startsWith("node:") && !d.startsWith(".")))
  assert.deepEqual(deps, [...deps].sort())
})

test("fails on a package that package.json doesn't list", () => {
  const dir = tempServer({ "a.ts": 'import x from "left-pad"\n' })
  assert.throws(() => serverDeps(dir, { dependencies: {} }), /server imports left-pad but package.json doesn't list it/)
})

test("counts a deep import as its package and skips tests", () => {
  const dir = tempServer({
    "a.ts": 'import { serveStatic } from "@hono/node-server/serve-static"\nimport "yaml"\nconst m = await import("jszip")\n',
    "a.test.ts": 'import "only-in-tests"\n',
  })
  const pkg = { dependencies: { "@hono/node-server": "1", yaml: "1", jszip: "1" } }
  assert.deepEqual(serverDeps(dir, pkg), ["@hono/node-server", "jszip", "yaml"])
})

test("server package keeps only the given dependencies, with their versions", () => {
  const p = serverPackage({ dependencies: { hono: "^4", react: "^19" } }, ["hono"])
  assert.deepEqual(p, { name: "folio-server", private: true, type: "module", dependencies: { hono: "^4" } })
})

test("sha256File hashes the file's bytes", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "folio-sha-")), "f")
  fs.writeFileSync(file, "folio")
  assert.equal(await sha256File(file), "4631f244ad4495271986f2ad47fdb560fb8d94727e723e4939fe4e2448bbb156")
})
