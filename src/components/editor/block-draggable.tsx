import { DndPlugin, useDraggable, useDropLine } from "@platejs/dnd"
import { GripVerticalIcon } from "lucide-react"
import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import { type PlateElementProps, type RenderNodeWrapper } from "platejs/react"
import { cn } from "@/lib/utils"

/** A grip to the left of each block: drag it to move the block (and a list item's children go with it). */
const BlockDraggable: RenderNodeWrapper = ({ path, editor }) => {
  if (path.length !== 1 || editor.dom.readOnly) return
  return (props) => <Draggable {...props} />
}

function Draggable(props: PlateElementProps) {
  const { isDragging, nodeRef, previewRef, handleRef } = useDraggable({ element: props.element })
  return (
    <div className={cn("group/block relative", isDragging && "opacity-50")}>
      <div
        contentEditable={false}
        className="absolute top-0 -left-7 flex h-[1.75em] items-center opacity-0 transition-opacity group-hover/block:opacity-100"
      >
        <button
          ref={handleRef}
          type="button"
          tabIndex={-1}
          aria-label="Drag to move"
          title="Drag to move"
          className="flex h-6 w-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </div>
      <div ref={previewRef} contentEditable={false} className="absolute -left-0 hidden w-full" />
      <div ref={nodeRef} className="relative">
        {props.children}
        <DropLine />
      </div>
    </div>
  )
}

function DropLine() {
  const { dropLine } = useDropLine()
  if (!dropLine) return null
  return (
    <div
      contentEditable={false}
      className={cn("pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary/50", dropLine === "top" ? "-top-px" : "-bottom-px")}
    />
  )
}

export const DragPlugin = DndPlugin.configure({
  options: { enableScroller: true },
  render: {
    aboveNodes: BlockDraggable,
    aboveSlate: ({ children }) => <DndProvider backend={HTML5Backend}>{children}</DndProvider>,
  },
})
