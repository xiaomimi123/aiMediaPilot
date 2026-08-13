/** 落到 `output.images[idx]` 的单条记录形状。 */
export type GeneratedImageRecord = { path: string; prompt: string; createdAt: string };

/** 能执行 tagged-template `$executeRaw` 的最小接口 —— 真实 PrismaClient / mock 均满足。 */
export interface RawExecClient {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/**
 * 把一张生成好的图片记录原子写入 `ScriptDraft.output.images[idx]`。
 *
 * 用 `output || jsonb_build_object('images', coalesce(output->'images','{}'::jsonb) || jsonb_build_object(idx, record))`
 * 而不是 `jsonb_set(output, ARRAY['images', idx], record, true)` —— 后者的
 * create_missing 只对 path **最后一级** 生效, 若父键 `images` 本身不存在 (出图
 * 计划路由 `images/plan` 从不预先初始化该键, 所以每篇稿子第一次生图必然如此),
 * 整条 UPDATE 会静默 no-op、原样返回旧值 —— 首图请求 200 成功但根本没落库
 * (Postgres 15/16 实测复现, 回归测试见
 * `tests/lib/image/write-generated-image.integration.test.ts`)。
 *
 * `coalesce(output->'images', '{}'::jsonb)` 兜底父键不存在的情况, 保证首图与
 * 后续图都能正确合并写入。整条表达式仍在单条 UPDATE 语句内基于行内当前值
 * (`output` 列在同一语句里被读取并写回) 求值, Postgres 行锁天然串行化并发
 * UPDATE —— 前端对同一 draftId 不同 idx 的并发生图请求 (池并发 2) 互不覆盖。
 *
 * 调用方 (POST `scripts/[id]/images`) 生成前读到的 `output` 快照只用于
 * plan/idx 存在性校验, 不参与这里的写入 —— 避免 30-120s 的 provider.generate()
 * 期间快照过期导致并发请求互相覆盖对方落库结果。
 */
export async function writeGeneratedImage(
  client: RawExecClient,
  id: string,
  idx: number,
  record: GeneratedImageRecord,
): Promise<void> {
  await client.$executeRaw`UPDATE "ScriptDraft" SET output = output || jsonb_build_object('images', coalesce(output->'images', '{}'::jsonb) || jsonb_build_object(${String(idx)}, ${JSON.stringify(record)}::jsonb)) WHERE id = ${id}`;
}
