import path from 'path';
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonaSection } from '@/lib/llm/prompts/persona-section';
import type { PersonaProfileData } from '@/lib/persona/profile';

function makeProfile(overrides: Partial<PersonaProfileData> = {}): PersonaProfileData {
  return {
    audience: '25-35 岁互联网从业者',
    targetFans: '想转行做 AI 的人',
    pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
    angle: '只讲能落地的方法',
    avoid: '不做标题党',
    painPoints: [],
    offerings: [],
    productLogic: '',
    marketInsight: null,
    systemSummary: '',
    ...overrides,
  };
}

const PAIN_POINTS = [{ pain: '不知道拍什么', evidence: '选题卡壳超过 1 小时' }];
const OFFERINGS = [
  { name: 'AI 选题工具', type: 'tool' as const, description: '自动生成选题', targetPain: '不知道拍什么' },
  { name: '1v1 咨询', type: 'service' as const, description: '账号定位诊断', targetPain: '不知道拍什么' },
];
const MARKET_INSIGHT = {
  landscape: '同质化严重',
  mainstream: '搬运资讯',
  unmet: '缺乏可落地的实操内容',
  opportunity: '做深度实操内容切入',
  researchedAt: '2026-08-15',
};

describe('buildPersonaSection', () => {
  it('profile null → 空串 (三个 scope 都一样)', () => {
    expect(buildPersonaSection(null, 'radar')).toBe('');
    expect(buildPersonaSection(null, 'write')).toBe('');
    expect(buildPersonaSection(null, 'topic')).toBe('');
  });

  describe("scope='radar' — 受众/支柱/痛点/机会位", () => {
    it('全字段齐全 → 包含受众/支柱/痛点/机会位', () => {
      const out = buildPersonaSection(
        makeProfile({ painPoints: PAIN_POINTS, marketInsight: MARKET_INSIGHT }),
        'radar',
      );
      expect(out).toContain('25-35 岁互联网从业者');
      expect(out).toContain('想转行做 AI 的人');
      expect(out).toContain('工具评测');
      expect(out).toContain('拆解 AI 工具实际效果');
      expect(out).toContain('不知道拍什么');
      expect(out).toContain('选题卡壳超过 1 小时');
      expect(out).toContain('缺乏可落地的实操内容');
      expect(out).toContain('做深度实操内容切入');
    });

    it('不含差异化角度/忌讳', () => {
      const out = buildPersonaSection(makeProfile(), 'radar');
      expect(out).not.toContain('只讲能落地的方法');
      expect(out).not.toContain('不做标题党');
    });

    it('不含 CTA 段 (哪怕传了 intent)', () => {
      const out = buildPersonaSection(
        makeProfile({ offerings: OFFERINGS }),
        'radar',
        'convert',
      );
      expect(out).not.toContain('CTA 指引');
      expect(out).not.toContain('AI 选题工具');
    });

    it('painPoints 为空数组 → 用户痛点段省略', () => {
      const out = buildPersonaSection(makeProfile({ painPoints: [] }), 'radar');
      expect(out).not.toContain('用户痛点');
    });

    it('marketInsight 为 null → 市场机会位段省略', () => {
      const out = buildPersonaSection(makeProfile({ marketInsight: null }), 'radar');
      expect(out).not.toContain('市场机会位');
    });

    it('marketInsight 存在但 unmet/opportunity 均为空串 → 市场机会位段省略', () => {
      const out = buildPersonaSection(
        makeProfile({ marketInsight: { ...MARKET_INSIGHT, unmet: '', opportunity: '' } }),
        'radar',
      );
      expect(out).not.toContain('市场机会位');
    });
  });

  describe("scope='write' — 受众/痛点/角度/机会位(+CTA)", () => {
    it('全字段齐全 → 包含受众/痛点/角度/机会位', () => {
      const out = buildPersonaSection(
        makeProfile({ painPoints: PAIN_POINTS, marketInsight: MARKET_INSIGHT }),
        'write',
      );
      expect(out).toContain('25-35 岁互联网从业者');
      expect(out).toContain('不知道拍什么');
      expect(out).toContain('只讲能落地的方法');
      expect(out).toContain('缺乏可落地的实操内容');
    });

    it('不含支柱列表', () => {
      const out = buildPersonaSection(makeProfile(), 'write');
      expect(out).not.toContain('内容支柱');
      expect(out).not.toContain('工具评测');
    });

    it('不含忌讳', () => {
      const out = buildPersonaSection(makeProfile(), 'write');
      expect(out).not.toContain('不做标题党');
    });

    it('intent 未传 → 不含 CTA 段', () => {
      const out = buildPersonaSection(makeProfile(), 'write');
      expect(out).not.toContain('CTA 指引');
    });

    it("intent='' (空串) → 视同未传, 不含 CTA 段", () => {
      const out = buildPersonaSection(makeProfile(), 'write', '');
      expect(out).not.toContain('CTA 指引');
    });

    it("intent='reach' → CTA 段引导互动关注", () => {
      const out = buildPersonaSection(makeProfile(), 'write', 'reach');
      expect(out).toContain('CTA 指引 (引流)');
      expect(out).toContain('互动');
      expect(out).toContain('关注');
    });

    it("intent='trust' → CTA 段引导收藏与看更多案例", () => {
      const out = buildPersonaSection(makeProfile(), 'write', 'trust');
      expect(out).toContain('CTA 指引 (建立信任)');
      expect(out).toContain('收藏');
      expect(out).toContain('更多同类案例');
    });

    it("intent='convert' 且 offerings 非空 → CTA 段列出 offerings 名称与说明", () => {
      const out = buildPersonaSection(makeProfile({ offerings: OFFERINGS }), 'write', 'convert');
      expect(out).toContain('CTA 指引 (转化)');
      expect(out).toContain('AI 选题工具');
      expect(out).toContain('自动生成选题');
      expect(out).toContain('1v1 咨询');
      expect(out).toContain('账号定位诊断');
    });

    it("intent='convert' 且 offerings 为空 → 通用转化引导, 不报错不列空表", () => {
      const out = buildPersonaSection(makeProfile({ offerings: [] }), 'write', 'convert');
      expect(out).toContain('CTA 指引 (转化)');
      expect(out).not.toContain('undefined');
    });

    it('radar/topic 的 CTA 用词不互相串场 (reach 不提硬广, convert 不提互动关注)', () => {
      const reachOut = buildPersonaSection(makeProfile(), 'write', 'reach');
      expect(reachOut).not.toContain('广告');
      const convertOut = buildPersonaSection(makeProfile({ offerings: OFFERINGS }), 'write', 'convert');
      expect(convertOut).not.toContain('CTA 指引 (引流)');
    });
  });

  describe("scope='topic' — 受众/支柱/痛点", () => {
    it('全字段齐全 → 包含受众/支柱/痛点', () => {
      const out = buildPersonaSection(makeProfile({ painPoints: PAIN_POINTS }), 'topic');
      expect(out).toContain('25-35 岁互联网从业者');
      expect(out).toContain('工具评测');
      expect(out).toContain('不知道拍什么');
    });

    it('不含差异化角度/忌讳/市场机会位以外的内容 (角度/忌讳/机会位/CTA 均省略)', () => {
      const out = buildPersonaSection(
        makeProfile({ marketInsight: MARKET_INSIGHT }),
        'topic',
        'convert',
      );
      expect(out).not.toContain('只讲能落地的方法');
      expect(out).not.toContain('不做标题党');
      expect(out).not.toContain('市场机会位');
      expect(out).not.toContain('CTA 指引');
    });

    it('pillars 为空数组 → 内容支柱段落省略', () => {
      const out = buildPersonaSection(makeProfile({ pillars: [] }), 'topic');
      expect(out).not.toContain('内容支柱');
    });

    it('所有相关字段皆空 → 空串', () => {
      const out = buildPersonaSection(
        makeProfile({ audience: '', targetFans: '', pillars: [], painPoints: [] }),
        'topic',
      );
      expect(out).toBe('');
    });

    it('audience 只有空白 → 该行省略', () => {
      const out = buildPersonaSection(makeProfile({ audience: '   ' }), 'topic');
      expect(out).not.toContain('目标受众');
    });
  });

  describe('字符级对拍旧实现 (八期 commit — 用 git show 抽取, 验证共享字段格式无回归)', () => {
    // 九期终审教训: 不能自比较 (新实现对自己求值算不上验证)。真实拉出 git 历史里
    // buildPersonaSection 唯一存在过的旧版本 (八期签名 `(profile)` 单参), 对同一份
    // 「八期档案」数据 (不含十期新字段) 跑新旧两版, 字符级 toBe 断言共享字段的
    // 渲染格式完全一致 —— 证明本次改造没有意外改动八期就有的行/格式。
    //
    // radar/write/topic 三个 scope 各自只保留了旧实现字段的一个子集 (旧实现固定
    // 输出 受众+支柱+角度+忌讳 四类; radar/topic 保留 受众+支柱, write 保留 受众+角度;
    // 三个 scope 均不再输出「忌讳」), 所以每条对拍用例都构造了「只填该 scope 会保留的
    // 旧字段, 其余旧字段留空」的档案, 让新旧两版对同一输入产出完全相同的字符串。
    const OLD_COMMIT = 'b0b6059';
    const REPO_ROOT = path.resolve(__dirname, '../../../..');
    // .cjs (非 .ts): 直接用 Node 原生 require 加载, 绕开 Vite 的模块图解析
    // (临时文件不在任何 tsconfig/alias 覆盖范围内, 用 dynamic import 走 Vite 转换会找不到文件)。
    // 用项目已有的 esbuild (vite 的转译依赖) 把 git show 抽出的旧 TS 源码转成可
    // 直接 require 的 CJS —— 只做类型擦除 + module 包装, 函数体逻辑一字不改,
    // 不影响"字符级对拍"的有效性。
    const tmpFile = path.resolve(__dirname, '__old-persona-section-b0b6059.cjs');

    let oldBuildPersonaSection: (profile: PersonaProfileData) => string;

    beforeAll(() => {
      const oldSource = execSync(
        `git show ${OLD_COMMIT}:src/lib/llm/prompts/persona-section.ts`,
        { cwd: REPO_ROOT, encoding: 'utf-8' },
      );
      const cjsSource = transformSync(oldSource, { loader: 'ts', format: 'cjs' }).code;
      writeFileSync(tmpFile, cjsSource, 'utf-8');
      const require = createRequire(import.meta.url);
      delete require.cache[require.resolve(tmpFile)];
      oldBuildPersonaSection = (require(tmpFile) as { buildPersonaSection: (profile: PersonaProfileData) => string })
        .buildPersonaSection;
    });

    afterAll(() => {
      rmSync(tmpFile, { force: true });
    });

    it('radar 与 topic 保留的字段子集 (受众+支柱) 与旧实现字符级一致', () => {
      // 旧实现的 angle/avoid 留空, 让旧输出退化为「受众+支柱」—— 与新 radar/topic
      // 输出的字段子集完全重合, 才能做有意义的 toBe 全串比较。
      const profile = makeProfile({ angle: '', avoid: '' });
      const oldOut = oldBuildPersonaSection(profile);
      expect(oldOut.length).toBeGreaterThan(0); // 前置条件: 确保真的在比较非空内容
      expect(buildPersonaSection(profile, 'radar')).toBe(oldOut);
      expect(buildPersonaSection(profile, 'topic')).toBe(oldOut);
    });

    it('write 保留的字段子集 (受众+角度) 与旧实现字符级一致', () => {
      // 旧实现的 pillars/avoid 留空, 让旧输出退化为「受众+角度」—— 与新 write
      // (不含新字段/无 intent 时) 输出的字段子集完全重合。
      const profile = makeProfile({ pillars: [], avoid: '' });
      const oldOut = oldBuildPersonaSection(profile);
      expect(oldOut.length).toBeGreaterThan(0);
      expect(buildPersonaSection(profile, 'write')).toBe(oldOut);
    });
  });
});
