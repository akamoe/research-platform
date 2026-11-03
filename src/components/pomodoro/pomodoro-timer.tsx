import { useState } from "react"
import { PauseIcon, PlayIcon, RotateCcwIcon, SkipForwardIcon, TimerIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { PHASES, usePomodoro, type Phase, type PomodoroSettings } from "./pomodoro-provider"

// The Pomodoro timer in the sidebar footer, above the music player and laid out like it.

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
const label = (p: Phase) => PHASES.find((x) => x.id === p)!.label

export function PomodoroTimer() {
  const t = usePomodoro()
  const [open, setOpen] = useState(false)
  const started = t.running || t.left < t.total
  const pct = t.total ? 100 - (t.left / t.total) * 100 : 0
  const sub = t.phase === "focus" ? `Session ${t.round + 1} of ${t.settings.every}` : label(t.phase)

  return (
    <div data-slot="pomodoro" className="px-2 pt-1">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          className="relative shrink-0 rounded-full"
          aria-label={t.running ? "Pause timer" : "Start timer"}
          onClick={t.running ? t.pause : t.start}
        >
          {/* A ring that fills as the phase goes by. */}
          {started && (
            <svg viewBox="0 0 36 36" className="pointer-events-none absolute -inset-px size-[calc(100%+2px)] -rotate-90" aria-hidden>
              <circle
                cx="18"
                cy="18"
                r="17"
                fill="none"
                strokeWidth="2"
                pathLength={100}
                strokeDasharray={`${pct} 100`}
                className={cn(t.phase === "focus" ? "stroke-primary" : "stroke-muted-foreground")}
              />
            </svg>
          )}
          {t.running ? <PauseIcon className="fill-current" /> : <PlayIcon className="ml-0.5 fill-current" />}
        </Button>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-baseline gap-1.5 text-sm">
            <span className="tabular-nums" data-testid="pomodoro-time">
              {clock(t.left)}
            </span>
            <span className="truncate text-muted-foreground">{t.phase === "focus" ? "Focus" : "Break"}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {sub}
            {t.today.count > 0 && ` · ${t.today.count} today`}
          </div>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label="Timer settings">
                  <TimerIcon />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Pomodoro timer</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="start" className="w-72 p-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="w-full"
              value={t.phase}
              onValueChange={(v) => v && t.setPhase(v as Phase)}
              aria-label="Phase"
            >
              {PHASES.map((p) => (
                <ToggleGroupItem key={p.id} value={p.id} className="flex-1 text-xs">
                  {p.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="mt-2 flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={t.reset} disabled={!started}>
                <RotateCcwIcon /> Restart
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={t.skip}>
                <SkipForwardIcon /> Skip to {t.phase === "focus" ? "break" : "focus"}
              </Button>
            </div>
            <Separator className="my-3" />
            <div className="grid grid-cols-4 gap-2">
              <Minutes id="focus" label="Focus" t={t} />
              <Minutes id="short" label="Short" t={t} />
              <Minutes id="long" label="Long" t={t} />
              <Minutes id="every" label="Long after" t={t} max={12} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Minutes; a long break after every {t.settings.every} focus sessions.
            </p>
            <div className="mt-3 space-y-2">
              <Check id="autoStart" label="Start the next one by itself" t={t} />
              <Check id="sound" label="Play a chime at the end" t={t} />
              <Check id="musicOnBreaks" label="Pause the music during breaks" t={t} />
            </div>
            {t.today.minutes > 0 && (
              <>
                <Separator className="my-3" />
                <p className="text-xs text-muted-foreground">
                  Today: {t.today.count} {t.today.count === 1 ? "session" : "sessions"}, {t.today.minutes} minutes of focus.
                </p>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

type T = ReturnType<typeof usePomodoro>

function Minutes({ id, label, t, max = 180 }: { id: "focus" | "short" | "long" | "every"; label: string; t: T; max?: number }) {
  const [text, setText] = useState(String(t.settings[id]))
  const commit = () => {
    const n = Math.round(Number(text))
    if (Number.isFinite(n) && n >= 1 && n <= max) t.update({ [id]: n } as Partial<PomodoroSettings>)
    else setText(String(t.settings[id]))
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={`pomo-${id}`} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`pomo-${id}`}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-8 px-2 tabular-nums"
      />
    </div>
  )
}

function Check({ id, label, t }: { id: "autoStart" | "sound" | "musicOnBreaks"; label: string; t: T }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={`pomo-${id}`} checked={t.settings[id]} onCheckedChange={(v) => t.update({ [id]: v === true })} />
      <Label htmlFor={`pomo-${id}`} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  )
}
