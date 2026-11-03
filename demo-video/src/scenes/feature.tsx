import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CursorTrack, type CursorWaypoint } from "@/components/snap-cn/cursor-track";
import { type CameraMove, ScreenRecording } from "@/components/snap-cn/screen-recording";
import { BLACK, GRAY, LINE, MONO, SANS, SERIF, WHITE } from "../brand";
import { GridLines } from "./grid";

export type Feature = {
  label: string;
  title: string;
  line: string;
  image: string;
  camera: CameraMove[];
  fit?: "cover" | "contain";
  /** Cursor waypoints, given in the screenshot's own 0–1 coordinates. */
  cursor?: CursorWaypoint[];
};

// 1920×1080: caption column on the left, screenshot on the right, inside the grid lines.
const BOX = { left: 640, top: 160, width: 1200, height: 760 };
const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const FeatureShot: React.FC<{ feature: Feature; index: number; total: number }> = ({
  feature,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(frame, [delay, delay + 20], [14, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    })}px)`,
    filter: `blur(${interpolate(frame, [delay, delay + 12], [4, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
  });
  const boxIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp", easing: ease });

  const shot = (
    <AbsoluteFill style={{ backgroundColor: WHITE }}>
      <GridLines xs={[80, 640, 1840]} ys={[80, 1000]} />
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 0,
          bottom: 0,
          width: 450,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          fontFamily: SANS,
          color: BLACK,
        }}
      >
        <div style={{ ...rise(0), fontFamily: MONO, fontSize: 20, color: GRAY, letterSpacing: "0.02em", marginBottom: 22 }}>
          {String(index + 1).padStart(2, "0")} · {feature.label}
        </div>
        <div style={{ ...rise(3), fontFamily: SERIF, fontSize: 58, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
          {feature.title}
        </div>
        <div style={{ ...rise(8), fontSize: 25, lineHeight: 1.45, color: GRAY, marginTop: 22 }}>{feature.line}</div>
      </div>
      {/* progress: one segment per feature */}
      <div style={{ position: "absolute", left: 130, bottom: 120, display: "flex", gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            style={{
              width: 22,
              height: 3,
              borderRadius: 2,
              background: i < index ? BLACK : i === index ? BLACK : LINE,
              opacity: i === index ? interpolate(frame, [0, 12], [0.3, 1], { extrapolateRight: "clamp" }) : 1,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          ...BOX,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: WHITE,
          border: `1px solid ${LINE}`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 24px 60px -24px rgba(0,0,0,0.18)",
          opacity: boxIn,
          transform: `translateY(${(1 - boxIn) * 24}px)`,
        }}
      >
        <ScreenRecording
          src={staticFile(`screens/${feature.image}`)}
          camera={feature.camera}
          fit={feature.fit ?? "cover"}
          backdropColor={WHITE}
          entrance="none"
        />
      </div>
    </AbsoluteFill>
  );

  if (!feature.cursor) return shot;
  // CursorTrack works in frame coordinates; map screenshot coordinates into the box.
  const path = feature.cursor.map((p) => ({
    ...p,
    x: (BOX.left + p.x * BOX.width) / 1920,
    y: (BOX.top + p.y * BOX.height) / 1080,
  }));
  return (
    <CursorTrack path={path} color={BLACK} outlineColor={WHITE} ringColor={BLACK}>
      {shot}
    </CursorTrack>
  );
};
