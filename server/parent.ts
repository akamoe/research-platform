/** Calls `onGone` once process `pid` has exited. The Mac app passes its own pid so a
 *  server left behind by a crash or Force Quit stops by itself. */
export function watchParent(pid: number, onGone: () => void, everyMs = 2000): NodeJS.Timeout {
  return setInterval(() => {
    try {
      process.kill(pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") onGone()
    }
  }, everyMs)
}
