# Folio demo video

The product demo for Folio, made with [Remotion](https://www.remotion.dev) and
[snapcn](https://snapcn.dev) components. This folder is separate from the app:
nothing here is imported by `src/` or `server/`.

```bash
cd demo-video
npm ci
npm run studio   # preview and edit
npm run render   # writes out/folio-demo.mp4 (1920×1080, 30 fps, ~70 s)
```

- `src/FolioDemo.tsx`: the storyboard (scenes, feature list and captions).
- `src/scenes/feature.tsx`: one feature shot (caption on the left, screenshot with a camera push on the right).
- `src/components/snap-cn/` and `src/lib/snap-cn-ui/`: snapcn components (MIT, © Sri Nath),
  copied from github.com/snapcndev/snapcn because snapcn.dev is not reachable from the
  cloud sandbox. On a normal machine `npx shadcn@latest add @snapcn/<name>` gives the same files.
- `public/screens/`: real Folio screenshots.
- To update a shot, replace its screenshot in `public/screens/` and adjust its `camera` focal point.

## Look

Vercel-style: white canvas with layout grid lines, Geist Serif headlines, Geist Sans body,
Geist Mono labels (fonts from the `geist` npm package, SIL Open Font License, in
`public/fonts`). The ending keeps Folio's paper and oxblood brand.

## Music

"Screen Saver" by Kevin MacLeod, from FreePD.com (public domain, CC0). No credit is
required; the end card credits it anyway.
