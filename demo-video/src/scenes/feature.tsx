import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CursorTrack, type CursorWaypoint } from "@/components/snap-cn/cursor-track";
import { type CameraMove, ScreenRecording } from "@/components/snap-cn/screen-recording";
import { BORDER, CARD, INK, MUTED, OXBLOOD, PAPER, SANS, SERIF } from "../brand";

export type Feature = {
  title: string;
  line: string;
  image: string;
  camera: CameraMove[];
  fit?: "cover" | "contain";
  /** Cursor waypoints, given in the screenshot's own 0–1 coordinates. */
  cursor?: CursorWaypoint[];
};

// Layout at 1920×1080: caption column on the left, screenshot on the right.
const BOX = { left: 600, top: 150, width: 1220, height: 780 };

const ease = Easing.bezier(0.2, 0.7, 0.2, 1);

export const FeatureShot: React.FC<{ feature: Feature; index: number; total: number }> = ({
  feature,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(frame, [delay, delay + 18], [18, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    })}px)`,
  });
  const boxIn = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp", easing: ease });

  const shot = (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 0,
          bottom: 0,
          width: 440,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          fontFamily: SANS,
          color: INK,
        }}
      >
        <div style={{ ...rise(2), fontSize: 22, color: OXBLOOD, fontWeight: 500, marginBottom: 18 }}>
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>
        <div style={{ ...rise(5), fontFamily: SERIF, fontSize: 60, lineHeight: 1.08, fontWeight: 400 }}>
          {feature.title}
        </div>
        <div style={{ ...rise(10), fontSize: 27, lineHeight: 1.4, color: MUTED, marginTop: 24 }}>
          {feature.line}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          ...BOX,
          borderRadius: 18,
          overflow: "hidden",
          backgroundColor: CARD,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 30px 80px -30px rgba(60, 30, 20, 0.35)",
          opacity: boxIn,
          transform: `translateY(${(1 - boxIn) * 30}px) scale(${0.97 + boxIn * 0.03})`,
        }}
      >
        <ScreenRecording
          src={staticFile(`screens/${feature.image}`)}
          camera={feature.camera}
          fit={feature.fit ?? "cover"}
          backdropColor={CARD}
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
    <CursorTrack path={path} color={INK} outlineColor={PAPER} ringColor={OXBLOOD}>
      {shot}
    </CursorTrack>
  );
};
