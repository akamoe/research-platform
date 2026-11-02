import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUpIcon, FileTextIcon, HistoryIcon, PlusIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, streamChat, type ChatMessage, type ChatMeta, type PublicSettings } from "@/lib/api"
import { ModelPicker, rememberModel, savedModel, type ModelChoice } from "./model-picker"
import { ChatSources, SourceCite, parseSourceLink } from "./source-cite"

interface Props {
  projectId: string
  settings: PublicSettings
  openNotePath?: string
  /** Scope this chat to one uploaded paper: the model reads the paper, and history only shows its chats. */
  source?: { id: string; title: string }
  onClose?: () => void
  onOpenSettings: () => void
}

export function ChatPanel({ projectId, settings, openNotePath, source, onClose, onOpenSettings }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatId, setChatId] = useState<string | undefined>()
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [useNote, setUseNote] = useState(true)
  const [history, setHistory] = useState<ChatMeta[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [model, setModel] = useState<ModelChoice | null>(() => savedModel(settings))
  // Forget a model whose provider no longer has a key.
  const usable = model && settings.providers.some((p) => p.id === model.provider && p.configured) ? model : null
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const anyKey = settings.providers.some((p) => p.configured)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [messages])

  // A paper's chat picks up where the student left off; so does the project chat after opening a paper.
  const lastKey = `rp-chat:${projectId}`
  useEffect(() => {
    if (!source) {
      const last = sessionStorage.getItem(lastKey)
      if (last) openChat(last)
      return
    }
    api.chats(projectId, source.id).then((list) => list[0] && openChat(list[0].id), () => {})
  }, [projectId, source?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (source) return
    if (chatId) sessionStorage.setItem(lastKey, chatId)
    else sessionStorage.removeItem(lastKey)
  }, [chatId, source, lastKey])

  const chooseModel = (m: ModelChoice) => {
    setModel(m)
    rememberModel(m).catch(() => {})
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    if (!usable) {
      if (anyKey) setPickerOpen(true)
      else onOpenSettings()
      return
    }
    const model = usable
    const next: ChatMessage[] = [...messages, { role: "user", content: text }]
    setMessages([...next, { role: "assistant", content: "" }])
    setInput("")
    setBusy(true)
    abort.current = new AbortController()
    try {
      const res = await streamChat(
        projectId,
        {
          chatId,
          provider: model.provider,
          model: model.model,
          messages: next,
          openNotePath: useNote ? openNotePath : undefined,
          sourceId: source?.id,
        },
        (reply) => setMessages([...next, { role: "assistant", content: reply }]),
        abort.current.signal,
      )
      setChatId(res.chatId)
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message)
        setMessages((m) => (m.at(-1)?.content ? m : m.slice(0, -1)))
      }
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  const newChat = () => {
    abort.current?.abort()
    setMessages([])
    setChatId(undefined)
  }

  const openChat = async (id: string) => {
    try {
      const c = await api.chat(projectId, id)
      setMessages(c.messages)
      setChatId(c.id)
    } catch (err) {
      if (id === sessionStorage.getItem(lastKey)) sessionStorage.removeItem(lastKey)
      else toast.error((err as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        {anyKey ? (
          <ModelPicker settings={settings} value={usable} onChange={chooseModel} open={pickerOpen} onOpenChange={setPickerOpen} />
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenSettings}>
            Add an API key
          </Button>
        )}
        <div className="ml-auto flex items-center">
          <DropdownMenu onOpenChange={(o) => o && api.chats(projectId, source?.id).then(setHistory).catch(() => {})}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7">
                    <HistoryIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Past chats</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {source ? "Past chats about this paper" : "Past chats"}
              </DropdownMenuLabel>
              {history.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">None yet</div>}
              {history.slice(0, 20).map((h) => (
                <DropdownMenuItem key={h.id} onSelect={() => openChat(h.id)} className="group">
                  <span className="truncate">{h.title}</span>
                  <button
                    className="ml-auto opacity-0 group-hover:opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      api.deleteChat(projectId, h.id).then(() => {
                        setHistory((x) => x.filter((c) => c.id !== h.id))
                        if (h.id === chatId) newChat()
                      })
                    }}
                    aria-label="Delete chat"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              {history.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={newChat}>
                <PlusIcon /> New chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={newChat}>
                <PlusIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
          {onClose && (
            <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close chat">
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-10 space-y-2 px-2 text-sm text-muted-foreground">
            {source ? (
              <>
                <p className="font-medium text-foreground">Ask about this paper.</p>
                <p>
                  What's the method? Do the results support the claims? What does a term mean? Answers cite page
                  numbers, and the chat is saved with the paper.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">Think out loud here.</p>
                <p>
                  Ask about your papers, test an argument, or get feedback on what you've written. Answers link to
                  the pages they draw on. The assistant will challenge and explain, but it won't write your paper for
                  you.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-8 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                  {m.content}
                </div>
              ) : (
                <div key={i} className="prose prose-sm max-w-none text-sm dark:prose-invert prose-p:my-2 prose-pre:bg-muted prose-pre:text-foreground">
                  {m.content ? (
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) =>
                          parseSourceLink(href) ? (
                            <SourceCite projectId={projectId} href={href!}>
                              {children}
                            </SourceCite>
                          ) : (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                      }}
                    >
                      {m.content}
                    </Markdown>
                  ) : (
                    <span className="inline-block size-2 animate-pulse rounded-full bg-muted-foreground" />
                  )}
                </div>
              ),
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <div className="shrink-0 p-3">
        <div className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={source ? "Ask about this paper…" : "Ask, question, or think out loud…"}
            className="block max-h-48 w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
            {!source && <ChatSources projectId={projectId} />}
            {openNotePath && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setUseNote((u) => !u)}
                    className={
                      "flex max-w-[200px] items-center gap-1 rounded px-1.5 py-0.5 text-xs " +
                      (useNote ? "bg-muted text-foreground" : "text-muted-foreground line-through")
                    }
                  >
                    <FileTextIcon className="size-3 shrink-0" />
                    <span className="truncate">{openNotePath.replace(/\.md$/, "").split("/").pop()}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{useNote ? "The assistant can read this note. Click to hide it." : "Click to let the assistant read this note"}</TooltipContent>
              </Tooltip>
            )}
            <Button
              size="icon"
              className="ml-auto size-7 rounded-full"
              onClick={busy ? () => abort.current?.abort() : send}
              disabled={!busy && !input.trim()}
              aria-label={busy ? "Stop" : "Send"}
            >
              {busy ? <SquareIcon className="size-3 fill-current" /> : <ArrowUpIcon className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
