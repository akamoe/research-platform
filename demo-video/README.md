# Folio demo video

The product demo for Folio, made with [Remotion](https://www.remotion.dev) and
[snapcn](https://snapcn.dev) components. This folder is separate from the app:
nothing here is imported by `src/` or `server/`.

```bash
cd demo-video
npm ci
npm run studio   # preview and edit
npm run render   # writes out/folio-demo.mp4 (1920×1080, 30 fps, ~75 s)
```

- `src/FolioDemo.tsx`: the storyboard (scenes, feature list and captions).
- `src/scenes/feature.tsx`: one feature shot (caption on the left, screenshot with a camera push on the right).
- `src/components/snap-cn/` and `src/lib/snap-cn-ui/`: snapcn components (MIT, © Sri Nath),
  copied from github.com/snapcndev/snapcn because snapcn.dev is not reachable from the
  cloud sandbox. On a normal machine `npx shadcn@latest add @snapcn/<name>` gives the same files.
- `public/screens/`: real Folio screenshots.
- To update a shot, replace its screenshot in `public/screens/` and adjust its `camera` focal point.

## Music

"Daybreak" by Tanner Helland, from https://github.com/tannerhelland/free-music,
licensed under Creative Commons Attribution 4.0 (see `public/MUSIC-LICENSE.md`).
The credit is shown on the video's end card; keep it when posting the video.
