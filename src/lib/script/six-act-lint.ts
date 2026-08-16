import { ACT_KEYS } from './six-act';
import type { FourDims, ScriptAct } from './six-act';

/**
 * 六幕脚本硬检查 (十三期任务二)。
 *
 * 规则移植自参考实现 `自媒体工程文件/lint.py`(`check()` 函数), 按十三期计划裁剪为
 * T1 类型能承载的子集 —— 该文件里针对 `beats.dur`/`footage`、`facts.confidence===low`、
 * 术语堆砌的检查依赖 T1 `ScriptAct`/`ActBeat`/`ActFact` 尚未提供的字段, 故未移植。
 *
 * 数字识别口径(哪些数字算「断言」需要 facts 佐证)逐字对齐 lint.py 的 `NUM` 正则与
 * `_numbers()`: 纯序数词(「第/前/后」+ 数字, 且不带 %/％/倍/万/亿 单位)不算断言,
 * 其余(含年份「2026年」、小数「3.5」)都算。
 */

export interface LintIssue {
  level: 'error' | 'warn';
  act: string;
  message: string;
}

const GREETINGS = ['大家好', '欢迎来到', '今天我们来聊聊', '我是'];
const EMPTY_ADJ = ['非常', '极其', '震撼', '颠覆'];
const DANGLING = ['这个', '那个'];

// 与 lint.py 的 NUM 正则一致: 数字(可带小数) + 可选单位。
const NUM = /\d+(?:\.\d+)?\s*(?:%|％|倍|万|亿|千|百|年|月|日|天|小时|分钟|秒|个|条|次|人|美元|元)?/g;
const SENT = /[。！？!?；;]/;

/** 去除所有空白, 与 lint.py 的 `_plain()` 对齐。 */
function plain(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, '');
}

/**
 * 抽出台词里需要事实佐证的数字表述。
 * 紧跟在「第/前/后」之后、且不带 %/％/倍/万/亿 单位的数字视为纯序数词, 不算断言
 * (对齐 lint.py `_numbers()`)。
 */
function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NUM)) {
    const span = m[0];
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 1), start);
    if (['第', '前', '后'].includes(before) && !/[%％倍万亿]/.test(span)) {
      continue;
    }
    out.push(span.trim());
  }
  return out;
}

export function lintSixActScript(script: { acts: ScriptAct[]; four_dims: FourDims }): LintIssue[] {
  const issues: LintIssue[] = [];
  const acts = script.acts ?? [];

  // ---- 结构: 六幕齐全且顺序正确 ----
  const keys = acts.map((a) => a.act);
  const structureOk = ACT_KEYS.length === keys.length && ACT_KEYS.every((k, i) => keys[i] === k);
  if (!structureOk) {
    issues.push({ level: 'error', act: '结构', message: `六幕缺失或顺序错误, 实得 ${JSON.stringify(keys)}` });
  }

  // ---- 四维: 任一项空串即 error ----
  const dims: Array<[keyof FourDims, string]> = [
    ['gain', '获得感'],
    ['surprise', '惊喜感'],
    ['clarity', '表达力'],
    ['appeal', '感染力'],
  ];
  for (const [key, label] of dims) {
    if (!plain(script.four_dims?.[key])) {
      issues.push({ level: 'error', act: '四维', message: `${label}为空` });
    }
  }

  // ---- 逐幕检查, 按幕序保证 issues 顺序稳定 ----
  for (const a of acts) {
    const key = a.act ?? '?';
    const narration = a.narration ?? '';
    const flat = plain(narration);

    // 四件套(title/narration/visual)非空
    const fields: Array<[keyof ScriptAct, string]> = [
      ['title', '标题'],
      ['narration', '口播台词'],
      ['visual', '配图建议'],
    ];
    for (const [field, label] of fields) {
      if (!plain(a[field] as string)) {
        issues.push({ level: 'error', act: key, message: `${label}为空` });
      }
    }

    // 不说没把握的数字: narration 里的数字必须在 facts 的 claim/value 里找到对应
    const facts = a.facts ?? [];
    const covered = plain(facts.map((f) => `${f.claim ?? ''}${f.value ?? ''}`).join(' '));
    for (const n of extractNumbers(narration)) {
      const token = plain(n);
      const digitsMatch = token.match(/^[\d.]+/);
      const hit = covered.includes(token) || (digitsMatch !== null && covered.includes(digitsMatch[0]));
      if (!hit) {
        issues.push({ level: 'error', act: key, message: `台词出现数字「${n}」但事实核查里没有对应条目` });
      }
    }

    // facts 条目必须标注来源
    for (const f of facts) {
      if (!plain(f.source)) {
        issues.push({ level: 'error', act: key, message: `「${f.claim ?? ''}」没有标注来源` });
      }
    }

    // 开场白: hook.narration 开头 30 字内不能出现寒暄词
    if (key === 'hook') {
      const head = flat.slice(0, 30);
      for (const g of GREETINGS) {
        if (head.includes(g)) {
          issues.push({ level: 'error', act: key, message: `开场出现寒暄「${g}」, 第一句必须是钩子本身` });
          break;
        }
      }
    }

    // 空洞形容词
    for (const w of EMPTY_ADJ) {
      if (flat.includes(w)) {
        issues.push({ level: 'warn', act: key, message: `空洞形容词「${w}」不承载信息, 建议删` });
      }
    }

    // 单句过长(念不出来)
    for (const sent of narration.split(SENT)) {
      const s = plain(sent);
      if (s.length > 30) {
        issues.push({ level: 'warn', act: key, message: `单句 ${s.length} 字, 超过 30 字要拆: ${s.slice(0, 18)}…` });
      }
    }

    // 句首悬空指代
    for (const sent of narration.split(SENT)) {
      const s = plain(sent);
      for (const d of DANGLING) {
        if (s.startsWith(d)) {
          issues.push({ level: 'warn', act: key, message: `句首出现悬空指代「${d}」: ${s.slice(0, 18)}…` });
          break;
        }
      }
    }
  }

  // ---- 收尾必须回扣开场: punchline 与 hook 至少有一个 2 字以上共同词 ----
  const hook = acts.find((a) => a.act === 'hook');
  const end = acts.find((a) => a.act === 'punchline');
  if (hook && end) {
    const h = new Set(plain(hook.narration).match(/[一-龥]{2,}/g) ?? []);
    const e = new Set(plain(end.narration).match(/[一-龥]{2,}/g) ?? []);
    const hasOverlap = [...h].some((w) => e.has(w));
    if (h.size > 0 && !hasOverlap) {
      issues.push({ level: 'warn', act: 'punchline', message: '收尾和开场没有共同词, 可能没有回扣钩子' });
    }
  }

  return issues;
}
