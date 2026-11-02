import { memo, useContext, useState } from "react"
import type { NodeProps } from "@xyflow/react"
import { BookMarkedIcon, CheckIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import { ConnectDots } from "./drawing"
import { CanvasCtx, KINDS, kindOf, type CardNode } from "./shared"

export const CardNodeView = memo(function CardNodeView({ data, selected }: NodeProps<CardNode>) {
  const ctx = useContext(CanvasCtx)!
  const { card } = data
  const [editing, setEditing] = useState<string | null>(null)
  const k = kindOf(card.kind)
  const unread = !card.analyzedAt || card.updatedAt > card.analyzedAt
  const finish = () => {
    if (editing !== null && editing.trim() && editing.trim() !== card.text) ctx.edit(card.id, editing)
    setEditing(null)
  }
  return (
    <div
      className={cn(
        "flex w-[240px] flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs transition-[border-color,box-shadow]",
        selected && "border-ring ring-[3px] ring-ring/30",
        ctx.focus.has(card.id) && "border-ring ring-[3px] ring-ring/50",
      )}
      onDoubleClick={() => editing === null && setEditing(card.text)}
    >
      <ConnectDots />
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Badge asChild variant="outline" className="nodrag gap-1.5 font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              <button title="Change kind">
                <span className="size-1.5 rounded-full" style={{ background: k.color }} />
                {k.label}
              </button>
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-36">
            {KINDS.map((x) => (
              <DropdownMenuItem key={x.id} onSelect={() => ctx.setKind(card.id, x.id)}>
                <span className="size-1.5 rounded-full" style={{ background: x.color }} />
                {x.label}
                {x.id === card.kind && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {unread &&
          (ctx.reading ? (
            <LoaderCircleIcon className="ml-auto size-3 animate-spin text-muted-foreground" aria-label="Reading" />
          ) : (
            <span className="ml-auto size-1.5 rounded-full bg-muted-foreground/30" title="Not read by the AI yet" />
          ))}
      </div>
      {editing !== null ? (
        <Textarea
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              finish()
            }
            if (e.key === "Escape") setEditing(null)
            e.stopPropagation()
          }}
          className="nodrag nowheel min-h-16 resize-none px-2 py-1.5 text-sm"
        />
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{card.text}</p>
      )}
      {card.note && editing === null && (
        <p className="flex gap-1.5 border-t pt-2.5 text-xs leading-relaxed text-muted-foreground">
          <SparklesIcon className="mt-0.5 size-3 shrink-0" aria-label="AI note" />
          <span>{card.note}</span>
        </p>
      )}
      {(!!card.tags?.length || !!card.pages?.length) && editing === null && (
        <div className="flex flex-wrap items-center gap-1">
          {card.tags?.map((t) => (
            <Badge key={t} variant="secondary" className="px-1.5 font-normal text-muted-foreground">
              {t}
            </Badge>
          ))}
          {card.pages?.map((p) => (
            <Badge key={p} asChild variant="outline" className="nodrag max-w-full px-1.5 font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              <button
                title="Open in the knowledge base"
                onClick={() => navigate({ name: "project", projectId: ctx.projectId, view: "knowledge", page: p })}
              >
                <BookMarkedIcon />
                <span className="truncate">{ctx.pageTitle(p)}</span>
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
})
