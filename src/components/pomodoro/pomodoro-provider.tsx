import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useMusic } from "@/components/music/music-provider"

// A Pomodoro timer: focus, then a short break, and a long break after every few focus
// sessions. It lives above the router (like the music) so it keeps running across views.
// Everything is in localStorage: the timer is per browser, not part of a project.

export type Phase = "focus" | "short" | "long"
export const PHASES: { id: Phase; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "short", label: "Short break" },
  { id: "long", label: "Long break" },
]

export interface PomodoroSettings {
  focus: number
  short: number
  long: number
  /** A long break after this many focus sessions. */
  every: number
  autoStart: boolean
  sound: boolean
  /** Pause the study music during breaks and start it again after. */
  musicOnBreaks: boolean
}
const DEFAULTS: PomodoroSettings = { focus: 25, short: 5, long: 15, every: 4, autoStart: false, sound: true, musicOnBreaks: false }

interface Saved {
  settings: PomodoroSettings
  phase: Phase
  /** When the running timer ends (ms since epoch); null when stopped. */
  endsAt: number | null
  /** Time left while paused, in ms; null means a full phase. */
  left: number | null
  /** Focus sessions done since the last long break. */
  round: number
  /** Focus sessions done today. */
  today: { date: string; count: number; minutes: number }
}

const STORE = "rp-pomodoro"
const day = () => new Date().toLocaleDateString("en-CA")

function load(): Saved {
  const base: Saved = { settings: DEFAULTS, phase: "focus", endsAt: null, left: null, round: 0, today: { date: day(), count: 0, minutes: 0 } }
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "{}")
    return { ...base, ...s, settings: { ...DEFAULTS, ...s.settings } }
  } catch {
    return base
  }
}

const minutesOf = (s: PomodoroSettings, p: Phase) => (p === "focus" ? s.focus : p === "short" ? s.short : s.long)

/** A soft two-note chime, made on the spot (no sound files). */
function chime() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = "sine"
      o.frequency.value = f
      const t = now + i * 0.25
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.25, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.2)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 1.3)
    }
    window.setTimeout(() => ctx.close(), 2000)
  } catch {}
}

interface PomodoroState {
  settings: PomodoroSettings
  phase: Phase
  running: boolean
  /** Ms left in this phase. */
  left: number
  total: number
  round: number
  today: { count: number; minutes: number }
  start(): void
  pause(): void
  reset(): void
  skip(): void
  setPhase(p: Phase): void
  update(s: Partial<PomodoroSettings>): void
}

const Ctx = createContext<PomodoroState | null>(null)

export function usePomodoro() {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePomodoro needs PomodoroProvider")
  return v
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Saved>(load)
  const [now, setNow] = useState(Date.now())
  const music = useMusic()
  const musicRef = useRef(music)
  musicRef.current = music
  // True while the timer paused the music for a break, so it only restarts what it stopped.
  const pausedMusic = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(s))
    } catch {}
  }, [s])

  const total = minutesOf(s.settings, s.phase) * 60_000
  const running = s.endsAt !== null
  const left = running ? Math.max(0, s.endsAt! - now) : (s.left ?? total)

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [running])

  const stateRef = useRef(s)
  stateRef.current = s

  /** Move to the next phase; `done` when the phase ran to the end (not skipped). */
  const advance = useCallback((done: boolean, quiet = false) => {
    const p = stateRef.current
    const today = p.today.date === day() ? { ...p.today } : { date: day(), count: 0, minutes: 0 }
    let round = p.round
    let next: Phase
    if (p.phase === "focus") {
      if (done) {
        today.count++
        today.minutes += p.settings.focus
        round++
      }
      next = round >= p.settings.every ? "long" : "short"
      if (next === "long") round = 0
    } else next = "focus"
    const auto = p.settings.autoStart && !quiet
    const after: Saved = { ...p, phase: next, round, today, left: null, endsAt: auto ? Date.now() + minutesOf(p.settings, next) * 60_000 : null }
    stateRef.current = after
    setS(after)
    if (done && !quiet) {
      if (p.settings.sound) chime()
      const msg = next === "focus" ? "Break's over. Back to it." : `Focus session done. Take ${minutesOf(p.settings, next)} minutes.`
      toast(msg, { description: next === "focus" ? undefined : `${today.count} today` })
      if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("Folio", { body: msg, icon: "/icon-192.png" })
    }
    // Music: pause it for breaks, and play it again when focus starts.
    const m = musicRef.current
    if (p.settings.musicOnBreaks && !quiet) {
      if (next !== "focus" && m.playing) {
        m.toggle()
        pausedMusic.current = true
      } else if (next === "focus" && pausedMusic.current && auto) {
        if (!m.playing) m.toggle()
        pausedMusic.current = false
      }
    }
  }, [])

  // The phase ends.
  useEffect(() => {
    if (running && left <= 0) advance(true, Date.now() - s.endsAt! > 60_000)
  }, [running, left]) // eslint-disable-line react-hooks/exhaustive-deps

  // The time left in the tab's title while it runs.
  useEffect(() => {
    if (!running) return
    const base = document.title.replace(/^\d+:\d\d (Focus|Break) · /, "")
    const m = Math.floor(left / 60_000)
    const sec = Math.floor((left % 60_000) / 1000)
    document.title = `${m}:${String(sec).padStart(2, "0")} ${s.phase === "focus" ? "Focus" : "Break"} · ${base}`
    return () => {
      document.title = document.title.replace(/^\d+:\d\d (Focus|Break) · /, "")
    }
  }, [running, left, s.phase])

  const value: PomodoroState = {
    settings: s.settings,
    phase: s.phase,
    running,
    left,
    total,
    round: s.round,
    today: s.today.date === day() ? s.today : { count: 0, minutes: 0 },
    start: () => {
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {})
      const m = musicRef.current
      if (s.settings.musicOnBreaks && s.phase === "focus" && pausedMusic.current && !m.playing) {
        m.toggle()
        pausedMusic.current = false
      }
      setS((p) => ({ ...p, endsAt: Date.now() + (p.left ?? minutesOf(p.settings, p.phase) * 60_000), left: null }))
    },
    pause: () => setS((p) => (p.endsAt === null ? p : { ...p, left: Math.max(0, p.endsAt - Date.now()), endsAt: null })),
    reset: () => setS((p) => ({ ...p, endsAt: null, left: null })),
    skip: () => advance(false),
    setPhase: (phase) => setS((p) => ({ ...p, phase, endsAt: null, left: null })),
    update: (u) =>
      setS((p) => {
        const settings = { ...p.settings, ...u }
        // A new length applies now if the timer hasn't started this phase.
        const fresh = p.endsAt === null && p.left === null
        return { ...p, settings, left: fresh ? null : p.left }
      }),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
