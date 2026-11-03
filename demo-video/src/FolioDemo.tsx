import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CardRail } from "@/components/snap-cn/card-rail";
import { HeroLaunch } from "@/components/snap-cn/hero-launch";
import { PromptSend } from "@/components/snap-cn/prompt-send";
import { PunchLines } from "@/components/snap-cn/punch-lines";
import { TextBuild } from "@/components/snap-cn/text-build";
import { WordmarkCut } from "@/components/snap-cn/wordmark-cut";
import { SnapCnUIProvider } from "@/lib/snap-cn-ui";
import { BLACK, INK, monoTheme, MUTED, OXBLOOD, PAPER, SANS, SERIF, WHITE } from "./brand";
import { type Feature, FeatureShot } from "./scenes/feature";

const FEATURES: Feature[] = [
  {
    label: "Read",
    title: "Highlight as you read",
    line: "Colored highlights and area captures go into your notes, with a link back to the page.",
    image: "pdf-highlights.png",
    camera: [],
    cursor: [
      { at: 0, x: 1.08, y: 0.7, duration: 6 },
      { at: 14, x: 0.25, y: 0.11, duration: 20, click: true },
      { at: 46, x: 0.78, y: 0.62, duration: 22, click: true },
    ],
  },
  {
    label: "PDF text",
    title: "Text you can trust",
    line: "pdf-inspector reads every page and tells you when a PDF is only a scan.",
    image: "pdf-inspector-scan.png",
    camera: [{ at: 18, duration: 30, zoom: 1.9, x: 0.72, y: 0.12 }],
  },
  {
    label: "Chat",
    title: "Chat that cites its sources",
    line: "Ask across all your papers. Every answer points to the paper and the page.",
    image: "chat-citations.png",
    camera: [{ at: 14, duration: 30, zoom: 1.9, x: 0.86, y: 0.28 }],
  },
  {
    label: "Sources",
    title: "Bring any source",
    line: "PDFs, web pages, YouTube talks, Word files and pasted text.",
    image: "add-source.png",
    camera: [{ at: 14, duration: 30, zoom: 1.7, x: 0.5, y: 0.5 }],
  },
  {
    label: "Summary",
    title: "A summary for every source",
    line: "Key claims, methods, limits and open questions, one tab away.",
    image: "source-summary.png",
    camera: [{ at: 14, duration: 30, zoom: 1.7, x: 0.78, y: 0.45 }],
  },
  {
    label: "Search",
    title: "Search everything with ⌘K",
    line: "Find any passage in any paper or note in a keystroke.",
    image: "search.png",
    camera: [{ at: 14, duration: 30, zoom: 1.8, x: 0.5, y: 0.3 }],
  },
  {
    label: "Knowledge base",
    title: "A knowledge base that remembers",
    line: "Each paper is filed into linked pages. Contradictions and gaps are flagged for you.",
    image: "knowledge-base.png",
    camera: [{ at: 14, duration: 30, zoom: 1.6, x: 0.6, y: 0.45 }],
  },
  {
    label: "Canvas",
    title: "Think on a canvas",
    line: "Lay out claims and evidence, draw arrows, sketch your argument.",
    image: "canvas-drawing.png",
    camera: [{ at: 14, duration: 40, zoom: 1.4, x: 0.42, y: 0.5 }],
  },
  {
    label: "References",
    title: "References in any style",
    line: "Add by DOI, BibTeX or RIS, cite with [@key], export in any CSL style.",
    image: "citations-export.png",
    camera: [{ at: 14, duration: 30, zoom: 1.6, x: 0.5, y: 0.45 }],
  },
  {
    label: "LaTeX",
    title: "LaTeX, built in",
    line: "Write, compile and preview your paper without leaving Folio.",
    image: "latex-editor.png",
    camera: [{ at: 14, duration: 30, zoom: 1.5, x: 0.35, y: 0.38 }],
  },
  {
    label: "Templates",
    title: "Journal templates",
    line: "IEEE, ACM, Springer, APS and more, with a preview of the first page.",
    image: "latex-template-preview.png",
    camera: [{ at: 14, duration: 30, zoom: 1.6, x: 0.55, y: 0.45 }],
  },
  {
    label: "Organize",
    title: "Folders and stars",
    line: "Organize sources and notes the way you think.",
    image: "sidebar-folders-2.png",
    fit: "contain",
    camera: [{ at: 14, duration: 40, zoom: 1.15, x: 0.5, y: 0.4 }],
  },
  {
    label: "Themes",
    title: "Make it yours",
    line: "Folio's warm paper look, or one of 40+ themes.",
    image: "folio-theme-picker.png",
    camera: [{ at: 14, duration: 30, zoom: 1.6, x: 0.6, y: 0.62 }],
  },
];

const FEATURE_FRAMES = 90;
const T = 12;
const t = linearTiming({ durationInFrames: T });

const SCENES = {
  hook: 160,
  hero: 170,
  prompt: 165,
  features: FEATURES.length * FEATURE_FRAMES,
  more: 130,
  promise: 170,
  wordmark: 66,
  end: 150,
};
export const FOLIO_DEMO_FRAMES =
  Object.values(SCENES).reduce((a, b) => a + b, 0) - T * (Object.keys(SCENES).length - 1) +
  (FEATURES.length - 1) * 0;

const Music: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <Audio
      src={staticFile("screen-saver.mp3")}
      volume={(f) =>
        1 *
        interpolate(f, [0, 20, durationInFrames - 75, durationInFrames - 5], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const o = (d: number) => interpolate(frame, [d, d + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28, opacity: o(0) }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 20,
            backgroundColor: OXBLOOD,
            color: PAPER,
            fontFamily: SERIF,
            fontSize: 66,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          F
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 120, color: INK, lineHeight: 1 }}>Folio</div>
      </div>
      <div style={{ position: "relative", width: 1400, height: 90, marginTop: 30 }}>
        <TextBuild text="Every source, every note, one folio." fontSize={44} fontWeight={400} color={MUTED} fontFamily={SERIF} />
      </div>
      <div style={{ marginTop: 40, fontSize: 28, color: INK, opacity: o(40) }}>github.com/akamoe/research-platform</div>
      <div style={{ position: "absolute", bottom: 40, fontSize: 18, color: MUTED, opacity: o(50) }}>
        Music: “Screen Saver” by Kevin MacLeod (FreePD.com, public domain)
      </div>
    </AbsoluteFill>
  );
};

const RAIL_CARDS = [
  ["source-youtube.png", "YouTube sources", "Transcript you can quote"],
  ["canvas-dark.png", "Dark mode", "Every screen, day or night"],
  ["references-select.png", "Copy many citations", "MLA, APA, Chicago and more"],
  ["latex-templates-dialog.png", "Template gallery", "Start from your journal"],
  ["knowledge-base.png", "Lint your knowledge base", "Check finds gaps"],
  ["note-toolbar.png", "Rich notes", "Markdown you own"],
].map(([img, title, note]) => ({ image: staticFile(`screens/${img}`), title, note }));

export const FolioDemo: React.FC = () => (
  <SnapCnUIProvider theme={monoTheme} mode="light">
    <AbsoluteFill style={{ backgroundColor: WHITE }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES.hook}>
          <PunchLines
            script="Every paper / starts with a question. | You do / the research. | Folio keeps it / all in one place."
            styles="slide,punch,slide"
            sizes="1,1.5,1"
            holds="52,46,62"
            accentBeat={0}
            ground={WHITE}
            ink={BLACK}
            fontFamily={SERIF}
            fontWeight={400}
            letterSpacing="-0.03em"
            fontSize={96}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.hero}>
          <SnapCnUIProvider mode="dark">
            <HeroLaunch
              heading="Meet Folio"
              image1={staticFile("screens/chat-citations.png")}
              image2={staticFile("screens/latex-editor.png")}
              mode="dark"
              fontFamily={SERIF}
            />
          </SnapCnUIProvider>
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.prompt}>
          <PromptSend
            text="Do sleep spindles predict how well students remember?"
            placeholder="Ask, question, or think out loud…"
            chips=""
            accentColor="#d4d4d4"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.features}>
          <TransitionSeries>
            {FEATURES.flatMap((f, i) => [
              <TransitionSeries.Sequence key={f.image} durationInFrames={FEATURE_FRAMES + (i < FEATURES.length - 1 ? 8 : 0)}>
                <FeatureShot feature={f} index={i} total={FEATURES.length} />
              </TransitionSeries.Sequence>,
              ...(i < FEATURES.length - 1
                ? [<TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: 8 })} />]
                : []),
            ])}
          </TransitionSeries>
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.more}>
          <CardRail cards={RAIL_CARDS} heading="and many more ..." backdrop="#262626|#0a0a0a" fontFamily={SERIF} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.promise}>
          <PunchLines
            script="The AI never writes / your paper. | It helps you / think. | You do the research."
            styles="slide,slide,punch"
            sizes="1,1,1.1"
            holds="58,50,62"
            accentBeat={0}
            ground={WHITE}
            ink={BLACK}
            fontFamily={SERIF}
            fontWeight={400}
            letterSpacing="-0.03em"
            fontSize={96}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.wordmark}>
          <WordmarkCut word="Folio." dotFrom={OXBLOOD} dotTo="#c0563f" fontFamily={SERIF} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.end}>
          <EndCard />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Music />
    </AbsoluteFill>
  </SnapCnUIProvider>
);
