import type { ScriptDraft } from "@/lib/cockpit/model";
import type { ContentPlatform } from "@/lib/platform";

export interface GenerateScriptRequest {
  itemId: string;
  title: string;
  platform: ContentPlatform;
  /** T4 五期: 用户自备素材原文 (可选)，douyin 生成时会尝试真实引用进正文 */
  materials?: string;
  /** T4 五期: 目标时长秒数 (30/45/60)，仅 douyin 消费，其它平台忽略 */
  durationSec?: number;
  /**
   * 六期: 抽屉打开时对应的 CockpitContent.id，透传给 /scripts/generate 供其
   * best-effort 回写 CockpitContent.scriptDraftId（抽屉重开靠这个字段恢复改稿
   * UI）。调用处传 item.id。
   */
  cockpitContentId?: string;
}

export interface GenerateScriptDeps {
  fetch: typeof fetch;
  resolveDefaultNiche: () => Promise<string>;
  mapGeneratedToScript: (platform: ContentPlatform, result: unknown) => Partial<ScriptDraft>;
  mergeScript: (itemId: string, partial: Partial<ScriptDraft>) => void;
  notify: (message: string) => void;
  setGenerating: (value: boolean) => void;
  /** 抽屉是否仍然挂载 (对应 content-drawer.tsx 里的 mountedRef.current) */
  isMounted: () => boolean;
  /** 抽屉当前展示的是否仍是发起这次生成时的那篇内容 (对应 currentItemIdRef.current === itemId) */
  isCurrentItem: (itemId: string) => boolean;
  /**
   * T7: 生成 (+ 非 douyin 平台的二次保存) 全部成功后触发一次, 携带最终可用的
   * scriptDraftId 及原始响应字段 (douyin 额外带 sections/research/researchDegraded/hooks)。
   * 调用方用它把 T4 新字段落到抽屉自己的 state 上 (mergeScript 只管 ScriptDraft 六个骨架字段)。
   * 与 mergeScript 共用同一处 isMounted/isCurrentItem 陈旧结果丢弃判断。
   */
  onGenerated?: (data: Record<string, unknown>) => void;
}

/**
 * 抽屉内「用 AI 写脚本」的核心流程，从 content-drawer.tsx 抽成不依赖 React/DOM
 * 的纯函数——所有副作用 (fetch、setGenerating、notify、mergeScript、
 * mount/当前内容判断) 都通过 deps 注入。
 *
 * 目的：本仓库的 vitest 跑在 node 环境，没有配 jsdom / @testing-library/react，
 * 没法直接挂载 ContentDrawer 组件做集成测试。抽成纯函数后可以在 node 环境下
 * 用 spy 直接断言状态流转 (generating 复位、报错 notify、成功回填 mergeScript)，
 * 不需要新增 jsdom 依赖。
 *
 * `finally` 里的 `setGenerating(false)` 无条件执行——不再依赖 isMounted()：
 * React 18 对已卸载组件调用 setState 是安全的 no-op，卡在 "生成中…" 状态
 * 比一次多余的 no-op 更糟。
 */
export async function runGenerateScript(
  request: GenerateScriptRequest,
  deps: GenerateScriptDeps,
): Promise<void> {
  const { itemId, title, platform, materials, durationSec, cockpitContentId } = request;
  deps.setGenerating(true);
  try {
    const niche = await deps.resolveDefaultNiche();
    const genRes = await deps.fetch("/api/v1/scripts/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: title,
        niche,
        platform,
        ...(materials ? { materials } : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(cockpitContentId ? { cockpitContentId } : {}),
      }),
    });
    const genJson = await genRes.json();
    if (!genJson.success) {
      deps.notify(genJson.message || "生成失败");
      return;
    }

    // douyin (T4 五期) / xiaohongshu (T4 六期): /scripts/generate 路由自己创建
    // 并持久化了 ScriptDraft、响应里已带 scriptDraftId —— 不再像旧逻辑那样二次
    // POST /api/v1/scripts, 否则会在数据库里留下一条重复的 ScriptDraft (真正被
    // 引用的仍是 generate 路由那条, 二次保存那条成了孤儿记录, 且会把
    // CockpitContent.scriptDraftId 覆盖指向孤儿记录——T4 报告交接的真实 bug)。
    // gongzhonghao 的生成路由仍不落库, 继续靠下面的二次保存产生 ScriptDraft。
    if (platform === "douyin" || platform === "xiaohongshu") {
      if (!deps.isMounted() || !deps.isCurrentItem(itemId)) return;
      const data = genJson.data as Record<string, unknown>;
      deps.onGenerated?.(data);
      deps.mergeScript(itemId, deps.mapGeneratedToScript(platform, data));
      deps.notify("AI 脚本已生成并回填");
      return;
    }

    const { platform: _platform, inspirationApplied: _inspirationApplied, ...output } = genJson.data as Record<string, unknown>;
    const saveRes = await deps.fetch("/api/v1/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: title, niche, platform, output, cockpitContentId: itemId }),
    });
    const saveJson = await saveRes.json();
    if (!saveJson.success) {
      deps.notify(saveJson.message || "保存失败");
      return;
    }

    // 抽屉已关闭或已切换到另一篇内容: 结果静默丢弃, 不回填也不提示
    if (!deps.isMounted() || !deps.isCurrentItem(itemId)) return;
    deps.onGenerated?.({ ...(genJson.data as Record<string, unknown>), scriptDraftId: (saveJson.data as { id?: unknown } | undefined)?.id });
    deps.mergeScript(itemId, deps.mapGeneratedToScript(platform, genJson.data));
    deps.notify("AI 脚本已生成并回填");
  } catch (e) {
    deps.notify(e instanceof Error ? e.message : "生成失败，请稍后重试");
  } finally {
    deps.setGenerating(false);
  }
}
