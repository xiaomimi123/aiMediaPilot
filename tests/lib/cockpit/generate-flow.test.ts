import { describe, it, expect, vi } from "vitest";
import { runGenerateScript, type GenerateScriptDeps } from "@/lib/cockpit/generate-flow";

/**
 * 覆盖抽屉「用 AI 写脚本」流程 (原 content-drawer.tsx handleGenerateScript,
 * 已抽成不依赖 React/DOM 的 runGenerateScript)。仓库 vitest 跑在 node 环境
 * 没配 jsdom/@testing-library/react，这里直接用注入的 spy 断言状态流转，
 * 不需要挂载真实组件。
 */

function baseDeps(overrides: Partial<GenerateScriptDeps>): GenerateScriptDeps {
  return {
    fetch: vi.fn() as unknown as typeof fetch,
    resolveDefaultNiche: async () => "ai-tools",
    mapGeneratedToScript: vi.fn(),
    mergeScript: vi.fn(),
    notify: vi.fn(),
    setGenerating: vi.fn(),
    isMounted: () => true,
    isCurrentItem: () => true,
    ...overrides,
  };
}

describe("runGenerateScript", () => {
  it("F1 复现: 生成接口返回失败 (如 API Key 无效 → 500) → generating 必须复位为 false (按钮重新可用), notify 报错, 不回填", async () => {
    const setGenerating = vi.fn();
    const notify = vi.fn();
    const mergeScript = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, message: "生成失败: 无效的 API Key" }),
    });

    await runGenerateScript(
      { itemId: "content-1", title: "示例标题", platform: "douyin" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch, setGenerating, notify, mergeScript }),
    );

    expect(setGenerating).toHaveBeenNthCalledWith(1, true);
    expect(setGenerating).toHaveBeenLastCalledWith(false);
    expect(notify).toHaveBeenCalledWith("生成失败: 无效的 API Key");
    expect(mergeScript).not.toHaveBeenCalled();
    // 生成失败直接返回, 不应该继续打保存接口
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("再次点击生成 (第二次尝试) → 独立触发一次新的 fetch 请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, message: "生成失败" }),
    });
    const deps = baseDeps({ fetch: fetchMock as unknown as typeof fetch });

    await runGenerateScript({ itemId: "content-1", title: "标题", platform: "douyin" }, deps);
    await runGenerateScript({ itemId: "content-1", title: "标题", platform: "douyin" }, deps);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("douyin: 生成成功 → 不再二次 POST /api/v1/scripts (T4 五期 generate 路由已自己落库并返回 scriptDraftId), mergeScript 收到映射后的字段, onGenerated 收到完整响应", async () => {
    const setGenerating = vi.fn();
    const notify = vi.fn();
    const mergeScript = vi.fn();
    const onGenerated = vi.fn();
    const generatedData = { titles: [{ text: "标题一" }], scriptDraftId: "draft-1", sections: [{ role: "hook", startSec: 0, endSec: 3, text: "钩子" }] };
    const mapGeneratedToScript = vi.fn().mockReturnValue({ headline: "标题一" });
    const fetchMock = vi.fn().mockResolvedValueOnce({ json: async () => ({ success: true, data: generatedData }) });

    await runGenerateScript(
      { itemId: "content-1", title: "示例标题", platform: "douyin" },
      baseDeps({
        fetch: fetchMock as unknown as typeof fetch,
        setGenerating,
        notify,
        mergeScript,
        mapGeneratedToScript,
        onGenerated,
        isCurrentItem: (id) => id === "content-1",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mapGeneratedToScript).toHaveBeenCalledWith("douyin", generatedData);
    expect(mergeScript).toHaveBeenCalledWith("content-1", { headline: "标题一" });
    expect(onGenerated).toHaveBeenCalledWith(generatedData);
    expect(notify).toHaveBeenCalledWith("AI 脚本已生成并回填");
    expect(setGenerating).toHaveBeenLastCalledWith(false);
  });

  it("douyin: 请求体透传 materials/durationSec (未提供时不出现在请求体里)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) });

    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin", materials: "素材原文", durationSec: 60 },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );

    const genBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(genBody.materials).toBe("素材原文");
    expect(genBody.durationSec).toBe(60);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) });
    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    const genBody2 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(genBody2).not.toHaveProperty("materials");
    expect(genBody2).not.toHaveProperty("durationSec");
  });

  it("douyin: 请求体透传 cockpitContentId (未提供时不出现在请求体里)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) });

    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin", cockpitContentId: "content-1" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );

    const genBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(genBody.cockpitContentId).toBe("content-1");

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) });
    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    const genBody2 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(genBody2).not.toHaveProperty("cockpitContentId");
  });

  it("xiaohongshu (T6 六期): 生成成功 → 不再二次 POST /api/v1/scripts (generate 路由已自己落库并返回 scriptDraftId, 同 douyin), mergeScript 收到映射后的字段, onGenerated 收到完整响应", async () => {
    const setGenerating = vi.fn();
    const notify = vi.fn();
    const mergeScript = vi.fn();
    const onGenerated = vi.fn();
    const generatedData = { titles: [{ text: "标题一" }], scriptDraftId: "draft-1", intro: "开头", body: "正文" };
    const mapGeneratedToScript = vi.fn().mockReturnValue({ headline: "标题一" });
    const fetchMock = vi.fn().mockResolvedValueOnce({ json: async () => ({ success: true, data: generatedData }) });

    await runGenerateScript(
      { itemId: "content-1", title: "示例标题", platform: "xiaohongshu" },
      baseDeps({
        fetch: fetchMock as unknown as typeof fetch,
        setGenerating,
        notify,
        mergeScript,
        mapGeneratedToScript,
        onGenerated,
        isCurrentItem: (id) => id === "content-1",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mapGeneratedToScript).toHaveBeenCalledWith("xiaohongshu", generatedData);
    expect(mergeScript).toHaveBeenCalledWith("content-1", { headline: "标题一" });
    expect(onGenerated).toHaveBeenCalledWith(generatedData);
    expect(notify).toHaveBeenCalledWith("AI 脚本已生成并回填");
    expect(setGenerating).toHaveBeenLastCalledWith(false);
  });

  it("非 douyin/xiaohongshu 平台 (如 gongzhonghao): 沿用生成 + 二次保存两阶段流程 (该平台生成路由不落库), mergeScript 收到映射字段, onGenerated 带上保存后的 scriptDraftId", async () => {
    const setGenerating = vi.fn();
    const notify = vi.fn();
    const mergeScript = vi.fn();
    const onGenerated = vi.fn();
    const generatedData = { titles: [{ text: "标题一" }], platform: "gongzhonghao", inspirationApplied: false };
    const mapGeneratedToScript = vi.fn().mockReturnValue({ headline: "标题一" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: generatedData }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: { id: "draft-2" } }) });

    await runGenerateScript(
      { itemId: "content-1", title: "示例标题", platform: "gongzhonghao" },
      baseDeps({
        fetch: fetchMock as unknown as typeof fetch,
        setGenerating,
        notify,
        mergeScript,
        mapGeneratedToScript,
        onGenerated,
        isCurrentItem: (id) => id === "content-1",
      }),
    );

    expect(mapGeneratedToScript).toHaveBeenCalledWith("gongzhonghao", generatedData);
    expect(mergeScript).toHaveBeenCalledWith("content-1", { headline: "标题一" });
    expect(onGenerated).toHaveBeenCalledWith({ ...generatedData, scriptDraftId: "draft-2" });
    expect(notify).toHaveBeenCalledWith("AI 脚本已生成并回填");
    expect(setGenerating).toHaveBeenLastCalledWith(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const saveBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(saveBody.cockpitContentId).toBe("content-1");
    expect(saveBody.output).not.toHaveProperty("platform");
    expect(saveBody.output).not.toHaveProperty("inspirationApplied");
  });

  it("非 douyin/xiaohongshu 平台: 保存接口返回失败 → notify 报错且不回填, 不因为生成阶段成功了就误报成功", async () => {
    const notify = vi.fn();
    const mergeScript = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) })
      .mockResolvedValueOnce({ json: async () => ({ success: false, message: "保存失败: 数据库繁忙" }) });

    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "gongzhonghao" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch, notify, mergeScript }),
    );

    expect(notify).toHaveBeenCalledWith("保存失败: 数据库繁忙");
    expect(mergeScript).not.toHaveBeenCalled();
  });

  it("StrictMode 场景: 结果返回时抽屉已卸载 (isMounted() === false) → generating 仍必须无条件复位, 但静默丢弃结果不回填/不提示", async () => {
    const setGenerating = vi.fn();
    const notify = vi.fn();
    const mergeScript = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true }) });

    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin" },
      baseDeps({
        fetch: fetchMock as unknown as typeof fetch,
        setGenerating,
        notify,
        mergeScript,
        isMounted: () => false,
      }),
    );

    expect(setGenerating).toHaveBeenLastCalledWith(false);
    expect(mergeScript).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("结果返回时抽屉已切到另一篇内容 (isCurrentItem 为 false) → 静默丢弃, 不误回填到当前展示的内容上", async () => {
    const mergeScript = vi.fn();
    const notify = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: { titles: [] } }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true }) });

    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch, mergeScript, notify, isCurrentItem: () => false }),
    );

    expect(mergeScript).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("网络异常 (fetch 抛错) → notify 兜底文案, generating 复位", async () => {
    const setGenerating = vi.fn();
    const notify = vi.fn();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    await runGenerateScript(
      { itemId: "content-1", title: "标题", platform: "douyin" },
      baseDeps({ fetch: fetchMock as unknown as typeof fetch, setGenerating, notify }),
    );

    expect(notify).toHaveBeenCalledWith("network down");
    expect(setGenerating).toHaveBeenLastCalledWith(false);
  });
});
