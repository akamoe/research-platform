import { useState } from "react"
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { clearModelCache } from "@/components/chat/model-picker"
import { ThemePicker } from "@/components/theme-picker"
import { BackupSettings } from "@/components/backups"
import { UpdateSettings } from "@/components/updates"
import { useTheme } from "@/hooks/use-theme"
import { api, type ProviderStatus, type PublicSettings } from "@/lib/api"
import { cn } from "@/lib/utils"

const KEY_HELP: Record<string, string> = {
  openai: "platform.openai.com/api-keys",
  anthropic: "console.anthropic.com/settings/keys",
  openrouter: "openrouter.ai/keys",
  "opencode-go": "opencode.ai (Go plan)",
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  settings: PublicSettings
  onSettings: (s: PublicSettings) => void
}) {
  const { theme, setTheme } = useTheme()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Keys are stored only on this computer and are never shown again after saving.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {settings.providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onSettings={onSettings} />
          ))}
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <Label>Appearance</Label>
          <div className="flex gap-1 rounded-md border p-0.5">
            {([
              ["light", SunIcon],
              ["dark", MoonIcon],
              ["system", MonitorIcon],
            ] as const).map(([t, Icon]) => (
              <Button
                key={t}
                variant="ghost"
                size="icon"
                className={cn("size-7", theme === t && "bg-muted")}
                onClick={() => setTheme(t)}
                aria-label={t}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <Label className="pt-2">Theme</Label>
          <ThemePicker />
        </div>
        <Separator />
        <BackupSettings open={open} />
        <Separator />
        <UpdateSettings />
      </DialogContent>
    </Dialog>
  )
}

function ProviderRow({ provider, onSettings }: { provider: ProviderStatus; onSettings: (s: PublicSettings) => void }) {
  const [key, setKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [showUrl, setShowUrl] = useState(provider.baseUrl !== provider.defaultBaseUrl)
  const [saving, setSaving] = useState(false)

  const save = async (body: { apiKey?: string; baseUrl?: string }) => {
    setSaving(true)
    try {
      onSettings(await api.saveProvider(provider.id, body))
      clearModelCache()
      setKey("")
      toast.success(`${provider.label} saved`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={`key-${provider.id}`}>{provider.label}</Label>
        {provider.configured && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckIcon className="size-3" /> key {provider.keyHint}
          </span>
        )}
        <button className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowUrl((s) => !s)}>
          {showUrl ? "Hide URL" : "Base URL"}
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim()) save({ apiKey: key })
        }}
      >
        <Input
          id={`key-${provider.id}`}
          type="password"
          autoComplete="off"
          placeholder={provider.configured ? "Replace key" : `Paste key from ${KEY_HELP[provider.id]}`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        {key.trim() ? (
          <Button type="submit" disabled={saving}>Save</Button>
        ) : provider.configured ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => save({ apiKey: "" })}>
            Remove
          </Button>
        ) : null}
      </form>
      {showUrl && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save({ baseUrl })
          }}
        >
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono text-xs" />
          {baseUrl !== provider.baseUrl && <Button type="submit" variant="secondary" disabled={saving}>Save</Button>}
        </form>
      )}
    </div>
  )
}
