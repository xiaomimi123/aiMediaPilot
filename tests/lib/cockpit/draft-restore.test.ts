import { describe, expect, it } from "vitest";
import { parseDraftOutput } from "@/lib/cockpit/draft-restore";

/**
 * 抽屉懒加载拉回改稿 UI 的纯解析函数 —— 输入是 ScriptDraft.output (Json 字段,
 * 未知形状), 按 script-mapping.ts 的窄化解析风格逐字段独立解析。覆盖:
 * - 完整五期形态 (script.sections/research/hooks/titles/durationSec 齐全)
 * - 旧形态 (五期以前只有 retentionBeats, 没有 script.sections) → null (没有可
 *   恢复的分块逐字稿, 抽屉保持现状不渲染 ScriptSectionsPanel)
 * - 畸形单键缺失/类型错误不炸, 其余字段独立解析成功
 */

const FULL_OUTPUT = {
  research: {
    points: [{ fact: "事实一", source: "https://a.com", usage: "开头引用" }],
  },
  script: {
    sections: [
      { role: "hook", startSec: 0, endSec: 3, text: "钩子文案" },
      { role: "main", startSec: 3, endSec: 20, text: "主体文案" },
      { role: "cta", startSec: 20, endSec: 30, text: "结尾文案" },
    ],
  },
  hooks: [{ text: "候选钩子1", rationale: "r1" }, { text: "候选钩子2", rationale: "r2" }],
  titles: [{ text: "标题一", hookType: "悬念" }, { text: "标题二", hookType: "冲突" }],
  cover: { textOverlay: "封面字", shotIdea: "镜头", colorTone: "冷色调" },
  durationSec: 45,
};

describe("parseDraftOutput", () => {
  it("完整五期形态 → sections/research/hooks/titles/durationSec 全部解析出来", () => {
    const result = parseDraftOutput(FULL_OUTPUT);
    expect(result).not.toBeNull();
    expect(result!.sections).toEqual([
      { role: "hook", startSec: 0, endSec: 3, text: "钩子文案" },
      { role: "main", startSec: 3, endSec: 20, text: "主体文案" },
      { role: "cta", startSec: 20, endSec: 30, text: "结尾文案" },
    ]);
    expect(result!.research).toEqual({ points: [{ fact: "事实一", source: "https://a.com", usage: "开头引用" }] });
    expect(result!.hooks).toEqual([{ text: "候选钩子1" }, { text: "候选钩子2" }]);
    expect(result!.titles).toEqual([{ text: "标题一" }, { text: "标题二" }]);
    expect(result!.durationSec).toBe(45);
  });

  it("旧形态 (五期以前, 只有 retentionBeats 没有 script.sections) → null, 不误恢复 UI", () => {
    const result = parseDraftOutput({
      retentionBeats: [{ startSec: 0, endSec: 10, beat: "开场" }],
      hooks: [{ text: "hook", rationale: "r" }],
    });
    expect(result).toBeNull();
  });

  it("output 不是对象 (null/字符串/数组) → null", () => {
    expect(parseDraftOutput(null)).toBeNull();
    expect(parseDraftOutput(undefined)).toBeNull();
    expect(parseDraftOutput("weird")).toBeNull();
    expect(parseDraftOutput([1, 2, 3])).toBeNull();
  });

  it("output.script.sections 缺失 → null (无法恢复分块 UI)", () => {
    expect(parseDraftOutput({ research: FULL_OUTPUT.research, hooks: FULL_OUTPUT.hooks })).toBeNull();
    expect(parseDraftOutput({ script: {} })).toBeNull();
    expect(parseDraftOutput({ script: { sections: [] } })).toBeNull();
  });

  it("sections 中单块畸形 (缺 text) → 该块被丢弃, 其余合法块仍解析出来", () => {
    const result = parseDraftOutput({
      script: {
        sections: [
          { role: "hook", startSec: 0, endSec: 3, text: "合法钩子" },
          { role: "main", startSec: 3, endSec: 10 }, // 缺 text, 整块丢弃
        ],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.sections).toEqual([{ role: "hook", startSec: 0, endSec: 3, text: "合法钩子" }]);
  });

  it("sections 合法但 research 键畸形 (points 非数组) → research 不出现, sections 仍正常解析", () => {
    const result = parseDraftOutput({
      script: { sections: FULL_OUTPUT.script.sections },
      research: { points: "not-an-array" },
    });
    expect(result).not.toBeNull();
    expect(result!.sections).toHaveLength(3);
    expect(result).not.toHaveProperty("research");
  });

  it("sections 合法但 hooks 键缺失 → hooks 不出现, 其余字段不受影响", () => {
    const result = parseDraftOutput({ script: { sections: FULL_OUTPUT.script.sections }, titles: FULL_OUTPUT.titles });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("hooks");
    expect(result!.titles).toEqual([{ text: "标题一" }, { text: "标题二" }]);
  });

  it("sections 合法但 titles 单条畸形 (text 为空字符串) → 该条被过滤", () => {
    const result = parseDraftOutput({
      script: { sections: FULL_OUTPUT.script.sections },
      titles: [{ text: "" }, { text: "有效标题" }],
    });
    expect(result!.titles).toEqual([{ text: "有效标题" }]);
  });

  it("durationSec 非法值 (非 30/45/60) → 不出现该字段, 不炸", () => {
    const result = parseDraftOutput({ script: { sections: FULL_OUTPUT.script.sections }, durationSec: 999 });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("durationSec");
  });

  it("hooks 数组存在但全部畸形 → hooks 不出现 (不是空数组 key)", () => {
    const result = parseDraftOutput({
      script: { sections: FULL_OUTPUT.script.sections },
      hooks: [{ text: "" }, { rationale: "no text field" }],
    });
    expect(result).not.toHaveProperty("hooks");
  });

  // ---- 六期: xiaohongshu 形态 (无 script 包裹层, 顶层直接是 intro/body) ----

  const FULL_XHS_OUTPUT = {
    research: { points: [{ fact: "事实一", source: "https://a.com", usage: "开头引用" }] },
    titles: [{ text: "标题一", hookType: "悬念" }, { text: "标题二", hookType: "冲突" }],
    coverText: "封面文案",
    intro: "开头引导文案",
    body: "正文内容",
    tags: ["标签一", "标签二"],
    shotIdeas: [
      { idx: 2, description: "第二个镜头" },
      { idx: 1, description: "第一个镜头" },
    ],
  };

  it("完整六期 xiaohongshu 形态 → intro/body/research/titles/tags/shotIdeas/coverText 全部解析出来", () => {
    const result = parseDraftOutput(FULL_XHS_OUTPUT);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("sections");
    expect(result!.intro).toBe("开头引导文案");
    expect(result!.body).toBe("正文内容");
    expect(result!.research).toEqual({ points: [{ fact: "事实一", source: "https://a.com", usage: "开头引用" }] });
    expect(result!.titles).toEqual([{ text: "标题一" }, { text: "标题二" }]);
    expect(result!.tags).toEqual(["标签一", "标签二"]);
    // shotIdeas 按 idx 升序排列, 与输入顺序 (2 在前 1 在后) 相反
    expect(result!.shotIdeas).toEqual([
      { idx: 1, description: "第一个镜头" },
      { idx: 2, description: "第二个镜头" },
    ]);
    expect(result!.coverText).toBe("封面文案");
  });

  it("xiaohongshu 形态: intro/body 缺一个 → 既不是 douyin 也不是 xhs 形状, 返回 null", () => {
    expect(parseDraftOutput({ intro: "只有开头" })).toBeNull();
    expect(parseDraftOutput({ body: "只有正文" })).toBeNull();
    expect(parseDraftOutput({ intro: "", body: "正文" })).toBeNull();
  });

  it("xiaohongshu 形态: intro/body 合法但 tags/shotIdeas/coverText 畸形或缺失 → 各自独立不出现, intro/body 仍正常解析", () => {
    const result = parseDraftOutput({ intro: "开头", body: "正文", tags: "not-an-array", shotIdeas: [{ idx: "x", description: "坏的" }] });
    expect(result).not.toBeNull();
    expect(result!.intro).toBe("开头");
    expect(result!.body).toBe("正文");
    expect(result).not.toHaveProperty("tags");
    expect(result).not.toHaveProperty("shotIdeas");
    expect(result).not.toHaveProperty("coverText");
  });

  it("xiaohongshu 形态: tags 数组存在但全部是空字符串 → tags 不出现 (不是空数组 key)", () => {
    const result = parseDraftOutput({ intro: "开头", body: "正文", tags: ["", ""] });
    expect(result).not.toHaveProperty("tags");
  });

  // ---- T5 七期: 出图计划 (imagePlan) / 逐张生图结果 (images) ----

  const FULL_XHS_WITH_IMAGES = {
    intro: "开头引导文案",
    body: "正文内容",
    imagePlan: {
      style: "minimalist flat illustration, warm pastel palette",
      images: [
        { idx: 0, prompt: "封面图 prompt" },
        { idx: 1, prompt: "第一张配图 prompt" },
      ],
    },
    images: {
      0: { path: "/generated/draft1/0.png", prompt: "封面图 prompt", createdAt: "2026-08-14T00:00:00.000Z" },
    },
  };

  it("xiaohongshu 形态: imagePlan + 部分 images 齐全 → 都解析出来, images 按 idx 数字键索引", () => {
    const result = parseDraftOutput(FULL_XHS_WITH_IMAGES);
    expect(result).not.toBeNull();
    expect(result!.imagePlan).toEqual({
      style: "minimalist flat illustration, warm pastel palette",
      images: [
        { idx: 0, prompt: "封面图 prompt" },
        { idx: 1, prompt: "第一张配图 prompt" },
      ],
    });
    expect(result!.images).toEqual({
      0: { path: "/generated/draft1/0.png", prompt: "封面图 prompt", createdAt: "2026-08-14T00:00:00.000Z" },
    });
  });

  it("xiaohongshu 形态: 没有 imagePlan/images 键 → 两者都不出现 (未出过图的旧稿正常恢复)", () => {
    const result = parseDraftOutput({ intro: "开头", body: "正文" });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("imagePlan");
    expect(result).not.toHaveProperty("images");
  });

  it("xiaohongshu 形态: imagePlan 畸形 (缺 style / images 非数组) → imagePlan 不出现, intro/body 仍正常解析", () => {
    const result = parseDraftOutput({ intro: "开头", body: "正文", imagePlan: { images: "not-an-array" } });
    expect(result).not.toBeNull();
    expect(result!.intro).toBe("开头");
    expect(result).not.toHaveProperty("imagePlan");
  });

  it("xiaohongshu 形态: imagePlan.images 单条畸形 (prompt 缺失) → 该条被过滤, 其余合法条仍解析", () => {
    const result = parseDraftOutput({
      intro: "开头",
      body: "正文",
      imagePlan: { style: "some style token", images: [{ idx: 0, prompt: "合法 prompt" }, { idx: 1 }] },
    });
    expect(result!.imagePlan).toEqual({ style: "some style token", images: [{ idx: 0, prompt: "合法 prompt" }] });
  });

  it("xiaohongshu 形态: images 值畸形 (缺 createdAt) → 该条被过滤, 其余合法条仍解析, 非法/负数键忽略", () => {
    const result = parseDraftOutput({
      intro: "开头",
      body: "正文",
      images: {
        0: { path: "/generated/d/0.png", prompt: "p0", createdAt: "2026-08-14T00:00:00.000Z" },
        1: { path: "/generated/d/1.png", prompt: "p1" }, // 缺 createdAt, 整条丢弃
      },
    });
    expect(result!.images).toEqual({
      0: { path: "/generated/d/0.png", prompt: "p0", createdAt: "2026-08-14T00:00:00.000Z" },
    });
  });

  it("xiaohongshu 形态: images 全部畸形/为空对象 → images 不出现 (不是空对象 key)", () => {
    const result = parseDraftOutput({ intro: "开头", body: "正文", images: {} });
    expect(result).not.toHaveProperty("images");
    const result2 = parseDraftOutput({ intro: "开头", body: "正文", images: { 0: { path: "只有 path" } } });
    expect(result2).not.toHaveProperty("images");
  });
});

// ---------------------------------------------------------------------------
// 十三期收尾修复 (task-7 真实 E2E 走查发现): parseDraftOutput 在改造前完全不
// 识别 acts 形态 —— 抽屉关了再打开同一条已生成六幕稿的内容 (组件整体重挂载,
// 走的正是这条懒加载路径) 时静默返回 null, SixActPanel 整体消失 (不崩溃, 但
// 改稿功能不可用)。补一条六幕稿判据, 与 sections/xhs 两条分支同一恢复模式。
// ---------------------------------------------------------------------------
function makeAct(act: string, narration: string) {
  return {
    act,
    title: "标题",
    narration,
    visual: "配图建议",
    note: "备注",
    targetSec: 15,
    beats: [{ keyword: "a" }, { keyword: "b" }, { keyword: "c" }],
    facts: [],
  };
}

const SIX_ACT_KEYS = ["hook", "concept_a", "concept_b", "trivia", "synthesis", "punchline"];

const FULL_SIX_ACT_OUTPUT = {
  research: FULL_OUTPUT.research,
  script: {
    acts: SIX_ACT_KEYS.map((k) => makeAct(k, `这是 ${k} 幕的口播台词, 内容足够长以通过最小字数校验。`)),
  },
  four_dims: { gain: "获得感", surprise: "惊喜感", clarity: "表达力", appeal: "感染力" },
  hooks: FULL_OUTPUT.hooks,
  titles: FULL_OUTPUT.titles,
  cover: FULL_OUTPUT.cover,
  durationSec: 90,
  lintIssues: [{ level: "warn", act: "hook", message: "空洞形容词「非常」不承载信息, 建议删" }],
};

describe("parseDraftOutput — 六幕稿懒加载恢复 (十三期收尾修复)", () => {
  it("完整六幕形态 → acts/four_dims/durationSec(90)/lintIssues/research 全部解析出来", () => {
    const result = parseDraftOutput(FULL_SIX_ACT_OUTPUT);
    expect(result).not.toBeNull();
    expect(result!.acts).toHaveLength(6);
    expect(result!.acts!.map((a) => a.act)).toEqual(SIX_ACT_KEYS);
    expect(result!.four_dims).toEqual(FULL_SIX_ACT_OUTPUT.four_dims);
    expect(result!.durationSec).toBe(90);
    expect(result!.lintIssues).toEqual(FULL_SIX_ACT_OUTPUT.lintIssues);
    expect(result!.research).toEqual(FULL_OUTPUT.research);
    // 六幕稿判据命中时不应该混入 sections/xhs 分支的字段
    expect(result).not.toHaveProperty("sections");
    expect(result).not.toHaveProperty("intro");
  });

  it("六幕稿缺 lintIssues/research (最小合法形态) → 只有 acts/four_dims/durationSec 出现", () => {
    const result = parseDraftOutput({
      script: { acts: SIX_ACT_KEYS.map((k) => makeAct(k, `${k} 幕台词, 足够长以通过最小字数校验规则。`)) },
      four_dims: FULL_SIX_ACT_OUTPUT.four_dims,
      durationSec: 90,
    });
    expect(result).not.toBeNull();
    expect(result!.acts).toHaveLength(6);
    expect(result).not.toHaveProperty("lintIssues");
    expect(result).not.toHaveProperty("research");
  });

  it("acts 顺序错误/缺幕 (不满足 isSixActScript) → 不算六幕形态, 落回旧路径判别", () => {
    const shuffled = {
      script: { acts: [...SIX_ACT_KEYS].reverse().map((k) => makeAct(k, `${k} 幕台词, 足够长以通过最小字数校验规则。`)) },
      four_dims: FULL_SIX_ACT_OUTPUT.four_dims,
    };
    const result = parseDraftOutput(shuffled);
    // 乱序 acts 既不满足六幕判据, 也没有合法 sections/intro+body → null
    expect(result).toBeNull();
  });
});
