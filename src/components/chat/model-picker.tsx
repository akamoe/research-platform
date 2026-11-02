import { useEffect, useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, type ProviderId, type PublicSettings } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface ModelChoice {
  provider: ProviderId
  model: string
}

const cache = new Map<ProviderId, Promise<string[]>>()
function modelsFor(id: ProviderId) {
  if (!cache.has(id)) {
    const p = api.models(id).then((r) => r.models)
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return cache.get(id)!
}
/** The model the student last picked (chat, summaries and the knowledge base share it), if its provider still has a key. */
export function savedModel(settings: PublicSettings): ModelChoice | null {
  let m: ModelChoice | null = settings.defaultModel
  try {
    m = JSON.parse(localStorage.getItem("rp-model") ?? "null") ?? m
  } catch {}
  return m && settings.providers.some((p) => p.id === m.provider && p.configured) ? m : null
}

/** Remember a picked model here and on the server, where background work reads it. */
export function rememberModel(m: ModelChoice) {
  localStorage.setItem("rp-model", JSON.stringify(m))
  return api.setDefaultModel(m.provider, m.model)
}

export function clearModelCache() {
  cache.clear()
}

export function ModelPicker({
  settings,
  value,
  onChange,
  open,
  onOpenChange: setOpen,
}: {
  settings: PublicSettings
  value: ModelChoice | null
  onChange: (v: ModelChoice) => void
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [lists, setLists] = useState<Partial<Record<ProviderId, string[] | Error>>>({})
  const configured = settings.providers.filter((p) => p.configured)

  useEffect(() => {
    if (!open) return
    for (const p of configured) {
      if (lists[p.id]) continue
      modelsFor(p.id).then(
        (models) => setLists((l) => ({ ...l, [p.id]: models })),
        (err: Error) => setLists((l) => ({ ...l, [p.id]: err })),
      )
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 max-w-[220px] gap-1 px-2 text-xs font-normal text-muted-foreground">
          <span className="truncate">{value ? value.model : "Choose a model"}</span>
          <ChevronsUpDownIcon className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No models found.</CommandEmpty>
            {configured.map((p) => {
              const list = lists[p.id]
              return (
                <CommandGroup key={p.id} heading={p.label}>
                  {list === undefined && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
                  {list instanceof Error && (
                    <div className="px-2 py-1.5 text-xs text-destructive">{list.message}</div>
                  )}
                  {Array.isArray(list) &&
                    list.map((m) => (
                      <CommandItem
                        key={`${p.id}:${m}`}
                        value={`${p.label} ${m}`}
                        onSelect={() => {
                          onChange({ provider: p.id, model: m })
                          setOpen(false)
                        }}
                      >
                        <span className="truncate">{m}</span>
                        <CheckIcon
                          className={cn(
                            "ml-auto size-3.5",
                            value?.provider === p.id && value.model === m ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
