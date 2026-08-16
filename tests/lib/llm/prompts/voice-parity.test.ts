import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCRIPT_WRITE_DOUYIN } from '@/lib/llm/prompts/script-write-douyin';
import { SCRIPT_WRITE_XHS } from '@/lib/llm/prompts/script-write-xhs';
import type { StyleContext } from '@/lib/llm/prompts/script-write-douyin';

/**
 * 十二期零迁移对拍 —— 真实加载十二期之前的实现, 同参数比对**输出字符串**。
 *
 * 九期终审教训: 「与旧版一致」若写成自比较(新实现两次调用互比)测不出真回归。这里用
 * `git show <基线>` 取出旧源码写进项目内临时目录, 由 vitest 自己转换并解析 @/ 别名
 * (直接 require 转换后的 cjs 会因依赖是 .ts 而失败), 拿到的是与当前实现不同的函数对象。
 *
 * 基线固定为十二期分支点 (57e85d5)。历史被重写时此测试会失败 —— 它的价值在十二期落地
 * 当下, 不是永久资产, 届时更新常量或删除即可。
 *
 * 十三期: SCRIPT_WRITE_DOUYIN 的 system prompt 已按计划改写为六幕结构 (见
 * script-write-douyin.ts / script_spec.md), 与十二期基线不再逐字相同是本次改造的
 * 预期结果, 不是回归 —— douyin 对拍断言按计划移除, SCRIPT_WRITE_XHS 未改动, 对拍保留。
 */
const BASELINE = '57e85d5';
const TMP_DIR = path.join(process.cwd(), 'src', '__parity_tmp__');

type BuildFn = (n: string, s: StyleContext, p?: string) => string;
let oldDouyin: { buildSystemPrompt: BuildFn };
let oldXhs: { buildSystemPrompt: BuildFn };

beforeAll(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  for (const f of ['script-write-douyin', 'script-write-xhs']) {
    const src = execSync(`git show ${BASELINE}:src/lib/llm/prompts/${f}.ts`).toString();
    // 相对导入改成绝对别名, 因为文件被挪到了别的目录
    fs.writeFileSync(
      path.join(TMP_DIR, `${f}.ts`),
      src.replace(/from '\.\/([^']+)'/g, "from '@/lib/llm/prompts/$1'"),
    );
  }
  // 变量路径: 临时文件在 typecheck 时不存在, 静态字面量会触发 TS2307
  const dyn = (p: string) => import(/* @vite-ignore */ p);
  oldDouyin = (await dyn('@/__parity_tmp__/script-write-douyin')).SCRIPT_WRITE_DOUYIN;
  oldXhs = (await dyn('@/__parity_tmp__/script-write-xhs')).SCRIPT_WRITE_XHS;
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const STYLE: StyleContext = { mode: 'description', description: '口语化, 短句', samples: [] };

describe('十二期零迁移: 不传 voiceSection 时写稿 prompt 与基线逐字相同', () => {
  // 十三期: SCRIPT_WRITE_DOUYIN 的对拍断言按计划移除 —— 六幕改造把 system prompt 整体
  // 重写, 与十二期基线不再逐字相同是预期结果 (见文件头注释)。oldDouyin 仍加载 (供下面
  // 的"确实变了"断言对比), 只是不再要求相等。
  it('SCRIPT_WRITE_DOUYIN 十三期后与十二期基线不再逐字相同 (六幕改造是预期变更, 不是回归)', () => {
    const current = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', STYLE, '');
    const baseline = oldDouyin.buildSystemPrompt('ai-knowledge', STYLE, '');
    expect(current).not.toBe(baseline);
  });

  it('SCRIPT_WRITE_XHS 未在十三期改动, 与十二期基线仍逐字相同', () => {
    for (const persona of ['', '受众: 想搞副业的普通人']) {
      expect(SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', STYLE, persona)).toBe(
        oldXhs.buildSystemPrompt('ai-knowledge', STYLE, persona),
      );
    }
  });
});
