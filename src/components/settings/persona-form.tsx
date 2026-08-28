'use client';

import type { PersonaProfileData } from '@/lib/persona/profile';
import { Field, ItemList, SaveBar, Section, inputCls, useSaved } from './primitives';

/**
 * 账号定位(人设)。
 *
 * 这份档案会被注入到雷达打分、选题、写稿三处 prompt 里。填得越具体, AI 越不容易
 * 写出「谁都能发」的东西 —— 空着的时候它只能按通用爆款套路来, 那正是会被算法
 * 抹平的部分。
 *
 * `systemSummary` 是 AI 生成的总结, 这里**只读展示不给编辑**: 它由
 * `/api/v1/persona/summary` 依据其余字段重算, 手改了下次重算就没了, 给一个
 * 会被悄悄覆盖的输入框是在骗人。
 */
export function PersonaForm({ initial }: { initial: PersonaProfileData }) {
  const s = useSaved(initial, '/api/v1/persona/profile');
  const p = s.value;
  const set = <K extends keyof PersonaProfileData>(k: K, v: PersonaProfileData[K]) =>
    s.setValue({ ...p, [k]: v });

  return (
    <>
      <Section title="你在对谁说话" hint="这两栏空着的时候，AI 只能按通用爆款套路写。">
        <Field label="受众" hint="他们是谁、卡在什么地方。越具体越好。">
          <textarea
            value={p.audience}
            maxLength={300}
            rows={3}
            placeholder="比如：想用 AI 做点东西、但每次装环境就卡住的普通人"
            onChange={(e) => set('audience', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="想要的粉丝" hint="不是「越多越好」，是你希望留下哪种人。">
          <textarea
            value={p.targetFans}
            maxLength={300}
            rows={2}
            onChange={(e) => set('targetFans', e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="内容支柱" hint="你反复讲的几件事。最多 5 条 —— 超过 5 条就等于没有重点。">
        <ItemList
          items={p.pillars}
          onChange={(v) => set('pillars', v)}
          max={5}
          empty="还没有支柱。至少填 1 条，档案才算建立。"
          addLabel="+ 加一条支柱"
          make={() => ({ name: '', description: '' })}
          render={(item, update) => (
            <>
              <input
                value={item.name}
                maxLength={10}
                placeholder="支柱名（10 字内）"
                onChange={(e) => update({ name: e.target.value })}
                className={inputCls}
              />
              <input
                value={item.description}
                maxLength={60}
                placeholder="具体讲什么"
                onChange={(e) => update({ description: e.target.value })}
                className={inputCls}
              />
            </>
          )}
        />
      </Section>

      <Section title="视角与红线">
        <Field label="独特视角" hint="同一件事，你和别人讲得不一样在哪。">
          <textarea
            value={p.angle}
            maxLength={300}
            rows={3}
            onChange={(e) => set('angle', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="不碰的东西" hint="会写进 prompt 当硬约束。">
          <textarea
            value={p.avoid}
            maxLength={300}
            rows={2}
            placeholder="比如：不喊口号、不制造焦虑、不展示收益截图"
            onChange={(e) => set('avoid', e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="受众的痛点" hint="有证据的痛点才有用 —— 没有证据的那条通常是你想象出来的。">
        <ItemList
          items={p.painPoints}
          onChange={(v) => set('painPoints', v)}
          max={6}
          empty="还没记录痛点。"
          addLabel="+ 加一个痛点"
          make={() => ({ pain: '', evidence: '' })}
          render={(item, update) => (
            <>
              <input
                value={item.pain}
                maxLength={30}
                placeholder="痛点（30 字内）"
                onChange={(e) => update({ pain: e.target.value })}
                className={inputCls}
              />
              <input
                value={item.evidence}
                maxLength={60}
                placeholder="你从哪看出来的（评论、私信、自己踩过）"
                onChange={(e) => update({ evidence: e.target.value })}
                className={inputCls}
              />
            </>
          )}
        />
      </Section>

      <Section title="你能提供什么" hint="工具 / 服务 / 课程。填了它，写稿才知道往哪落。">
        <ItemList
          items={p.offerings}
          onChange={(v) => set('offerings', v)}
          max={5}
          empty="还没有产品或服务。"
          addLabel="+ 加一个"
          make={() => ({ name: '', type: 'tool' as const, description: '', targetPain: '' })}
          render={(item, update) => (
            <>
              <div className="flex gap-2">
                <input
                  value={item.name}
                  maxLength={20}
                  placeholder="名字"
                  onChange={(e) => update({ name: e.target.value })}
                  className={inputCls}
                />
                <select
                  value={item.type}
                  onChange={(e) => update({ type: e.target.value as typeof item.type })}
                  className={inputCls + ' w-28'}
                >
                  <option value="tool">工具</option>
                  <option value="service">服务</option>
                  <option value="course">课程</option>
                </select>
              </div>
              <input
                value={item.description}
                maxLength={80}
                placeholder="它是什么"
                onChange={(e) => update({ description: e.target.value })}
                className={inputCls}
              />
              <input
                value={item.targetPain}
                maxLength={30}
                placeholder="解决上面哪个痛点"
                onChange={(e) => update({ targetPain: e.target.value })}
                className={inputCls}
              />
            </>
          )}
        />
        <Field label="产品逻辑" hint="这些东西怎么串成一条线。">
          <textarea
            value={p.productLogic}
            maxLength={500}
            rows={3}
            onChange={(e) => set('productLogic', e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      {p.marketInsight ? (
        <Section
          title="市场判断"
          hint={`AI 于 ${p.marketInsight.researchedAt.slice(0, 10)} 调研生成。可以直接改。`}
        >
          {(
            [
              ['landscape', '赛道现状'],
              ['mainstream', '主流打法'],
              ['unmet', '没被满足的'],
              ['opportunity', '你的机会'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea
                value={p.marketInsight![k]}
                maxLength={300}
                rows={2}
                onChange={(e) =>
                  set('marketInsight', { ...p.marketInsight!, [k]: e.target.value })
                }
                className={inputCls}
              />
            </Field>
          ))}
        </Section>
      ) : null}

      {p.systemSummary ? (
        <Section
          title="系统总结"
          hint="由上面这些字段自动生成，只读 —— 手改了下次重算就没了。"
        >
          <p className="whitespace-pre-wrap rounded-md border-l-2 border-foreground/25 bg-secondary/45 p-3.5 text-sm leading-relaxed text-muted-foreground">
            {p.systemSummary}
          </p>
        </Section>
      ) : null}

      <SaveBar dirty={s.dirty} busy={s.busy} error={s.error} onSave={() => void s.save()} />
    </>
  );
}
