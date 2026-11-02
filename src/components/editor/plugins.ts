import { KEYS } from "platejs"
import { ParagraphPlugin } from "platejs/react"
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
import { MarkdownPlugin } from "@platejs/markdown"
import { ImagePlugin } from "@platejs/media/react"
import remarkGfm from "remark-gfm"
import * as N from "./nodes"

const headingOpts = { inputRules: [HeadingRules.markdown()], rules: { break: { empty: "reset" as const } } }
const blockTargets = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock]

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
  }),
  ItalicPlugin.configure({ inputRules: [ItalicRules.markdown({ variant: "*" }), ItalicRules.markdown({ variant: "_" })] }),
  UnderlinePlugin,
  StrikethroughPlugin.configure({ inputRules: [StrikethroughRules.markdown()] }),
  CodePlugin.configure({ inputRules: [CodeRules.markdown()], node: { component: N.CodeLeaf } }),
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
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm], remarkStringifyOptions: { bullet: "-", emphasis: "*" } } }),
]
