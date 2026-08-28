'use client';

import type { CreatorVoiceData } from '@/lib/persona/voice';
import { Field, ItemList, SaveBar, Section, inputCls, useSaved } from './primitives';

/**
 * 我的口吻。
 *
 * 和「账号定位」的分工: 定位说的是**讲什么**, 口吻说的是**谁在讲**。定位可以
 * 被同行抄走, 口吻抄不走 —— 它是来路、身份和立场, 那些是一手的。
 *
 * 「不是谁」这一栏看着别扭但很有用: 说清楚自己不是什么, 比说自己是什么更能
 * 挡住 AI 往通用人设上滑。
 */
export function VoiceForm({ initial }: { initial: CreatorVoiceData }) {
  const s = useSaved(initial, '/api/v1/voice/profile');
  const v = s.value;
  const set = <K extends keyof CreatorVoiceData>(k: K, val: CreatorVoiceData[K]) =>
    s.setValue({ ...v, [k]: val });

  return (
    <>
      <Section title="你是谁" hint="只有「是谁」这一栏填了，口吻才会被注入写稿。">
        <Field label="是谁" hint="一句话。不是头衔，是你在读者眼里的角色。">
          <input
            value={v.identity}
            maxLength={200}
            placeholder="比如：一个自己踩过所有坑、然后把路径写下来的人"
            onChange={(e) => set('identity', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="不是谁" hint="说清楚不是什么，比说是什么更能挡住 AI 往通用人设上滑。">
          <input
            value={v.notIdentity}
            maxLength={200}
            placeholder="比如：不是讲师，不是测评号，不是搬运工"
            onChange={(e) => set('notIdentity', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="来路" hint="你怎么走到这儿的。这段是同行抄不走的部分。">
          <textarea
            value={v.origin}
            maxLength={500}
            rows={4}
            onChange={(e) => set('origin', e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="立场" hint="你反复主张、并且愿意为它得罪人的判断。最多 5 条。">
        <ItemList
          items={v.stances}
          onChange={(val) => set('stances', val)}
          max={5}
          empty="还没有立场。没有立场的账号，讲什么都像在复述别人。"
          addLabel="+ 加一条立场"
          make={() => ({ claim: '', reason: '' })}
          render={(item, update) => (
            <>
              <input
                value={item.claim}
                maxLength={50}
                placeholder="主张（50 字内）"
                onChange={(e) => update({ claim: e.target.value })}
                className={inputCls}
              />
              <input
                value={item.reason}
                maxLength={100}
                placeholder="为什么这么认为"
                onChange={(e) => update({ reason: e.target.value })}
                className={inputCls}
              />
            </>
          )}
        />
      </Section>

      <Section title="情绪基调" hint="讲话时的底色。写稿会照着这个调子来。">
        <Field label="基调">
          <textarea
            value={v.energy}
            maxLength={200}
            rows={2}
            placeholder="比如：平静但笃定，不激动，不卖惨"
            onChange={(e) => set('energy', e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      <SaveBar dirty={s.dirty} busy={s.busy} error={s.error} onSave={() => void s.save()} />
    </>
  );
}
