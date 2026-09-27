import { describe, expect, it } from 'vitest';
import { compareWithScript } from '@/lib/recording/compare';
import { SEGMENT_ROLES, type Script } from '@/lib/script/model';

const texts = ['你敢不敢让AI骂你的方案', '大多数人只让它帮忙写', '换个说法让它当评审', '模型会顺着你说', '所以要逼它挑刺', '方案是被骂出来的'];
const script: Script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: texts[i] })) };
const line = (text: string, i: number) => ({ startSec: i * 3, endSec: i * 3 + 3, text });

describe('compareWithScript', () => {
  it('reports nothing when the recording follows the script', () => {
    const r = compareWithScript(script, texts.map(line));
    expect(r.adlibCount).toBe(0);
    expect(r.skippedCount).toBe(0);
  });

  it('flags a line that is not in the script as adlib', () => {
    const r = compareWithScript(script, [...texts.map(line), line('对了上周我还去爬了趟山', 6)]);
    expect(r.lines.at(-1)).toMatchObject({ adlib: true });
    expect(r.adlibCount).toBe(1);
  });

  it('flags a segment that was never spoken as skipped', () => {
    const spoken = texts.filter((_, i) => i !== 3).map(line);
    const r = compareWithScript(script, spoken);
    expect(r.segments.find((s) => s.id === 's4')).toMatchObject({ skipped: true, role: 'fact' });
    expect(r.skippedCount).toBe(1);
  });

  it('ignores punctuation and spacing differences', () => {
    const s: Script = { segments: script.segments.map((seg, i) => (i === 0 ? { ...seg, text: 'GPT-4o 涨价了，你慌不慌？' } : seg)) };
    const r = compareWithScript(s, [line('GPT 4o涨价了 你慌不慌', 0), ...texts.slice(1).map((t, i) => line(t, i + 1))]);
    expect(r.lines[0].adlib).toBe(false);
    expect(r.adlibCount).toBe(0);
  });
});
