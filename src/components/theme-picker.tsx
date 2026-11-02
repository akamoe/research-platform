import { useEffect, useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { useTheme } from "@/hooks/use-theme"
import { BUILTIN_THEMES, loadTweakcnThemes, parseThemeText, swatches, type ThemeStyle } from "@/lib/themes"
import { cn } from "@/lib/utils"

const isDark = () => document.documentElement.classList.contains("dark")

function Swatches({ theme }: { theme: ThemeStyle }) {
  // The default theme's colors live in CSS, so read them from the page.
  const css = getComputedStyle(document.documentElement)
  const colors =
    theme.id === BUILTIN_THEMES[0].id && !Object.keys(theme.light).length
      ? [css.getPropertyValue("--background"), css.getPropertyValue("--primary"), css.getPropertyValue("--accent")]
      : swatches(theme, isDark())
  return (
    <span className="flex shrink-0 overflow-hidden rounded-sm border">
      {colors.map((c, i) => (
        <span key={i} className="size-3.5" style={{ background: c }} />
      ))}
    </span>
  )
}

export function ThemePicker() {
  const { style, setStyle } = useTheme()
  const [open, setOpen] = useState(false)
  const [tweakcn, setTweakcn] = useState<ThemeStyle[]>([])
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState("")

  useEffect(() => {
    loadTweakcnThemes().then(setTweakcn, () => {})
  }, [])

  const item = (t: ThemeStyle) => (
    <CommandItem
      key={t.id}
      value={`${t.label} ${t.id}`}
      onSelect={() => {
        setStyle(t)
        setOpen(false)
      }}
    >
      <Swatches theme={t} />
      <span className="truncate">{t.label}</span>
      <CheckIcon className={cn("ml-auto size-3.5", style.id === t.id ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  )

  const applyPasted = () => {
    const t = parseThemeText(text)
    if (!t) {
      toast.error("No theme colors found. Copy the CSS from tweakcn's Code panel.")
      return
    }
    setStyle(t)
    setText("")
    setPasting(false)
    toast.success("Theme applied")
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="w-56 justify-between">
              <span className="flex min-w-0 items-center gap-2">
                <Swatches theme={style} />
                <span className="truncate">{style.label}</span>
              </span>
              <ChevronsUpDownIcon className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search themes" />
              <CommandList>
                <CommandEmpty>No theme found.</CommandEmpty>
                <CommandGroup>
                  {BUILTIN_THEMES.map(item)}
                  {style.id === "custom" && item(style)}
                </CommandGroup>
                {tweakcn.length > 0 && <CommandGroup heading="tweakcn">{tweakcn.map(item)}</CommandGroup>}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setPasting((p) => !p)}>
          {pasting ? "Cancel" : "Paste theme"}
        </Button>
      </div>
      {pasting && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Make a theme on{" "}
            <a href="https://tweakcn.com/editor/theme" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              tweakcn.com
            </a>
            , open Code, copy the CSS and paste it here.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={":root {\n  --background: ...;\n}\n.dark { ... }"}
            className="h-28 font-mono text-xs"
          />
          <Button size="sm" disabled={!text.trim()} onClick={applyPasted}>
            Apply
          </Button>
        </div>
      )}
    </div>
  )
}
