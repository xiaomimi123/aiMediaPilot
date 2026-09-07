import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, CARD_TYPES, describeCardsForPrompt } from '@/lib/video-production/shot-plan';

const base = { shotId: 's1', startMs: 0, endMs: 4000 };

describe('五张新卡的 schema', () => {
  it('CARD_TYPES 扩到 9 张', () => {
    expect(CARD_TYPES).toEqual([
      'statement', 'stat', 'contrast', 'list', 'ring', 'odometer', 'curve', 'rank', 'entity',
    ]);
  });

  it('ring: 合法通过; max 缺省为 100', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'ring', slots: { label: '四线城市占比', value: 32.2, suffix: '%' } });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { slots: { max: number } }).slots.max).toBe(100);
  });

  it('odometer: value 必须是整数', () => {
    expect(ShotPlanSchema.safeParse({ ...base, card: 'odometer', slots: { label: '累计', value: 11000 } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'odometer', slots: { label: '累计', value: 32.2 } }).success).toBe(false);
  });

  it('curve: points 少于 3 个被拒, 多于 8 个被拒', () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ at: `第${i}月`, value: i * 10 }));
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(2) } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(3) } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(9) } }).success).toBe(false);
  });

  it('curve: 数组元素也是 strict —— 点里多一个字段就失败', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'curve',
      slots: { label: '增长', points: [{ at: '1月', value: 1, color: 'red' }, { at: '2月', value: 2 }, { at: '3月', value: 3 }] },
    });
    expect(r.success).toBe(false);
  });

  it('rank: rows 2~6 项', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `第${i}名`, value: 100 - i }));
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(1) } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(2) } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(7) } }).success).toBe(false);
  });

  it('entity: chips 1~3 块, tone 只认 light/dark', () => {
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [{ name: 'DeepSeek', tone: 'dark' }] } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [{ name: 'X', tone: 'blue' }] } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [] } }).success).toBe(false);
  });

  it('报错仍然精准 —— 单一分支的问题, 不是四个分支的并列噪音', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'ring', slots: { label: '占比', value: '32.2' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0].path).toEqual(['slots', 'value']);
    }
  });
});

describe('九张卡的说明', () => {
  const text = describeCardsForPrompt();

  it('每张卡都有一段说明', () => {
    for (const t of ['statement', 'stat', 'contrast', 'list', 'ring', 'odometer', 'curve', 'rank', 'entity']) {
      expect(text, `${t} 缺说明`).toContain(`\`${t}\``);
    }
  });

  it('容易混的四对都写了可判定的界线', () => {
    expect(text).toContain('有分母');      // ring vs stat
    expect(text).toContain('必须是整数');  // odometer vs stat
    expect(text).toContain('不讲中间过程'); // curve vs contrast
    expect(text).toContain('不比大小');    // rank vs list
  });

  it('卡片说明里不提 style/坐标/颜色 —— 那些不归模型管', () => {
    /*
     * 只查卡片说明那几行(以 `- \`` 开头的), 不查整段提示词。
     * 我最初写成 `expect(text).not.toMatch(...)` 查全文, 结果被三十二期就有的
     * 收尾句「不要输出坐标、颜色、字号、动画参数」判红 —— 那句话恰恰是在**禁止**
     * 模型输出这些, 与本条的意图同向。断言写得比意图宽, 就会把满足意图的写法也判成
     * 违规。改成只查卡片说明本身: 一张卡的介绍里不该出现视觉参数, 全局禁令则该出现。
     */
    const cardLines = text.split('\n').filter((l) => l.trimStart().startsWith('- `'));
    expect(cardLines.length).toBeGreaterThanOrEqual(9);
    for (const line of cardLines) {
      expect(line, `卡片说明里出现了视觉参数: ${line}`).not.toMatch(/style|accent|坐标|字号/);
    }
  });
});

describe('单位槽位的命名跨卡一致', () => {
  /*
   * 三十三期实测出的故障: 新卡最初用 `unit` 装单位, 而老卡 `stat` 用 `suffix`。
   * 同一个概念两个名字, 模型会串填 —— 真实运行里出现过
   * `shots.11.slots: Unrecognized key(s) in object: 'unit'`(把 unit 填进了 stat),
   * 而 .strict() 下这是**整片失败**, 不是少一个单位。
   *
   * 统一到 `suffix`(老卡已在用的那个名字)之后, `unit` 这个名字在契约里不复存在,
   * 也就没有了串填的来源。这条断言钉住它: 谁再引入 `unit`, 或者给某张卡起第三个
   * 名字装单位, 都在这里红。
   *
   * 判据走 zod 自省而不是搜字符串 —— 搜字符串会被注释和变量名骗过去。
   */
  const slotKeysOf = (card: string): string[] => {
    const union = (ShotPlanSchema as unknown as { innerType: () => { options: Array<{ shape: { card: { value: string }; slots: { shape: Record<string, unknown> } } }> } }).innerType();
    const variant = union.options.find((o) => o.shape.card.value === card);
    expect(variant, `${card} 在 discriminatedUnion 里没有分支`).toBeTruthy();
    /*
     * `contrast` 的 slots 外面裹了一层 z.preprocess(丢弃遗留的 connector 字段),
     * 那是 ZodEffects 而不是 ZodObject, 直接读 .shape 会是 undefined。
     * 剥到里层再取键 —— 这一层包装是既有设计, 不该为了让测试好写而去掉它。
     */
    const slotsSchema = variant!.shape.slots as unknown as {
      shape?: Record<string, unknown>;
      _def?: { schema?: { shape?: Record<string, unknown> } };
    };
    const shape = slotsSchema.shape ?? slotsSchema._def?.schema?.shape;
    expect(shape, `${card} 的 slots 取不到字段表`).toBeTruthy();
    return Object.keys(shape!);
  };

  it('没有任何一张卡用 `unit` 当槽位名', () => {
    for (const card of CARD_TYPES) {
      expect(slotKeysOf(card), `${card} 用了 unit —— 单位一律叫 suffix`).not.toContain('unit');
    }
  });

  it('带单位的卡都叫 suffix', () => {
    // 这五张卡的语义里有"单位"这件事; 其余四张没有, 不该凭空长出来
    for (const card of ['stat', 'ring', 'odometer', 'curve', 'rank']) {
      expect(slotKeysOf(card), `${card} 应当有 suffix 装单位`).toContain('suffix');
    }
  });
});
