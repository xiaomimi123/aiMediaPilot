'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PersonaPillar, PersonaProfileData } from '@/lib/persona/profile';
import type { CreatorVoiceData } from '@/lib/persona/voice';

/**
 * 月度内容规划问答式向导 (三十八期 Task 4)。
 *
 * 自媒体小白的第一入口 —— `/plan` 无活跃规划时渲染这个组件。五问单页,
 * 一屏一问, 顶部进度点。设计取自 `docs/superpowers/plans/2026-09-10-content-plan.md`
 * Task 4 一节, 保存时序照该节「先档案后规划, 中途失败不产生悬空态」的硬约束。
 *
 * 复用判断(见任务报告): 内容支柱起草没有走 `/api/v1/persona/draft`(那条路由要
 * 固定 9 问 answers 输入, 输出还强制要求 painPoints/offerings/productLogic 三个
 * 这里没有素材支撑的字段), 改用新建的 `/api/v1/content-plans/draft-pillars`
 * (只收一段自由文本, 只出 pillars)。
 *
 * 保存三段式, 每段各自有「已保存」标记, retry 时按标记跳过已完成的段落 ——
 * 这是不产生悬空态误导的关键: 档案 PUT 成功了就真的只做一次, 不会因为后面
 * 规划生成失败而被重复提交。
 */

const inputCls =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed ' +
  'placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none';

export interface PlanTemplateOption {
  id: string;
  name: string;
  deliveryMode: string;
}

export interface OnboardingWizardProps {
  /** 服务端传入的模板列表, 供第⑤步下拉选默认模板。 */
  templates: PlanTemplateOption[];
  /** 服务端已 GET 到的完整人设档案(可能全空)——第①②步预填与保存合并的基线。 */
  initialProfile: PersonaProfileData;
  /** 服务端已 GET 到的完整人物志(可能全空)——第③步预填与保存合并的基线。 */
  initialVoice: CreatorVoiceData;
  /** 规划生成成功后回调, 由 /plan 页面(Task 5)接管刷新。 */
  onDone: (planId: string) => void;
}

const STEP_TITLES = ['做什么方向', '给谁看', '你有什么可讲', '每周拍几条', '默认模板'];

type SaveStage = null | 'profile' | 'voice' | 'generate';

function pillarsEqual(a: PersonaPillar[], b: PersonaPillar[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readJson(res: Response): Promise<{ ok: boolean; message: string; data: unknown }> {
  let body: { success?: boolean; message?: string; data?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: '响应不是合法 JSON', data: undefined };
  }
  return { ok: res.ok && body?.success === true, message: body?.message ?? '请求失败', data: body?.data };
}

export function OnboardingWizard({ templates, initialProfile, initialVoice, onDone }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);

  // 第①步: 内容支柱。已有支柱直接进确认卡态; 没有则先收自由文本再起草。
  const [pillarMode, setPillarMode] = useState<'input' | 'confirm'>(
    initialProfile.pillars.length > 0 ? 'confirm' : 'input',
  );
  const [freeText, setFreeText] = useState('');
  const [pillars, setPillars] = useState<PersonaPillar[]>(initialProfile.pillars);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [pillarError, setPillarError] = useState('');

  // 第②③步
  const [audience, setAudience] = useState(initialProfile.audience);
  const [identity, setIdentity] = useState(initialVoice.identity);

  // 第④⑤步
  const [weeklyCadence, setWeeklyCadence] = useState(3);
  const [defaultTemplateId, setDefaultTemplateId] = useState(templates[0]?.id ?? '');

  // 保存状态机 —— 三段各自的「已保存」标记, retry 靠它跳过已完成段落。
  const [profileSaved, setProfileSaved] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [saveStage, setSaveStage] = useState<SaveStage>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const profileDirty = audience !== initialProfile.audience || !pillarsEqual(pillars, initialProfile.pillars);
  const voiceDirty = identity !== initialVoice.identity;

  async function draftPillars() {
    if (!freeText.trim()) {
      setDraftError('先说说想做什么内容');
      return;
    }
    setDrafting(true);
    setDraftError('');
    try {
      const res = await fetch('/api/v1/content-plans/draft-pillars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ freeText }),
      });
      const { ok, message, data } = await readJson(res);
      if (!ok) {
        setDraftError(message);
        return;
      }
      setPillars((data as { pillars: PersonaPillar[] }).pillars);
      setPillarMode('confirm');
    } catch {
      setDraftError('起草失败，请检查网络');
    } finally {
      setDrafting(false);
    }
  }

  function goNextFromPillars() {
    if (pillarMode === 'input') {
      void draftPillars();
      return;
    }
    if (pillars.length === 0) {
      setPillarError('至少需要 1 条内容支柱才能继续');
      return;
    }
    setPillarError('');
    setStep(1);
  }

  async function saveProfileIfNeeded(): Promise<boolean> {
    if (!profileDirty || profileSaved) return true;
    setSaveStage('profile');
    const getRes = await fetch('/api/v1/persona/profile');
    const got = await readJson(getRes);
    if (!got.ok) {
      setSaveError(`读取现有档案失败: ${got.message}`);
      return false;
    }
    const current = got.data as PersonaProfileData & { established?: boolean };
    const { established: _established, ...currentProfile } = current;
    const merged: PersonaProfileData = { ...currentProfile, audience, pillars };
    const putRes = await fetch('/api/v1/persona/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    const put = await readJson(putRes);
    if (!put.ok) {
      setSaveError(`档案保存失败: ${put.message}`);
      return false;
    }
    setProfileSaved(true);
    return true;
  }

  async function saveVoiceIfNeeded(): Promise<boolean> {
    if (!voiceDirty || voiceSaved) return true;
    setSaveStage('voice');
    const getRes = await fetch('/api/v1/voice/profile');
    const got = await readJson(getRes);
    if (!got.ok) {
      setSaveError(`读取现有人物志失败: ${got.message}`);
      return false;
    }
    const current = got.data as CreatorVoiceData & { established?: boolean };
    const { established: _established, ...currentVoice } = current;
    const merged: CreatorVoiceData = { ...currentVoice, identity };
    const putRes = await fetch('/api/v1/voice/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    const put = await readJson(putRes);
    if (!put.ok) {
      setSaveError(`人物志保存失败: ${put.message}`);
      return false;
    }
    setVoiceSaved(true);
    return true;
  }

  async function finish() {
    setSaving(true);
    setSaveError('');
    try {
      if (!(await saveProfileIfNeeded())) return;
      if (!(await saveVoiceIfNeeded())) return;

      setSaveStage('generate');
      const genRes = await fetch('/api/v1/content-plans/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weeklyCadence, defaultTemplateId: defaultTemplateId || undefined }),
      });
      const gen = await readJson(genRes);
      if (!gen.ok) {
        setSaveError(`规划生成失败: ${gen.message}`);
        return;
      }
      setSaveStage(null);
      onDone((gen.data as { planId: string }).planId);
    } catch {
      setSaveError('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  }

  const savedSoFarNote =
    saveStage === 'voice'
      ? '定位档案已保存；'
      : saveStage === 'generate'
        ? [profileSaved ? '定位档案已保存' : null, voiceSaved ? '人物志已保存' : null]
            .filter(Boolean)
            .join('、') + (profileSaved || voiceSaved ? '；' : '')
        : '';

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
      {/* 顶部进度点 */}
      <div className="flex items-center justify-center gap-2">
        {STEP_TITLES.map((title, i) => (
          <span
            key={title}
            className={cn(
              'h-1.5 w-6 rounded-full transition-colors',
              i === step ? 'bg-foreground' : i < step ? 'bg-foreground/50' : 'bg-muted',
            )}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        第 {step + 1} / {STEP_TITLES.length} 步 · {STEP_TITLES[step]}
      </p>

      {step === 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">你想做什么内容？</h2>
          {pillarMode === 'input' ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                用你自己的话说：想做什么内容？擅长/热爱什么？
              </p>
              <textarea
                value={freeText}
                rows={5}
                maxLength={2000}
                placeholder="比如：我平时喜欢折腾各种 AI 工具，经常帮朋友解决工具选型的问题……"
                onChange={(e) => setFreeText(e.target.value)}
                className={inputCls}
              />
              {draftError ? <p className="text-xs text-destructive">{draftError}</p> : null}
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                这是你的内容支柱，可以直接改，也可以增删。
              </p>
              <div className="flex flex-col gap-2">
                {pillars.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <input
                        value={p.name}
                        maxLength={10}
                        placeholder="支柱名（10 字内）"
                        onChange={(e) =>
                          setPillars(pillars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                        }
                        className={inputCls}
                      />
                      <input
                        value={p.description}
                        maxLength={60}
                        placeholder="具体讲什么"
                        onChange={(e) =>
                          setPillars(
                            pillars.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                          )
                        }
                        className={inputCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPillars(pillars.filter((_, j) => j !== i))}
                      className="mt-2 shrink-0 text-xs text-muted-foreground hover:text-destructive"
                    >
                      删除
                    </button>
                  </div>
                ))}
                {pillars.length < 5 ? (
                  <button
                    type="button"
                    onClick={() => setPillars([...pillars, { name: '', description: '' }])}
                    className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    + 加一条支柱
                  </button>
                ) : null}
              </div>
              {pillarError ? <p className="text-xs text-destructive">{pillarError}</p> : null}
            </>
          )}
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">给谁看？</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">他们是谁、卡在什么地方。</p>
          <input
            aria-label="受众"
            value={audience}
            maxLength={300}
            placeholder="比如：想用 AI 做点东西、但每次装环境就卡住的普通人"
            onChange={(e) => setAudience(e.target.value)}
            className={inputCls}
          />
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">你有什么可讲？</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">你是谁/凭什么讲这个（一句话）。</p>
          <input
            aria-label="身份"
            value={identity}
            maxLength={200}
            placeholder="比如：做过 3 年 AI 产品经理，踩过的坑比读过的文章多"
            onChange={(e) => setIdentity(e.target.value)}
            className={inputCls}
          />
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">每周拍几条？</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">新手建议每周 3 条起步，稳定后再加。</p>
          <select
            aria-label="每周拍几条"
            value={weeklyCadence}
            onChange={(e) => setWeeklyCadence(Number(e.target.value))}
            className={inputCls}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                每周 {n} 条
              </option>
            ))}
          </select>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">选一个默认模板</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            出片时预选这个模板；出镜模板每条要自己拍口播。
          </p>
          <select
            aria-label="默认模板"
            value={defaultTemplateId}
            onChange={(e) => setDefaultTemplateId(e.target.value)}
            className={inputCls}
          >
            <option value="">不设置默认模板</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.deliveryMode === 'talking-head-broll' ? '（真人出镜，需自己拍口播）' : ''}
              </option>
            ))}
          </select>

          {saveError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed">
              <p className="text-destructive">
                {savedSoFarNote}
                {saveError}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={step === 0 || saving} onClick={() => setStep(step - 1)}>
          上一步
        </Button>
        {step < 4 ? (
          <Button size="sm" disabled={drafting} onClick={step === 0 ? goNextFromPillars : () => setStep(step + 1)}>
            {step === 0 && pillarMode === 'input' ? (drafting ? '起草中…' : '下一步（AI 起草支柱）') : '下一步'}
          </Button>
        ) : (
          <Button size="sm" disabled={saving} onClick={() => void finish()}>
            {saving ? '生成中…' : saveError ? '从这一步重试' : '生成我的 30 天规划'}
          </Button>
        )}
      </div>
    </div>
  );
}
