import { AbsoluteFill } from "remotion";
import { LINE } from "../brand";

// Vercel-style layout lines with small crosses where they meet.
export const GridLines: React.FC<{ xs?: number[]; ys?: number[]; color?: string }> = ({
  xs = [80, 1840],
  ys = [80, 1000],
  color = LINE,
}) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {xs.map((x) => (
      <div key={`x${x}`} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: color }} />
    ))}
    {ys.map((y) => (
      <div key={`y${y}`} style={{ position: "absolute", top: y, left: 0, right: 0, height: 1, background: color }} />
    ))}
    {xs.flatMap((x) =>
      ys.map((y) => (
        <div key={`${x}-${y}`} style={{ position: "absolute", left: x - 10, top: y - 10, width: 21, height: 21 }}>
          <div style={{ position: "absolute", left: 10, top: 0, width: 1, height: 21, background: "#999" }} />
          <div style={{ position: "absolute", top: 10, left: 0, height: 1, width: 21, background: "#999" }} />
        </div>
      )),
    )}
  </AbsoluteFill>
);
