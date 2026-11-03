// Minimal YouTube IFrame Player API loader and types (only what the music player uses).

export type YTPlayer = {
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  loadVideoById(id: string): void
  loadPlaylist(opts: { list: string; listType: "playlist"; index?: number }): void
  nextVideo(): void
  previousVideo(): void
  setVolume(v: number): void
  getVolume(): number
  mute(): void
  unMute(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getVideoData(): { title?: string; author?: string; video_id?: string; isLive?: boolean }
  destroy(): void
}

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: number | string
      height?: number | string
      host?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (e: { target: YTPlayer }) => void
        onStateChange?: (e: { data: number; target: YTPlayer }) => void
        onError?: (e: { data: number; target: YTPlayer }) => void
      }
    }
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

export const YTState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const

let loading: Promise<YTNamespace> | null = null

export function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT!)
    }
    const s = document.createElement("script")
    s.src = "https://www.youtube.com/iframe_api"
    s.async = true
    s.onerror = () => {
      loading = null
      reject(new Error("Couldn't reach YouTube"))
    }
    document.head.appendChild(s)
  })
  return loading
}

/** A video id or a playlist id from anything a student might paste. */
export function parseYouTube(input: string): { videoId?: string; listId?: string } | null {
  const text = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return { videoId: text }
  let url: URL
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "")
  if (host !== "youtube.com" && host !== "youtu.be" && host !== "youtube-nocookie.com") return null
  const listId = url.searchParams.get("list") ?? undefined
  let videoId: string | undefined
  if (host === "youtu.be") videoId = url.pathname.slice(1).split("/")[0]
  else if (url.searchParams.get("v")) videoId = url.searchParams.get("v")!
  else {
    const m = url.pathname.match(/^\/(?:live|embed|shorts|v)\/([A-Za-z0-9_-]{11})/)
    if (m) videoId = m[1]
  }
  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = undefined
  // Radio mixes (RD...) can't be loaded as playlists through the API; play the video instead.
  if (listId?.startsWith("RD") && videoId) return { videoId }
  if (!videoId && !listId) return null
  return { videoId, listId }
}
