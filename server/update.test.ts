import assert from "node:assert/strict"
import { test } from "node:test"
import type { HttpError } from "./paths.ts"
import { check, start } from "./update.ts"

test("desktop copies don't update themselves", async () => {
  process.env.RP_DESKTOP = "1"
  process.env.RP_DESKTOP_VERSION = "0.1.0"
  try {
    const c = await check()
    assert.equal(c.kind, "desktop")
    assert.equal(c.available, false)
    assert.equal(c.version, "0.1.0")
    assert.match(c.blocked!, /checks for updates by itself/)
    await assert.rejects(start(), (e: HttpError) => e.status === 409)
  } finally {
    delete process.env.RP_DESKTOP
    delete process.env.RP_DESKTOP_VERSION
  }
})
