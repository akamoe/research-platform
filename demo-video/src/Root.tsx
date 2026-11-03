import { Composition } from "remotion";
import { FOLIO_DEMO_FRAMES, FolioDemo } from "./FolioDemo";

export const RemotionRoot: React.FC = () => (
  <Composition id="FolioDemo" component={FolioDemo} durationInFrames={FOLIO_DEMO_FRAMES} fps={30} width={1920} height={1080} />
);
