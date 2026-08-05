import { describe, it, expect } from "vitest";
import { mapGeneratedToScript } from "@/lib/cockpit/script-mapping";

describe("mapGeneratedToScript — douyin", () => {
  const validResult = {
    hooks: [
      { text: "你还在为周报发愁吗？", rationale: "痛点开场，直击打工人焦虑" },
      { text: "第二个钩子", rationale: "第二个理由" },
      { text: "第三个钩子", rationale: "第三个理由" },
    ],
    retentionBeats: [
      { startSec: 0, endSec: 3, beat: "抛出痛点" },
      { startSec: 3, endSec: 10, beat: "展示工具" },
      { startSec: 10, endSec: 20, beat: "演示效果" },
    ],
    titles: [
      { text: "3 个 prompt 让 AI 帮你写周报", hookType: "数字" },
      { text: "标题二", hookType: "反差" },
      { text: "标题三", hookType: "问题" },
    ],
    cover: {
      textOverlay: "周报救星",
      shotIdea: "屏幕录制 ChatGPT 输入框",
      colorTone: "白底红字",
    },
  };

  it("maps headline/hook/body/example from full result, leaves conclusion/ending absent", () => {
    const draft = mapGeneratedToScript("douyin", validResult);

    expect(draft.headline).toBe("3 个 prompt 让 AI 帮你写周报");
    expect(draft.hook).toBe("你还在为周报发愁吗？\n// 痛点开场，直击打工人焦虑");
    expect(draft.body).toBe(
      "0-3s：抛出痛点\n3-10s：展示工具\n10-20s：演示效果"
    );
    expect(draft.example).toBe(
      "封面文字：周报救星\n镜头创意：屏幕录制 ChatGPT 输入框\n色调：白底红字"
    );
    expect(draft.conclusion).toBeUndefined();
    expect(draft.ending).toBeUndefined();
    expect(Object.keys(draft).sort()).toEqual(["body", "example", "headline", "hook"].sort());
  });

  it("keeps valid fields when one field (cover) is malformed — per-field independence", () => {
    const partial = {
      ...validResult,
      cover: { textOverlay: "只有这个" }, // missing shotIdea/colorTone
    };
    const draft = mapGeneratedToScript("douyin", partial);

    expect(draft.headline).toBe("3 个 prompt 让 AI 帮你写周报");
    expect(draft.hook).toContain("你还在为周报发愁吗？");
    expect(draft.body).toContain("抛出痛点");
    expect(draft.example).toBeUndefined();
    expect(Object.keys(draft)).not.toContain("example");
  });

  it("omits hook rationale comment when rationale is missing", () => {
    const partial = {
      ...validResult,
      hooks: [{ text: "裸钩子，没有理由" }],
    };
    const draft = mapGeneratedToScript("douyin", partial);
    expect(draft.hook).toBe("裸钩子，没有理由");
  });
});

describe("mapGeneratedToScript — xiaohongshu", () => {
  const validResult = {
    titles: [
      { text: "✨打工人秒变效率怪", hookType: "反差" },
      { text: "标题二", hookType: "痛点" },
      { text: "标题三", hookType: "秘密" },
    ],
    coverText: "周报骗过老板",
    intro: "你是不是也每周被周报折磨到崩溃？今天分享一个亲测有效的方法。",
    body: "**第一步**：打开 ChatGPT\n\n**第二步**：喂给它你的工作记录\n\n这样写出来的周报又快又好，同事都问我怎么做到的，简单又高效的方法分享给大家试试看效果真的不错。",
    tags: ["ChatGPT", "AI 工具", "打工人逆袭"],
    shotIdeas: [
      { idx: 1, description: "截图 ChatGPT 输入框" },
      { idx: 2, description: "周报最终效果截图" },
      { idx: 3, description: "对比图：手写 vs AI" },
    ],
  };

  it("maps headline/hook/conclusion/body/example/ending from full result", () => {
    const draft = mapGeneratedToScript("xiaohongshu", validResult);

    expect(draft.headline).toBe("✨打工人秒变效率怪");
    expect(draft.hook).toBe(validResult.intro);
    expect(draft.conclusion).toBe("周报骗过老板");
    expect(draft.body).toBe(validResult.body);
    expect(draft.example).toBe(
      "1. 截图 ChatGPT 输入框\n2. 周报最终效果截图\n3. 对比图：手写 vs AI"
    );
    expect(draft.ending).toBe("#ChatGPT #AI 工具 #打工人逆袭");
    expect(Object.keys(draft).sort()).toEqual(
      ["body", "conclusion", "ending", "example", "headline", "hook"].sort()
    );
  });

  it("keeps other fields when tags is missing — per-field independence", () => {
    const { tags, ...rest } = validResult;
    const draft = mapGeneratedToScript("xiaohongshu", rest);
    expect(draft.headline).toBe("✨打工人秒变效率怪");
    expect(draft.ending).toBeUndefined();
    expect(Object.keys(draft)).not.toContain("ending");
  });
});

describe("mapGeneratedToScript — gongzhonghao", () => {
  const validResult = {
    titles: [
      { text: "ChatGPT 写周报：3 个不为人知的 prompt 技巧", hookType: "数字" },
      { text: "标题二", hookType: "承诺" },
      { text: "标题三", hookType: "疑问" },
    ],
    abstract: "还在为写周报发愁？这篇文章告诉你 3 个用 ChatGPT 写周报的实用技巧，让你的周报又快又好。",
    outline: ["问题：周报为什么难写", "误区：直接让 AI 写的 3 个坑", "方法：喂 AI 工作记录的 3 步"],
    body: "# 问题：周报为什么难写\n\n很多人写周报都很痛苦……".padEnd(820, "字"),
    cta: "你平时写周报有什么妙招？欢迎在评论区分享，点赞最多的我们下期专门写一篇拆解。",
  };

  it("maps headline/hook/body/ending from full result, leaves conclusion/example absent", () => {
    const draft = mapGeneratedToScript("gongzhonghao", validResult);

    expect(draft.headline).toBe(validResult.titles[0].text);
    expect(draft.hook).toBe(validResult.abstract);
    expect(draft.body).toBe(
      `1. 问题：周报为什么难写\n2. 误区：直接让 AI 写的 3 个坑\n3. 方法：喂 AI 工作记录的 3 步\n\n${validResult.body}`
    );
    expect(draft.ending).toBe(validResult.cta);
    expect(draft.conclusion).toBeUndefined();
    expect(draft.example).toBeUndefined();
    expect(Object.keys(draft).sort()).toEqual(["body", "ending", "headline", "hook"].sort());
  });

  it("keeps other fields when outline is missing — per-field independence", () => {
    const { outline, ...rest } = validResult;
    const draft = mapGeneratedToScript("gongzhonghao", rest);
    expect(draft.headline).toBe(validResult.titles[0].text);
    expect(draft.body).toBeUndefined();
    expect(Object.keys(draft)).not.toContain("body");
  });
});

describe("mapGeneratedToScript — defensive", () => {
  it("returns {} when titles is an empty array and nothing else is present", () => {
    expect(mapGeneratedToScript("douyin", { titles: [] })).toEqual({});
    expect(mapGeneratedToScript("xiaohongshu", { titles: [] })).toEqual({});
    expect(mapGeneratedToScript("gongzhonghao", { titles: [] })).toEqual({});
  });

  it("returns {} when result is not an object", () => {
    expect(mapGeneratedToScript("douyin", null)).toEqual({});
    expect(mapGeneratedToScript("douyin", undefined)).toEqual({});
    expect(mapGeneratedToScript("douyin", "a string")).toEqual({});
    expect(mapGeneratedToScript("douyin", 42)).toEqual({});
    expect(mapGeneratedToScript("douyin", [])).toEqual({});
  });

  it("returns {} for an empty object", () => {
    expect(mapGeneratedToScript("douyin", {})).toEqual({});
    expect(mapGeneratedToScript("xiaohongshu", {})).toEqual({});
    expect(mapGeneratedToScript("gongzhonghao", {})).toEqual({});
  });
});
