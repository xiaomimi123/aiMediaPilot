import { continueRender, delayRender } from 'remotion';
import inter400 from '../../pipeline/fonts/Inter-400.woff2';
import inter700 from '../../pipeline/fonts/Inter-700.woff2';
import inter900 from '../../pipeline/fonts/Inter-900.woff2';
import mono400 from '../../pipeline/fonts/JetBrainsMono-400.woff2';
import mono700 from '../../pipeline/fonts/JetBrainsMono-700.woff2';
import sc400 from '../../pipeline/fonts/NotoSansSC-400.woff2';
import sc700 from '../../pipeline/fonts/NotoSansSC-700.woff2';
import sc900 from '../../pipeline/fonts/NotoSansSC-900.woff2';

/**
 * 竖版 / 横版口播画框用的字体。族名与 tokens.ts 的 FONT / MONO 一致。
 * woff2 由 Remotion 的 webpack 打进成片, 不依赖 macOS 的苹方或 SF Mono。
 */
const faces: Array<[string, string, string]> = [
  ['MP Inter', inter400, '400'],
  ['MP Inter', inter700, '700'],
  ['MP Inter', inter900, '900'],
  ['MP JetBrains Mono', mono400, '400'],
  ['MP JetBrains Mono', mono700, '700'],
  ['MP Noto SC', sc400, '400'],
  ['MP Noto SC', sc700, '700'],
  ['MP Noto SC', sc900, '900'],
];

const handle = delayRender('bundled film fonts');
Promise.all(
  faces.map(async ([family, url, weight]) => {
    const face = new FontFace(family, `url(${url})`, { weight, style: 'normal' });
    document.fonts.add(await face.load());
  }),
)
  .then(() => continueRender(handle))
  .catch((err) => {
    console.error(err);
    continueRender(handle);
  });
