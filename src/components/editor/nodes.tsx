import type { TListElement } from "platejs"
import { isOrderedList } from "@platejs/list"
import { useTodoListElement, useTodoListElementState } from "@platejs/list/react"
import { PlateElement, PlateLeaf, type PlateElementProps, type PlateLeafProps, type RenderNodeWrapper } from "platejs/react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

export function ParagraphElement(props: PlateElementProps) {
  return <PlateElement {...props} className="m-0 px-0 py-1">{props.children}</PlateElement>
}

const headingClass = {
  h1: "mt-8 mb-2 font-heading text-3xl font-semibold tracking-tight",
  h2: "mt-7 mb-1.5 font-heading text-2xl font-semibold tracking-tight",
  h3: "mt-6 mb-1 font-heading text-xl font-semibold tracking-tight",
  h4: "mt-5 mb-1 font-heading text-lg font-semibold",
  h5: "mt-4 mb-1 font-heading text-base font-semibold",
  h6: "mt-4 mb-1 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground",
} as const

const heading = (as: keyof typeof headingClass) =>
  function Heading(props: PlateElementProps) {
    return <PlateElement as={as} {...props} className={headingClass[as]}>{props.children}</PlateElement>
  }
export const H1Element = heading("h1")
export const H2Element = heading("h2")
export const H3Element = heading("h3")
export const H4Element = heading("h4")
export const H5Element = heading("h5")
export const H6Element = heading("h6")

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement as="blockquote" {...props} className="my-2 border-l-2 pl-4 italic text-muted-foreground">
      {props.children}
    </PlateElement>
  )
}

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="py-4">
      <div contentEditable={false}>
        <hr className="h-px border-none bg-border" />
      </div>
      {props.children}
    </PlateElement>
  )
}

export function LinkElement(props: PlateElementProps) {
  const url = (props.element as { url?: string }).url
  return (
    <PlateElement
      as="a"
      {...props}
      attributes={{ ...props.attributes, href: url, target: "_blank", rel: "noreferrer" }}
      className="font-medium text-primary underline decoration-primary/40 underline-offset-4"
    >
      {props.children}
    </PlateElement>
  )
}

export function CodeBlockElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="my-2">
      <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-[13px] leading-relaxed not-italic">
        <code>{props.children}</code>
      </pre>
    </PlateElement>
  )
}
export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement {...props}>{props.children}</PlateElement>
}

export function CodeLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="code" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
      {props.children}
    </PlateLeaf>
  )
}

export function HighlightLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="mark" className="rounded-sm bg-highlight/70 px-0.5 text-inherit">
      {props.children}
    </PlateLeaf>
  )
}

/** Renders indent-based lists (from Plate's ListPlugin) as real <ul>/<ol>. */
export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return
  return (p) => <List {...p} />
}

function List(props: PlateElementProps) {
  const { listStart, listStyleType } = props.element as TListElement
  const Tag = isOrderedList(props.element) ? "ol" : "ul"
  if (listStyleType === "todo") {
    return (
      <ul className="relative m-0 list-none p-0">
        <TodoMarker {...props} />
        <li className={cn((props.element.checked as boolean) && "text-muted-foreground line-through")}>
          {props.children}
        </li>
      </ul>
    )
  }
  return (
    <Tag className="relative m-0 p-0" style={{ listStyleType }} start={listStart}>
      <li>{props.children}</li>
    </Tag>
  )
}

function TodoMarker(props: PlateElementProps) {
  const state = useTodoListElementState({ element: props.element })
  const { checkboxProps } = useTodoListElement(state)
  return (
    <div contentEditable={false}>
      <Checkbox className="absolute top-1.5 -left-6" {...checkboxProps} />
    </div>
  )
}
