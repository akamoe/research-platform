import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { test } from "node:test"
import { watchParent } from "./parent.ts"

test("calls onGone after the parent exits", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 200)"])
  const gone = await new Promise<boolean>((resolve) => {
    const timer = watchParent(child.pid!, () => {
      clearInterval(timer)
      resolve(true)
    }, 50)
    setTimeout(() => {
      clearInterval(timer)
      resolve(false)
    }, 2000)
  })
  assert.equal(gone, true)
})

test("stays quiet while the parent lives", async () => {
  let called = false
  const timer = watchParent(process.pid, () => (called = true), 50)
  await new Promise((r) => setTimeout(r, 300))
  clearInterval(timer)
  assert.equal(called, false)
})
