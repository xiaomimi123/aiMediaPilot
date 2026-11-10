import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/** 随仓库分发的 OFL 字体。渲染前由流水线复制到 build/<slug>/public/fonts。 */
export const SANS = '"Inter", "Noto Sans Symbols 2", "Noto Sans Symbols", "STIX Two Math", "Noto Sans SC", "PingFang SC", sans-serif';
export const MONO = '"JetBrains Mono", "Noto Sans Symbols 2", "Noto Sans Symbols", "STIX Two Math", "Noto Sans SC", monospace';
export const NUM = '"Inter", "Noto Sans Symbols 2", "STIX Two Math", "Noto Sans SC", sans-serif';

const faces: { family: string; file: string; weights: string[] }[] = [
  { family: "Inter", file: "Inter-400.woff2", weights: ["400"] },
  { family: "Inter", file: "Inter-700.woff2", weights: ["700"] },
  { family: "Inter", file: "Inter-900.woff2", weights: ["900"] },
  { family: "JetBrains Mono", file: "JetBrainsMono-400.woff2", weights: ["400"] },
  { family: "JetBrains Mono", file: "JetBrainsMono-700.woff2", weights: ["700"] },
  { family: "Noto Sans SC", file: "NotoSansSC-400.woff2", weights: ["400"] },
  { family: "Noto Sans SC", file: "NotoSansSC-700.woff2", weights: ["700"] },
  { family: "Noto Sans SC", file: "NotoSansSC-900.woff2", weights: ["900"] },
  { family: "Noto Sans Symbols", file: "Symbols.woff2", weights: ["400", "700", "900"] },
  { family: "Noto Sans Symbols 2", file: "Symbols2.woff2", weights: ["400", "700", "900"] },
  { family: "STIX Two Math", file: "Math.woff2", weights: ["400", "700", "900"] },
];

for (const face of faces) {
  for (const weight of face.weights) {
    loadFont({ family: face.family, url: staticFile(`fonts/${face.file}`), weight, display: "block" });
  }
}
