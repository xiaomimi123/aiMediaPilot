import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { renderShotToClip } from '@/lib/video-production/shot-renderer';
import { probeVideo } from '@/lib/video/ffmpeg';

const FIXTURE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; }
  #stage { width: 1920px; height: 1080px; background: #ff0000; }
</style>
</head>
<body>
<div id="stage"></div>
<script src="gsap.min.js"></script>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.to('#stage', { duration: 3, backgroundColor: '#0000ff', ease: 'none' });
  window.__timelines = window.__timelines || {};
  window.__timelines['shot'] = tl;
</script>
</body>
</html>`;

describe('renderShotToClip', () => {
  it(
    '真实渲染一个 3 秒的暂停态 GSAP 时间线为 mp4 clip',
    async () => {
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-render-'));
      const outputClipPath = path.join(workDir, 'out.mp4');

      await renderShotToClip({
        html: FIXTURE_HTML,
        durationMs: 3000,
        fps: 8,
        workDir,
        outputClipPath,
      });

      const stat = await fs.stat(outputClipPath);
      expect(stat.size).toBeGreaterThan(0);

      const probeResult = await probeVideo(outputClipPath);
      expect(probeResult.durationSec).toBeGreaterThan(2.5);
      expect(probeResult.durationSec).toBeLessThan(3.5);
    },
    30000,
  );
});
