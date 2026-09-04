'use client';

import { useRouter } from 'next/navigation';
import { ASPECTS, ASPECT_LABELS } from '@/lib/video-template/aspect';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CAPTION_FONT_WHITELIST, defaultCaptionStyle } from '@/lib/video-template/model';
import type { VideoTemplateConfig } from '@/lib/video-template/model';

/**
 * 模板编辑器。
 *
 * **显式保存, 不做自动保存。** 工作区的稿子是自动保存的, 这里刻意不一样:
 * `PUT /api/v1/video-templates/[id]` 收的是**整份配置**(整体校验、整体替换),
 * 不是补丁。自动保存意味着每敲一个字符就整体替换一次配置, 中间任何一次请求
 * 出错或乱序到达, 覆盖掉的是整份配置而不是一个字段。改配置和写稿的容错代价
 * 不一样, 交互也就不该一样。
 */

const DELIVERY_LABELS: Record<VideoTemplateConfig['deliveryMode'], string> = {
  'ppt-narration': '图文口播',
  'talking-head-broll': '真人出镜 + B-roll',
  'illustration-tts': '插画配音',
};

const ASSET_KINDS = [
  { kind: 'bgm', field: 'bgmPath', label: '背景音乐', accept: 'audio/*', limit: '50MB 以内' },
  { kind: 'intro', field: 'introPath', label: '片头', accept: 'video/*', limit: '200MB 以内' },
  { kind: 'outro', field: 'outroPath', label: '片尾', accept: 'video/*', limit: '200MB 以内' },
] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="w-full pl-28 text-xs text-muted-foreground/70">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  'rounded-md border border-input bg-card px-3 py-1.5 text-sm focus:border-foreground/40 focus:outline-none';

function Choice<T extends string>({
  value, options, onChange,
}: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs transition-colors',
            value === o.v
              ? 'border-foreground bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TemplateEditor({
  templateId,
  initial,
  isPreset,
  productions,
}: {
  templateId: string;
  initial: VideoTemplateConfig;
  isPreset: boolean;
  productions: { id: string; status: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<VideoTemplateConfig>(initial);
  const [saved, setSaved] = useState<VideoTemplateConfig>(initial);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  const set = <K extends keyof VideoTemplateConfig>(k: K, v: VideoTemplateConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  async function save() {
    setBusy('save');
    setError('');
    try {
      const res = await fetch(`/api/v1/video-templates/${templateId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '保存失败');
        return;
      }
      setSaved(cfg);
      router.refresh();
    } catch {
      setError('保存失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  /**
   * 素材上传接口**当场就把路径写进库了**(它要把文件落到模板素材目录, 顺手记
   * 路径)。所以上传成功后必须把新路径同步进本地状态 —— 否则下一次保存会带着
   * 上传前的旧路径整体覆盖, 刚传的素材凭空消失。
   */
  async function upload(kind: string, field: keyof VideoTemplateConfig, file: File) {
    setBusy(kind);
    setError('');
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      const res = await fetch(`/api/v1/video-templates/${templateId}/assets`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '上传失败');
        return;
      }
      const path = body.data[field] as string;
      setCfg((c) => ({ ...c, [field]: path }));
      setSaved((c) => ({ ...c, [field]: path }));
    } catch {
      setError('上传失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  async function duplicate() {
    setBusy('dup');
    const res = await fetch(`/api/v1/video-templates/${templateId}/duplicate`, { method: 'POST' });
    const body = await res.json();
    setBusy('');
    if (res.ok && body?.success) router.push(`/templates/${body.data.template.id}`);
    else setError(body?.message ?? '复制失败');
  }

  const caption = cfg.captionStyle;

  return (
    <>
      <Section title="基本" hint={isPreset ? '这是内置预设，但和普通模板一样可改可复制可删。' : undefined}>
        <Row label="名称">
          <input
            value={cfg.name}
            maxLength={40}
            onChange={(e) => set('name', e.target.value)}
            className={cn(inputCls, 'min-w-64 flex-1')}
          />
        </Row>
        <Row label="说明">
          <input
            value={cfg.description}
            maxLength={200}
            placeholder="这个模板什么时候用"
            onChange={(e) => set('description', e.target.value)}
            className={cn(inputCls, 'min-w-64 flex-1')}
          />
        </Row>
        <Row label="交付方式" hint="换交付方式等于换一条出片管线，不只是换个样式。">
          <Choice
            value={cfg.deliveryMode}
            onChange={(v) => set('deliveryMode', v)}
            options={(Object.keys(DELIVERY_LABELS) as VideoTemplateConfig['deliveryMode'][]).map(
              (v) => ({ v, label: DELIVERY_LABELS[v] }),
            )}
          />
        </Row>
      </Section>

      <Section title="画面">
        {/*
          画幅排在最前: 它决定整块画布, 后面所有排版设置都在它之下。
          真人出镜不显示 —— 那条按出镜素材反推, 素材是竖的成片就必须是竖的,
          在这里给个能设错的下拉只会让人以为它管用。
        */}
        {cfg.deliveryMode === 'talking-head-broll' ? (
          <Row label="画幅" hint="真人出镜按你的出镜素材来——素材是竖屏，成片就是竖屏。">
            <span className="text-sm text-muted-foreground">跟随出镜素材</span>
          </Row>
        ) : (
          <Row label="画幅" hint="抖音是竖屏。改了要重新生成预览才生效。">
            <Choice
              value={cfg.aspect ?? '16:9'}
              onChange={(v) => set('aspect', v)}
              options={ASPECTS.map((a) => ({ v: a, label: ASPECT_LABELS[a] }))}
            />
          </Row>
        )}
        <Row label="视觉风格">
          <Choice
            value={cfg.visualStyle}
            onChange={(v) => set('visualStyle', v)}
            options={[{ v: 'card' as const, label: '卡片' }, { v: 'illustration' as const, label: '插画' }]}
          />
        </Row>
        <Row label="明暗" hint="暂不支持（旧渲染已下线）：Remotion 渲染链目前不读这个字段。">
          <Choice
            value={cfg.visualTone}
            onChange={(v) => set('visualTone', v)}
            options={[{ v: 'light' as const, label: '亮底' }, { v: 'dark' as const, label: '暗底' }]}
          />
        </Row>
        <Row label="切镜节奏" hint="暂不支持（旧渲染已下线）：新链的镜头时长由分镜时间轴独立决定，不读这个字段。留空 = 不约束。低于 1 秒就不是切镜是闪频了。">
          <input
            type="number"
            min={1}
            max={60}
            step={0.5}
            value={cfg.shotPaceSec ?? ''}
            placeholder="不约束"
            onChange={(e) => set('shotPaceSec', e.target.value === '' ? null : Number(e.target.value))}
            className={cn(inputCls, 'w-28 tabular-nums')}
          />
          <span className="text-xs text-muted-foreground">秒</span>
        </Row>
        <Row label="章节进度条">
          <Choice
            value={cfg.showChapterNav ? 'on' : 'off'}
            onChange={(v) => set('showChapterNav', v === 'on')}
            options={[{ v: 'on' as const, label: '常驻' }, { v: 'off' as const, label: '不显示' }]}
          />
        </Row>
      </Section>

      {/*
        文字叠加和真人形象是**层**, 不是交付方式 —— 所以这一段对每种模式都显示。
        第一版把它做成了第四种交付方式, 那是层级错误: 它只是口播视频的一种形式,
        而真人形象将来要能加到任何模式上。
      */}
      <Section
        title="真人形象与文字叠加"
        hint="这两项和上面的交付方式正交：图文口播、真人出镜、插画配音都能开。"
      >
        <Row
          label="文字叠加"
          hint="暂不支持（旧渲染已下线）：Remotion 产物上不会出现这一层，这个开关目前不生效。出片后自动从口播里提关键词，按「关键词 ↓ 关键词」叠在画面上。会多花一次 LLM。"
        >
          <Choice
            value={cfg.textOverlayEnabled ? 'on' : 'off'}
            onChange={(v) => set('textOverlayEnabled', v === 'on')}
            options={[{ v: 'on' as const, label: '开' }, { v: 'off' as const, label: '关' }]}
          />
        </Row>
        {cfg.textOverlayEnabled ? (
          <Row
            label="人在画面哪侧"
            hint="文字安全区靠它算：横屏人在右→字在左半边；竖屏→字在上方（人脸占中间，左右都贴脸）。不做人像识别——猜错的代价是字糊在脸上。"
          >
            <Choice
              value={cfg.personSide}
              onChange={(v) => set('personSide', v)}
              options={[
                { v: 'left' as const, label: '人在左' },
                { v: 'center' as const, label: '人在中间' },
                { v: 'right' as const, label: '人在右' },
              ]}
            />
          </Row>
        ) : null}
        {cfg.deliveryMode === 'talking-head-broll' ? (
          <Row
            label="B-roll"
            hint="关掉 = 全片就是你的出镜画面，视觉全靠文字叠加。也省掉最贵的那一圈：每镜一次 LLM + 一次逐帧截图。"
          >
            <Choice
              value={cfg.brollEnabled ? 'on' : 'off'}
              onChange={(v) => set('brollEnabled', v === 'on')}
              options={[{ v: 'on' as const, label: '生成' }, { v: 'off' as const, label: '不生成' }]}
            />
          </Row>
        ) : null}
      </Section>

      <Section
        title="字幕"
        hint="关掉 = 成片不烧字幕。抖音端有自带字幕时可以关。"
      >
        <Row label="烧字幕">
          <Choice
            value={caption ? 'on' : 'off'}
            onChange={(v) => set('captionStyle', v === 'on' ? defaultCaptionStyle() : null)}
            options={[{ v: 'on' as const, label: '烧' }, { v: 'off' as const, label: '不烧' }]}
          />
        </Row>
        {caption ? (
          <>
            <Row label="字体">
              <select
                value={caption.fontFamily}
                onChange={(e) => set('captionStyle', { ...caption, fontFamily: e.target.value as typeof caption.fontFamily })}
                className={inputCls}
              >
                {CAPTION_FONT_WHITELIST.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Row>
            <Row label="字号 / 边宽">
              <input
                type="number" min={12} max={200}
                value={caption.fontSize}
                onChange={(e) => set('captionStyle', { ...caption, fontSize: Number(e.target.value) })}
                className={cn(inputCls, 'w-24 tabular-nums')}
              />
              <input
                type="number" min={0} max={10} step={0.5}
                value={caption.outlineWidth}
                onChange={(e) => set('captionStyle', { ...caption, outlineWidth: Number(e.target.value) })}
                className={cn(inputCls, 'w-24 tabular-nums')}
              />
            </Row>
            <Row label="颜色 / 描边">
              <input
                type="color"
                value={caption.primaryColor}
                onChange={(e) => set('captionStyle', { ...caption, primaryColor: e.target.value.toUpperCase() })}
                className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-1"
              />
              <input
                type="color"
                value={caption.outlineColor}
                onChange={(e) => set('captionStyle', { ...caption, outlineColor: e.target.value.toUpperCase() })}
                className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-1"
              />
            </Row>
            <Row label="底边距" hint="字幕离画面底部多少像素。">
              <input
                type="number" min={0} max={500}
                value={caption.marginV}
                onChange={(e) => set('captionStyle', { ...caption, marginV: Number(e.target.value) })}
                className={cn(inputCls, 'w-24 tabular-nums')}
              />
            </Row>
          </>
        ) : null}
      </Section>

      <Section title="音频与片头片尾" hint="暂不支持（旧渲染已下线）：成片包装段（BGM 混音/接片头片尾）随旧渲染层一起下线，Remotion 产物不会应用这里的配置。素材全部自己上传，系统不提供曲库。">
        {ASSET_KINDS.map((a) => {
          const current = cfg[a.field] as string | null;
          return (
            <Row key={a.kind} label={a.label} hint={a.limit}>
              <input
                ref={(el) => { uploadRefs.current[a.kind] = el; }}
                type="file"
                accept={a.accept}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(a.kind, a.field, f);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy === a.kind}
                onClick={() => uploadRefs.current[a.kind]?.click()}
              >
                {busy === a.kind ? '上传中…' : current ? '换一个' : '上传'}
              </Button>
              {current ? (
                <>
                  <span className="max-w-xs truncate text-xs text-muted-foreground">
                    {current.split('/').pop()}
                  </span>
                  <button
                    type="button"
                    onClick={() => set(a.field, null as never)}
                    className="text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive"
                  >
                    移除
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground/70">未设置</span>
              )}
            </Row>
          );
        })}
        <Row label="BGM 音量" hint={`当前 ${Math.round(cfg.bgmVolume * 100)}%。口播片子压到 15~20% 才不抢人声。`}>
          <input
            type="range" min={0} max={1} step={0.05}
            value={cfg.bgmVolume}
            onChange={(e) => set('bgmVolume', Number(e.target.value))}
            className="w-56"
          />
        </Row>
      </Section>

      <Section title="写稿与生成">
        <Row label="联网研究" hint="开 = 写稿前跑一遍 Tavily 找素材。要花钱，也会变慢。">
          <Choice
            value={cfg.researchEnabled ? 'on' : 'off'}
            onChange={(v) => set('researchEnabled', v === 'on')}
            options={[{ v: 'on' as const, label: '开' }, { v: 'off' as const, label: '关' }]}
          />
        </Row>
        <Row label="Builder 模型" hint="暂不支持（旧渲染已下线）：新链的 Builder 用固定的模型选择逻辑，不读这个字段。排版吃推理能力，画面糊的时候先换这个。">
          <Choice
            value={cfg.builderModel}
            onChange={(v) => set('builderModel', v)}
            options={[
              { v: 'deepseek-chat' as const, label: 'chat（快、便宜）' },
              { v: 'deepseek-reasoner' as const, label: 'reasoner（慢、排版更稳）' },
            ]}
          />
        </Row>
        <Row label="语气">
          <input
            value={cfg.scriptPrompt?.tone ?? ''}
            maxLength={100}
            placeholder="比如：像跟朋友聊天，不说行话"
            onChange={(e) =>
              set('scriptPrompt', { ...(cfg.scriptPrompt ?? {}), tone: e.target.value || undefined })
            }
            className={cn(inputCls, 'min-w-64 flex-1')}
          />
        </Row>
        <Row label="开场提示">
          <input
            value={cfg.scriptPrompt?.hookHint ?? ''}
            maxLength={200}
            placeholder="这个模板的开场该怎么起"
            onChange={(e) =>
              set('scriptPrompt', { ...(cfg.scriptPrompt ?? {}), hookHint: e.target.value || undefined })
            }
            className={cn(inputCls, 'min-w-64 flex-1')}
          />
        </Row>
        <Row label="额外要求">
          <textarea
            value={cfg.scriptPrompt?.extraGuidance ?? ''}
            maxLength={500}
            rows={3}
            placeholder="其他要交代给写稿的事"
            onChange={(e) =>
              set('scriptPrompt', { ...(cfg.scriptPrompt ?? {}), extraGuidance: e.target.value || undefined })
            }
            className={cn(inputCls, 'min-w-64 flex-1 resize-y leading-relaxed')}
          />
        </Row>
      </Section>

      <Section title="用这个模板出的片" hint="只列最近 8 条。">
        {productions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没用它出过片。模板配好之后，在内容详情页的「剪辑」里选它发起。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {productions.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">{p.createdAt}</span>
                <span
                  className={cn(
                    'rounded px-2 py-0.5',
                    p.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-secondary',
                  )}
                >
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 保存条常驻底部: 这一页很长, 改完往回滚才能保存是最容易丢改动的形状 */}
      <div className="sticky bottom-0 -mx-10 flex items-center justify-between gap-4 border-t border-border bg-background/95 px-10 py-3 backdrop-blur">
        <div className="min-w-0 text-xs">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : dirty ? (
            <span className="text-muted-foreground">有未保存的改动</span>
          ) : (
            <span className="text-muted-foreground/60">已是最新</span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => void duplicate()}>
            {busy === 'dup' ? '复制中…' : '复制一份'}
          </Button>
          <Button size="sm" disabled={!dirty || busy !== ''} onClick={() => void save()}>
            {busy === 'save' ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </>
  );
}
