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
});
