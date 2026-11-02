import { KEYS } from "platejs"
import { ParagraphPlugin, createPlatePlugin } from "platejs/react"
import {
  BlockquoteRules,
  BoldRules,
  CodeRules,
  HeadingRules,
  HighlightRules,
  HorizontalRuleRules,
  ItalicRules,
  MarkComboRules,
  StrikethroughRules,
} from "@platejs/basic-nodes"
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HighlightPlugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react"
import { BulletedListRules, OrderedListRules, TaskListRules } from "@platejs/list"
import { ListPlugin } from "@platejs/list/react"
import { IndentPlugin } from "@platejs/indent/react"
import { LinkPlugin } from "@platejs/link/react"
import { CodeBlockRules } from "@platejs/code-block"
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react"
import { MarkdownPlugin, type MdNodeParser } from "@platejs/markdown"
import { ImagePlugin } from "@platejs/media/react"
import remarkGfm from "remark-gfm"
import * as N from "./nodes"

const headingOpts = { inputRules: [HeadingRules.markdown()], rules: { break: { empty: "reset" as const } } }
const blockTargets = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock]

/**
 * Images keep their size in plain markdown the way Obsidian does it: `![caption|320](url)`.
 */
const SIZED_ALT = /^(.*?)\s*\|\s*(\d{2,4})$/
const imageRule: MdNodeParser<"img"> = {
  deserialize: (node) => {
    const sized = SIZED_ALT.exec(node.alt ?? "")
    return {
      type: KEYS.img,
      url: node.url,
      caption: [{ text: sized ? sized[1] : (node.alt ?? "") }],
      ...(node.title && { title: node.title }),
      ...(sized && { width: Number(sized[2]) }),
      children: [{ text: "" }],
    }
  },
  serialize: (node) => {
    const text = (node.caption ?? []).map((c) => ("text" in c ? String(c.text) : "")).join("")
    const width = typeof node.width === "number" ? `|${Math.round(node.width)}` : ""
    // Same shape as Plate's own rule: the image sits in its own paragraph.
    return {
      type: "paragraph",
      children: [
        {
          type: "image",
          url: node.url,
          title: typeof node.title === "string" ? node.title : undefined,
          alt: text + width || undefined,
        },
      ],
    } as unknown as ReturnType<NonNullable<MdNodeParser<"img">["serialize"]>>
  },
}

/** A highlight or capture copied from a PDF pastes as a quote or figure with its link back. */
const HighlightPastePlugin = createPlatePlugin({ key: "highlightPaste" }).overrideEditor(
  ({ editor, tf: { insertData } }) => ({
    transforms: {
      insertData(data) {
        const text = data.getData("text/plain")
        if (/\]\(#hl\/|"hl\//.test(text)) {
          const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(text)
          if (nodes.length) {
            // As new blocks after the current one (replacing it if it's empty), never inside it.
            const top = editor.selection?.anchor.path[0]
            if (top === undefined) {
              editor.tf.insertNodes(nodes, { at: [editor.children.length], select: true })
              return
            }
            const empty = editor.api.string([top]) === "" && editor.children[top].type !== KEYS.img
            editor.tf.withoutNormalizing(() => {
              editor.tf.insertNodes(nodes, { at: [top + 1], select: true })
              if (empty) editor.tf.removeNodes({ at: [top] })
            })
            return
          }
        }
        insertData(data)
      },
    },
  }),
)

/** Markdown-first editing: type `# `, `- `, `> `, `**bold**` and it formats. No toolbars. */
export const editorPlugins = [
  ParagraphPlugin.withComponent(N.ParagraphElement),
  H1Plugin.configure({ ...headingOpts, node: { component: N.H1Element } }),
  H2Plugin.configure({ ...headingOpts, node: { component: N.H2Element } }),
  H3Plugin.configure({ ...headingOpts, node: { component: N.H3Element } }),
  H4Plugin.configure({ ...headingOpts, node: { component: N.H4Element } }),
  H5Plugin.configure({ ...headingOpts, node: { component: N.H5Element } }),
  H6Plugin.configure({ ...headingOpts, node: { component: N.H6Element } }),
  BlockquotePlugin.configure({ inputRules: [BlockquoteRules.markdown()], node: { component: N.BlockquoteElement } }),
  HorizontalRulePlugin.configure({
    inputRules: [HorizontalRuleRules.markdown({ variant: "-" })],
    node: { component: N.HrElement },
  }),
  BoldPlugin.configure({
    inputRules: [
      BoldRules.markdown({ variant: "*" }),
      BoldRules.markdown({ variant: "_" }),
      MarkComboRules.markdown({ variant: "boldItalic" }),
    ],
    shortcuts: { toggle: { keys: "mod+b" } },
  }),
  ItalicPlugin.configure({
    inputRules: [ItalicRules.markdown({ variant: "*" }), ItalicRules.markdown({ variant: "_" })],
    shortcuts: { toggle: { keys: "mod+i" } },
  }),
  UnderlinePlugin,
  StrikethroughPlugin.configure({ inputRules: [StrikethroughRules.markdown()], shortcuts: { toggle: { keys: "mod+shift+x" } } }),
  CodePlugin.configure({ inputRules: [CodeRules.markdown()], node: { component: N.CodeLeaf }, shortcuts: { toggle: { keys: "mod+e" } } }),
  HighlightPlugin.configure({
    inputRules: [HighlightRules.markdown({ variant: "==" })],
    node: { component: N.HighlightLeaf },
    shortcuts: { toggle: { keys: "mod+shift+h" } },
  }),
  LinkPlugin.withComponent(N.LinkElement),
  CodeBlockPlugin.configure({ inputRules: [CodeBlockRules.markdown({ on: "match" })], node: { component: N.CodeBlockElement } }),
  CodeLinePlugin.withComponent(N.CodeLineElement),
  CodeSyntaxPlugin,
  ImagePlugin.configure({ node: { component: N.ImageElement } }),
  IndentPlugin.configure({ inject: { targetPlugins: blockTargets }, options: { offset: 24 } }),
  ListPlugin.configure({
    inputRules: [
      BulletedListRules.markdown({ variant: "-" }),
      BulletedListRules.markdown({ variant: "*" }),
      OrderedListRules.markdown({ variant: "." }),
      TaskListRules.markdown({ checked: false }),
      TaskListRules.markdown({ checked: true }),
    ],
    inject: { targetPlugins: blockTargets },
    render: { belowNodes: N.BlockList },
  }),
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [remarkGfm],
      remarkStringifyOptions: { bullet: "-", emphasis: "*" },
      rules: { img: imageRule },
    },
  }),
  HighlightPastePlugin,
]
