// Helpers for scripts/desktop/prepare.mjs, which builds the folder the Mac app carries.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/** The Node.js the Mac app runs Folio's server with. Bumping it means updating all three. */
export const NODE = {
  version: "24.22.2",
  file: "node-v24.22.2-darwin-arm64.tar.gz",
  sha256: "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a",
}

// `from "x"`, `import "x"` and `import("x")` with a package name (not a path or a template).
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["'](@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)*)["']/g
const TYPE_ONLY = /\bimport\s+type\s[^;]*?from\s*["'][^"']+["']/g

/** The packages the server imports, so the app carries only those (not the UI's). */
export function serverDeps(serverDir, pkg) {
  const found = new Set()
  for (const name of fs.readdirSync(serverDir)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue
    const text = fs.readFileSync(path.join(serverDir, name), "utf8").replace(TYPE_ONLY, "")
    for (const m of text.matchAll(IMPORT)) {
      const parts = m[1].split("/")
      found.add(m[1].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0])
    }
  }
  for (const dep of found) {
    if (!pkg.dependencies?.[dep]) throw new Error(`server imports ${dep} but package.json doesn't list it`)
  }
  return [...found].sort()
}

export function serverPackage(pkg, deps) {
  return {
    name: "folio-server",
    private: true,
    type: "module",
    dependencies: Object.fromEntries(deps.map((d) => [d, pkg.dependencies[d]])),
  }
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject)
  })
}
