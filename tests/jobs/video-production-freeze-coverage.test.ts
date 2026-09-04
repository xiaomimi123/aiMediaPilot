import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * **每一个「产出新成片并落库」的出口都必须复检静止。**
 *
 * 这条不是理论洁癖, 是真机撞出来的: reportFreeze 第一版只接在三条交付链的完成处,
 * 而「按新版面重新合成」(handleRecompose)和「包装段」是另外两个出口 —— 它们各自
 * 产出一份**新的**成片文件、各自 setStatus 落库, 却都绕过了复检。后果是页面上挂着
 * 一个看着有效的静止数字, 而它描述的那条片子已经不存在了。真机复现: recompose 跑完,
 * 库里 freezeReport 的 checkedAt 还是几小时前补量那次。
 *
 * 逐个跑一遍 worker 太贵(要 Redis + ffmpeg + 真实素材), 所以这里用源码断言守门:
 * 凡是写 previewPath / masterPath 的 setStatus 调用, 同一次调用里必须带 freezeReport。
 * 这守不住语义, 但守得住**遗漏** —— 而遗漏正是这里出过的错。
 */

const SRC = path.join(process.cwd(), 'src/jobs/workers/video-production-worker.ts');

describe('静止复检的覆盖面', () => {
  const src = readFileSync(SRC, 'utf-8');

  /** 把 setStatus(...) 的完整调用文本抠出来(按括号配对, 不用正则硬啃嵌套)。 */
  function setStatusCalls(text: string): string[] {
    const out: string[] = [];
    const needle = 'setStatus(';
    let i = text.indexOf(needle);
    while (i !== -1) {
      let depth = 0;
      let j = i + needle.length - 1;
      for (; j < text.length; j++) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out.push(text.slice(i, j + 1));
      i = text.indexOf(needle, j);
    }
    return out;
  }

  const calls = setStatusCalls(src);

  it('抠得出 setStatus 调用 —— 抠不到的话下面的断言会假通过', () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it('每一处写 previewPath/masterPath 的 setStatus 都同时写 freezeReport', () => {
    const 落成片的 = calls.filter(
      (c) => /previewPath|masterPath|\[outputField\]/.test(c),
    );
    // 三十期 Task 3: 旧渲染层(三条旧 handler + 文字叠加层 + 成片包装段)删除后,
    // 产出新成片并落库的出口从 4 处收窄到 3 处: handlePptNarrationRemotion(共
    // ppt-narration/illustration-tts 两条链复用同一处调用)、
    // handleTalkingHeadBrollRemotion、handleRecompose——原阈值(>3, 对应删除前
    // 4 处出口)已不成立, 反映现状收紧为 >2, 继续守住"每处都带 freezeReport"。
    expect(落成片的.length).toBeGreaterThan(2);

    const 漏检的 = 落成片的.filter((c) => !c.includes('freezeReport'));
    // 报出完整调用文本, 免得只说"有一处漏了"却不说是哪一处
    expect(漏检的, `这些出口产出新成片却没复检静止:\n${漏检的.join('\n---\n')}`).toEqual([]);
  });

  it('recompose 这条出口有自己的复检 —— 它是被漏掉的那一个', () => {
    const i = src.indexOf('async function handleRecompose');
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('\n}', i));
    expect(body).toContain('reportFreeze');
  });
});
