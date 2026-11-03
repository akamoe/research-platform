import { useState } from "react"
import {
  ExternalLinkIcon,
  ListMusicIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useMusic, type Station } from "./music-provider"
import { parseYouTube } from "./youtube"

// Compact study-music player for the sidebar footer. Laid out like ElevenLabs UI's
// AudioPlayer (play button, title, time and a scrub slider), driven by YouTube instead of <audio>.

function formatTime(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "0:00"
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = h ? String(m).padStart(2, "0") : String(m)
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`
}

const GROUPS: { genre: Station["genre"]; label: string }[] = [
  { genre: "lofi", label: "Lofi" },
  { genre: "classical", label: "Classical" },
  { genre: "custom", label: "Your links" },
]

export function MusicPlayer() {
  const m = useMusic()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState("")
  const [drag, setDrag] = useState<number | null>(null)
  const name = m.station.name || m.title || "YouTube link"
  const started = m.playing || m.buffering || m.time > 0
  const showProgress = started && !m.live && m.duration > 0
  const isPlaylist = Boolean(m.station.listId)
  const VolumeIcon = m.muted || m.volume === 0 ? VolumeXIcon : m.volume < 50 ? Volume1Icon : Volume2Icon

  const add = () => {
    const parsed = parseYouTube(link)
    if (!parsed) {
      toast.error("That isn't a YouTube video or playlist link")
      return
    }
    const st = m.addCustom({ name: "", videoIds: parsed.videoId ? [parsed.videoId] : [], listId: parsed.listId })
    setLink("")
    m.playStation(st)
  }

  const sub = m.error
    ? m.error
    : m.buffering && !started
      ? "Loading…"
      : started && !m.live && m.duration > 0
        ? `${formatTime(drag ?? m.time)} / ${formatTime(m.duration)}`
        : started
          ? m.title && m.title !== name
            ? m.title
            : null
          : GROUPS.find((g) => g.genre === m.station.genre)?.label

  return (
    <div data-slot="music-player" className="px-2 pt-1">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0 rounded-full"
          aria-label={m.playing ? "Pause music" : "Play music"}
          onClick={m.toggle}
        >
          {m.buffering ? (
            <Loader2Icon className="animate-spin" />
          ) : m.playing ? (
            <PauseIcon className="fill-current" />
          ) : (
            <PlayIcon className="ml-0.5 fill-current" />
          )}
        </Button>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm">{name}</div>
          <div
            className={cn(
              "flex items-center gap-1.5 truncate text-xs text-muted-foreground",
              m.error && "text-destructive"
            )}
          >
            {m.live && started && !m.error && (
              <span className="inline-flex shrink-0 items-center gap-1">
                <span className={cn("size-1.5 rounded-full bg-red-500", m.playing && "animate-pulse")} />
                Live
              </span>
            )}
            {sub && <span className="truncate">{sub}</span>}
          </div>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label="Stations">
                  <ListMusicIcon />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Stations and volume</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="start" className="w-72 p-1.5">
            <div className="max-h-80 overflow-y-auto">
              {GROUPS.map((g) => {
                const list = m.stations.filter((s) => s.genre === g.genre)
                if (!list.length) return null
                return (
                  <div key={g.genre} className="mb-1">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{g.label}</div>
                    {list.map((s) => {
                      const active = s.id === m.station.id
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "group flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                            active && "bg-accent"
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => (active ? m.toggle() : m.playStation(s))}
                          >
                            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                              {active && m.playing ? (
                                <PauseIcon className="size-3.5 fill-current" />
                              ) : (
                                <PlayIcon className="size-3.5 fill-current opacity-0 group-hover:opacity-100" />
                              )}
                            </span>
                            <span className="truncate">{s.name || "YouTube link"}</span>
                          </button>
                          {s.genre === "custom" && (
                            <button
                              type="button"
                              aria-label="Remove link"
                              className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                              onClick={() => m.removeCustom(s.id)}
                            >
                              <XIcon className="size-3.5" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <form
              className="flex gap-1.5 p-1"
              onSubmit={(e) => {
                e.preventDefault()
                add()
              }}
            >
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Paste a YouTube link or playlist"
                className="h-8 text-sm"
              />
              <Button type="submit" size="icon-sm" variant="outline" aria-label="Add link" disabled={!link.trim()}>
                <PlusIcon />
              </Button>
            </form>
            <Separator className="my-1" />
            <div className="flex items-center gap-2 px-1 py-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label={m.muted ? "Unmute" : "Mute"}
                onClick={m.toggleMute}
              >
                <VolumeIcon />
              </Button>
              <Slider
                value={[m.muted ? 0 : m.volume]}
                max={100}
                step={1}
                aria-label="Volume"
                onValueChange={([v]) => m.setVolume(v)}
              />
              {isPlaylist && (
                <>
                  <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Previous" onClick={m.previous}>
                    <SkipBackIcon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Next" onClick={m.next}>
                    <SkipForwardIcon />
                  </Button>
                </>
              )}
              {m.videoId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" asChild>
                      <a
                        href={`https://www.youtube.com/watch?v=${m.videoId}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open on YouTube"
                      >
                        <ExternalLinkIcon />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Open on YouTube</TooltipContent>
                </Tooltip>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {showProgress && (
        <Slider
          className="mt-2 mb-1 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-track]]:h-1"
          value={[drag ?? m.time]}
          max={m.duration}
          step={1}
          aria-label="Seek"
          onValueChange={([v]) => setDrag(v)}
          onValueCommit={([v]) => {
            m.seek(v)
            setDrag(null)
          }}
        />
      )}
    </div>
  )
}
