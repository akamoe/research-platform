import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { loadYouTube, YTState, type YTPlayer } from "./youtube"

// Study music from YouTube. The player lives here (above the router) so music keeps
// playing while the student moves between projects and views; the sidebar only shows controls.

export type Station = {
  id: string
  name: string
  genre: "lofi" | "classical" | "custom"
  /** Tried in order: live streams get new ids now and then, so each station has fallbacks. */
  videoIds: string[]
  listId?: string
}

export const STATIONS: Station[] = [
  { id: "lofi", name: "Lofi hip hop radio", genre: "lofi", videoIds: ["rFZHOHl-L8A", "jfKfPfyJRdk", "5qap5aO4i9A"] },
  { id: "lofi-sleep", name: "Lofi beats to chill", genre: "lofi", videoIds: ["JD-kMIpDfnY", "DWcJFNfaw9c"] },
  { id: "lofi-jazz", name: "Jazz lofi", genre: "lofi", videoIds: ["E2vONfzoyRI", "A8jDx9TLMQc"] },
  { id: "classical", name: "Classical radio", genre: "classical", videoIds: ["jXAEIWcGXwE", "bwZUs26HZI8"] },
  { id: "classical-piano", name: "Classical piano", genre: "classical", videoIds: ["y6TZHLAzg5o", "N0snMcR6aaA"] },
  { id: "classical-10h", name: "Mozart, Bach, Chopin (10 h)", genre: "classical", videoIds: ["VThrx5MRJXA"] },
]

const STORE = "rp-music"

type Saved = { stationId?: string; volume?: number; muted?: boolean; custom?: Station[] }

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Saved
  } catch {
    return {}
  }
}

type MusicState = {
  stations: Station[]
  station: Station
  playing: boolean
  buffering: boolean
  /** Title of what YouTube is playing now (a track in a playlist, or the stream's name). */
  title: string
  live: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  error: string | null
  /** The video id that is playing now, for "Open on YouTube". */
  videoId: string | null
  toggle(): void
  playStation(s: Station): void
  next(): void
  previous(): void
  seek(seconds: number): void
  setVolume(v: number): void
  toggleMute(): void
  addCustom(s: Omit<Station, "id" | "genre">): Station
  removeCustom(id: string): void
}

const Ctx = createContext<MusicState | null>(null)

export function useMusic() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useMusic needs MusicProvider")
  return v
}

export function MusicProvider({ children }: { children: ReactNode }) {
  const saved = useRef(readSaved()).current
  const [custom, setCustom] = useState<Station[]>(saved.custom ?? [])
  const stations = useMemo(() => [...STATIONS, ...custom], [custom])
  const [stationId, setStationId] = useState(saved.stationId ?? STATIONS[0].id)
  const station = stations.find((s) => s.id === stationId) ?? STATIONS[0]
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [title, setTitle] = useState("")
  const [live, setLive] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(saved.volume ?? 60)
  const [muted, setMuted] = useState(saved.muted ?? false)
  const [error, setError] = useState<string | null>(null)
  const [videoId, setVideoId] = useState<string | null>(null)

  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const creating = useRef<Promise<YTPlayer> | null>(null)
  // Which of the station's video ids is being tried, for falling back on errors.
  const attempt = useRef<{ station: Station; index: number } | null>(null)
  const volumeRef = useRef(volume)
  const mutedRef = useRef(muted)
  volumeRef.current = volume
  mutedRef.current = muted

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ stationId, volume, muted, custom } satisfies Saved))
    } catch {
      /* storage full or blocked: settings just don't persist */
    }
  }, [stationId, volume, muted, custom])

  const readInfo = useCallback((p: YTPlayer) => {
    const data = p.getVideoData?.() ?? {}
    const d = p.getDuration?.() ?? 0
    setTitle(data.title ?? "")
    setVideoId(data.video_id ?? null)
    setLive(Boolean(data.isLive) || d === 0)
    setDuration(d)
  }, [])

  const loadInto = useCallback((p: YTPlayer, s: Station, index: number) => {
    attempt.current = { station: s, index }
    setError(null)
    setBuffering(true)
    setTime(0)
    setDuration(0)
    if (s.listId && index === 0) p.loadPlaylist({ list: s.listId, listType: "playlist" })
    else {
      // With a playlist, attempt 0 is the playlist and later attempts are its fallback videos.
      const id = s.videoIds[s.listId ? index - 1 : index]
      if (id) p.loadVideoById(id)
    }
  }, [])

  const tryNext = useCallback(
    (p: YTPlayer) => {
      const a = attempt.current
      if (!a) return
      const total = a.station.videoIds.length + (a.station.listId ? 1 : 0)
      if (a.index + 1 < total) {
        loadInto(p, a.station, a.index + 1)
        return
      }
      setBuffering(false)
      setPlaying(false)
      setError("YouTube won't play this one here. Try another station.")
    },
    [loadInto]
  )

  const ensurePlayer = useCallback(async (): Promise<YTPlayer> => {
    if (player.current) return player.current
    if (creating.current) return creating.current
    creating.current = loadYouTube().then(
      (YT) =>
        new Promise<YTPlayer>((resolve) => {
          const el = document.createElement("div")
          host.current!.replaceChildren(el)
          new YT.Player(el, {
            width: 200,
            height: 200,
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, origin: window.location.origin },
            events: {
              onReady: (e) => {
                player.current = e.target
                e.target.setVolume(volumeRef.current)
                if (mutedRef.current) e.target.mute()
                resolve(e.target)
              },
              onStateChange: (e) => {
                const st = e.data
                setPlaying(st === YTState.PLAYING || st === YTState.BUFFERING)
                setBuffering(st === YTState.BUFFERING)
                if (st === YTState.PLAYING) {
                  setError(null)
                  readInfo(e.target)
                  // A pasted link gets its name from YouTube the first time it plays.
                  const a = attempt.current
                  const t = e.target.getVideoData?.().title
                  if (a?.station.genre === "custom" && !a.station.name && t)
                    setCustom((c) => c.map((x) => (x.id === a.station.id ? { ...x, name: t } : x)))
                }
                // A finished video (not a playlist) starts again: it's background music.
                if (st === YTState.ENDED && !attempt.current?.station.listId) e.target.playVideo()
              },
              onError: (e) => tryNext(e.target),
            },
          })
        })
    )
    creating.current.catch(() => {
      creating.current = null
    })
    return creating.current
  }, [readInfo, tryNext])

  const playStation = useCallback(
    async (s: Station) => {
      setStationId(s.id)
      setBuffering(true)
      setTitle("")
      try {
        const p = await ensurePlayer()
        loadInto(p, s, 0)
      } catch {
        setBuffering(false)
        setError("Couldn't reach YouTube. Check your internet connection.")
      }
    },
    [ensurePlayer, loadInto]
  )

  const toggle = useCallback(() => {
    const p = player.current
    if (!p || !attempt.current || attempt.current.station.id !== station.id) {
      void playStation(station)
      return
    }
    if (playing) p.pauseVideo()
    else p.playVideo()
  }, [playing, playStation, station])

  // Time for the progress bar (only matters for videos with an end).
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => {
      const p = player.current
      if (!p) return
      setTime(p.getCurrentTime?.() ?? 0)
      const d = p.getDuration?.() ?? 0
      setDuration(d)
    }, 500)
    return () => window.clearInterval(t)
  }, [playing])

  useEffect(() => () => player.current?.destroy(), [])

  const value: MusicState = {
    stations,
    station,
    playing,
    buffering,
    title,
    live,
    time,
    duration,
    volume,
    muted,
    error,
    videoId,
    toggle,
    playStation: (s) => void playStation(s),
    next: () => player.current?.nextVideo(),
    previous: () => player.current?.previousVideo(),
    seek: (seconds) => {
      player.current?.seekTo(seconds, true)
      setTime(seconds)
    },
    setVolume: (v) => {
      setVolumeState(v)
      player.current?.setVolume(v)
      if (v > 0 && mutedRef.current) {
        setMuted(false)
        player.current?.unMute()
      }
    },
    toggleMute: () => {
      const m = !mutedRef.current
      setMuted(m)
      if (m) player.current?.mute()
      else player.current?.unMute()
    },
    addCustom: (s) => {
      const st: Station = { ...s, id: `custom-${Date.now().toString(36)}`, genre: "custom" }
      setCustom((c) => [...c, st])
      return st
    },
    removeCustom: (id) => {
      setCustom((c) => c.filter((s) => s.id !== id))
      if (stationId === id) {
        player.current?.stopVideo()
        attempt.current = null
        setPlaying(false)
        setStationId(STATIONS[0].id)
      }
    },
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* The YouTube iframe: invisible, but kept in the viewport so the browser doesn't throttle it. */}
      <div
        ref={host}
        aria-hidden
        className="pointer-events-none fixed right-0 bottom-0 -z-10 size-[200px] overflow-hidden opacity-0"
      />
    </Ctx.Provider>
  )
}
