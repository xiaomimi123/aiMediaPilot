"use client";

import { useEffect, useState } from "react";
import {
  CAPTION_FONT_WHITELIST,
  defaultCaptionStyle,
  type CaptionStyle,
  type TemplateDeliveryMode,
  type VideoTemplateConfig,
} from "@/lib/video-template/model";
import { VideoProductionPanel } from "../video-production-panel";
import { Icon } from "../shared";

/**
 * 「模板」视图(二十期 T10) — 模板列表 / 编辑器 / 出片向导三段式, 顶层用 `mode` 切换。
 * 本视图自取数(照抄 positioning.tsx 的自取数惯例), 不进 WorkspaceState、不消费
 * `refreshWorkspace`——模板/出片是与 cockpit workspace 完全独立的服务端域, 只在
 * 出片向导「选已定稿」/「从灵感出稿」两个 tab 里临时借读一次 `/api/v1/cockpit/workspace`
 * 取内容卡与灵感, 不做双向同步。
 */

type StoredTemplate = VideoTemplateConfig & { id: string; isPreset: boolean };

type Mode = "list" | "edit" | "produce";

type WizardStep = "script" | "upload" | "voice" | "produce";

const DELIVERY_MODE_LABELS: Record<TemplateDeliveryMode, string> = {
  "ppt-narration": "图文口播",
  "talking-head-broll": "真人出镜 + B-roll",
  "illustration-tts": "插画配音",
};

const STEP_LABELS: Record<WizardStep, string> = {
  script: "定文案",
  upload: "上传出镜视频",
  voice: "确认配音",
  produce: "生成与审片",
};

const PRODUCTION_STATUS_LABELS: Record<string, string> = {
  queued: "排队中", source_uploaded: "视频已上传", directing: "构思分镜中", building: "搭建画面中",
  assembling: "拼接预览中", preview_ready: "预览就绪", approved: "确认渲染中",
  rendering: "渲染中", packaging: "包装成片中", done: "已完成", failed: "生成失败",
};

interface SixActPreview {
  acts: Array<{ act: string; title: string; narration: string }>;
  four_dims?: unknown;
}

interface ExistingContentOption {
  id: string;
  title: string;
}

interface InspirationOption {
  id: string;
  text: string;
}

interface HistoryProduction {
  id: string;
  status: string;
  masterPath: string | null;
  mode?: string;
  previewPath?: string | null;
  contentId?: string;
  createdAt?: string;
}

/** 统一读取 `{ data }` 包装体——`ok`/`success` 字段名两处不一致(见 api.ts 与本任务测试
 * 夹具), 只认 `data` 是否存在, 兼容两种形状。 */
async function readData<T>(res: Response): Promise<T | null> {
  try {
    const json = await res.json();
    return (json?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

function stepsForMode(deliveryMode: TemplateDeliveryMode): WizardStep[] {
  const steps: WizardStep[] = ["script"];
  if (deliveryMode === "talking-head-broll") steps.push("upload");
  if (deliveryMode === "illustration-tts") steps.push("voice");
  steps.push("produce");
  return steps;
}

function emptyTemplateConfig(): VideoTemplateConfig {
  return {
    name: "",
    description: "",
    deliveryMode: "ppt-narration",
    visualStyle: "card",
    palette: null,
    voicePreset: null,
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.15,
    introPath: null,
    outroPath: null,
  };
}

export function TemplatesView() {
  const [mode, setMode] = useState<Mode>("list");
  const [templates, setTemplates] = useState<StoredTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VideoTemplateConfig>(emptyTemplateConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [assetUploading, setAssetUploading] = useState<"bgm" | "intro" | "outro" | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  const [activeTemplate, setActiveTemplate] = useState<StoredTemplate | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [scriptSource, setScriptSource] = useState<"existing" | "paste" | "inspiration">("existing");
  const [existingContents, setExistingContents] = useState<ExistingContentOption[]>([]);
  const [inspirations, setInspirations] = useState<InspirationOption[]>([]);
  const [selectedContentId, setSelectedContentId] = useState("");
  const [selectedInspirationId, setSelectedInspirationId] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [scriptGenerating, setScriptGenerating] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [generatedScript, setGeneratedScript] = useState<SixActPreview | null>(null);
  const [uploadVideoFile, setUploadVideoFile] = useState<File | null>(null);
  const [voiceTypeInput, setVoiceTypeInput] = useState("");
  const [producing, setProducing] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);
  const [producedContentId, setProducedContentId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryProduction[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);
    fetch("/api/v1/video-templates")
      .then((res) => readData<{ templates: StoredTemplate[] }>(res))
      .then((data) => {
        if (cancelled) return;
        // data 为 null 说明响应体没带 templates 字段(网络成功但形状不对/后端报错),
        // 与"确实一条模板都没有"(templates: [])区分开——后者是合法空态, 不算失败。
        if (!data) { setListError("加载模板列表失败，请刷新重试"); return; }
        setTemplates(data.templates ?? []);
      })
      .catch(() => { if (!cancelled) setListError("加载模板列表失败，请检查网络后重试"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  // 出片向导进入「定文案」步骤才需要「选已定稿」/「从灵感出稿」两个 tab 的候选数据,
  // 借读一次 workspace, 不做增量同步(见组件顶部注释)。
  useEffect(() => {
    if (mode !== "produce") return;
    let cancelled = false;
    fetch("/api/v1/cockpit/workspace")
      .then((res) => readData<{ state?: { contents?: Array<{ id: string; title: string; scriptDraftId?: string | null }>; inspirationCards?: InspirationOption[] } }>(res))
      .then((data) => {
        if (cancelled) return;
        const contents = data?.state?.contents ?? [];
        setExistingContents(contents.filter((c) => c.scriptDraftId).map((c) => ({ id: c.id, title: c.title })));
        setInspirations(data?.state?.inspirationCards ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode]);

  function openEditor(template: StoredTemplate | null) {
    setEditingId(template?.id ?? null);
    setForm(template ? { ...template } : emptyTemplateConfig());
    setSaveError(null);
    setMode("edit");
  }

  function openWizard(template: StoredTemplate) {
    setActiveTemplate(template);
    setStepIndex(0);
    setScriptSource("existing");
    setSelectedContentId("");
    setSelectedInspirationId("");
    setPasteText("");
    setGeneratedScript(null);
    setScriptError(null);
    setUploadVideoFile(null);
    setVoiceTypeInput(template.voicePreset?.voiceType ?? "");
    setProduceError(null);
    setProducedContentId(null);
    setHistory([]);
    setMode("produce");
  }

  async function handleDuplicate(id: string) {
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/video-templates/${id}/duplicate`, { method: "POST" });
      const data = await readData<{ template: StoredTemplate }>(res);
      // 复制成功以「拿到新模板记录」为准, 不是「请求发出去了」——旧实现不检查响应就
      // 直接刷新列表, 复制失败时列表纹丝不动却让用户误以为"已经复制好了"。
      if (!data?.template) { setActionError("复制失败，请重试"); return; }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("复制失败，请检查网络后重试");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除这个模板吗？删除后不可恢复。")) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/video-templates/${id}`, { method: "DELETE" });
      const data = await readData<{ deleted: boolean }>(res);
      if (!data?.deleted) { setActionError("删除失败，请重试"); return; }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("删除失败，请检查网络后重试");
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = editingId
        ? await fetch(`/api/v1/video-templates/${editingId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(form),
          })
        : await fetch("/api/v1/video-templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(form),
          });
      const data = await readData<{ template: StoredTemplate }>(res);
      if (!data?.template) { setSaveError("保存失败，请检查表单填写"); return; }
      setEditingId(data.template.id);
      setRefreshKey((k) => k + 1);
      setMode("list");
    } catch {
      setSaveError("保存失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssetUpload(kind: "bgm" | "intro" | "outro", file: File) {
    if (!editingId) return;
    setAssetUploading(kind);
    setAssetError(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch(`/api/v1/video-templates/${editingId}/assets`, { method: "POST", body: fd });
      const data = await readData<Record<string, string>>(res);
      const field = kind === "bgm" ? "bgmPath" : kind === "intro" ? "introPath" : "outroPath";
      if (data && typeof data[field] === "string") {
        setForm((prev) => ({ ...prev, [field]: data[field] }));
      } else {
        setAssetError("素材上传失败，请重试");
      }
    } catch {
      setAssetError("素材上传失败，请检查网络后重试");
    } finally {
      setAssetUploading(null);
    }
  }

  async function handleGenerateScript() {
    if (!activeTemplate) return;
    setScriptGenerating(true);
    setScriptError(null);
    try {
      const body = scriptSource === "paste"
        ? { source: "paste", text: pasteText }
        : { source: "inspiration", inspirationId: selectedInspirationId };
      const res = await fetch(`/api/v1/video-templates/${activeTemplate.id}/script`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readData<{ script: SixActPreview }>(res);
      if (!data?.script) { setScriptError("生成失败，请重试"); return; }
      setGeneratedScript(data.script);
    } catch {
      setScriptError("生成失败，请检查网络后重试");
    } finally {
      setScriptGenerating(false);
    }
  }

  const steps = activeTemplate ? stepsForMode(activeTemplate.deliveryMode) : [];
  const currentStep = steps[stepIndex];
  const canGoNext = currentStep === "script"
    ? (scriptSource === "existing" ? !!selectedContentId : !!generatedScript)
    : currentStep === "upload"
      ? !!uploadVideoFile
      : true;

  async function handleProduce() {
    if (!activeTemplate) return;
    setProducing(true);
    setProduceError(null);
    try {
      // 只有真的改动过配音音色才带 voiceOverride——原样把模板预设值回传会让 produce 路由
      // 把"用模板预设"误判成"本次要临时覆盖", 语义上不是一回事(task-10b 缺口2)。
      const trimmedVoiceType = voiceTypeInput.trim();
      const templateVoiceType = activeTemplate.voicePreset?.voiceType ?? "";
      const voiceOverride = activeTemplate.deliveryMode === "illustration-tts" && trimmedVoiceType && trimmedVoiceType !== templateVoiceType
        ? { voiceType: trimmedVoiceType }
        : undefined;
      const body = {
        ...(scriptSource === "existing" ? { contentId: selectedContentId } : { script: generatedScript }),
        ...(voiceOverride ? { voiceOverride } : {}),
      };
      const res = await fetch(`/api/v1/video-templates/${activeTemplate.id}/produce`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readData<{ videoProductionId: string; status: string; contentId: string }>(res);
      if (!data?.videoProductionId) { setProduceError("发起生成失败，请重试"); return; }

      if (activeTemplate.deliveryMode === "talking-head-broll" && uploadVideoFile) {
        const fd = new FormData();
        fd.append("video", uploadVideoFile);
        await fetch(`/api/v1/cockpit/video-productions/${data.videoProductionId}/upload-source`, {
          method: "POST",
          body: fd,
        });
      }

      setHistory((prev) => [{
        id: data.videoProductionId, status: data.status, masterPath: null,
        mode: activeTemplate.deliveryMode, previewPath: null, contentId: data.contentId,
        createdAt: new Date().toISOString(),
      }, ...prev]);
      setProducedContentId(data.contentId);
    } catch {
      setProduceError("发起生成失败，请检查网络后重试");
    } finally {
      setProducing(false);
    }
  }

  // 打开向导时从后端拉取本模板的历史出片列表(task-10b 缺口3, 补齐 task-10-report.md
  // 记录的契约缺口)——不再只是会话内临时列表, 刷新页面/重新进入模板都能看到之前的记录。
  useEffect(() => {
    if (mode !== "produce" || !activeTemplate) return;
    let cancelled = false;
    fetch(`/api/v1/video-templates/${activeTemplate.id}/productions`)
      .then((res) => readData<{ productions: HistoryProduction[] }>(res))
      .then((data) => { if (!cancelled) setHistory(data?.productions ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, activeTemplate]);

  // 历史列表里未完成的记录仍需要轮询状态——上面的接口只在打开向导时拉一次快照。
  useEffect(() => {
    const pending = history.filter((h) => !["done", "failed"].includes(h.status));
    if (!pending.length) return;
    const timer = setInterval(async () => {
      const updated = await Promise.all(history.map(async (h) => {
        if (["done", "failed"].includes(h.status)) return h;
        const res = await fetch(`/api/v1/cockpit/video-productions/${h.id}`);
        const data = await readData<{ status: string; masterPath: string | null }>(res);
        return data ? { ...h, status: data.status, masterPath: data.masterPath } : h;
      }));
      setHistory(updated);
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.map((h) => h.status).join(",")]);

  if (mode === "edit") {
    return <EditorView
      form={form} setForm={setForm} editingId={editingId} saving={saving} saveError={saveError}
      assetUploading={assetUploading} assetError={assetError} onSave={handleSave} onUploadAsset={handleAssetUpload}
      onCancel={() => setMode("list")}
    />;
  }

  if (mode === "produce" && activeTemplate) {
    return <section className="page templates-page templates-wizard-page">
      <div className="page-heading">
        <span className="eyebrow">PRODUCE</span>
        <h1>用「{activeTemplate.name}」出片</h1>
        <button type="button" className="text-button" onClick={() => setMode("list")}>返回模板列表</button>
      </div>

      <ol className="template-wizard-steps">
        {steps.map((step, idx) => (
          <li key={step} className={idx === stepIndex ? "active" : idx < stepIndex ? "done" : ""}>
            <span>{idx + 1}</span>{STEP_LABELS[step]}
          </li>
        ))}
      </ol>

      {currentStep === "script" ? <section className="panel template-wizard-panel">
        <div className="template-script-tabs" role="tablist" aria-label="文案来源">
          <button type="button" role="tab" aria-selected={scriptSource === "existing"} className={scriptSource === "existing" ? "active" : ""} onClick={() => setScriptSource("existing")}>选已定稿</button>
          <button type="button" role="tab" aria-selected={scriptSource === "paste"} className={scriptSource === "paste" ? "active" : ""} onClick={() => { setScriptSource("paste"); setGeneratedScript(null); }}>粘贴新写</button>
          <button type="button" role="tab" aria-selected={scriptSource === "inspiration"} className={scriptSource === "inspiration" ? "active" : ""} onClick={() => { setScriptSource("inspiration"); setGeneratedScript(null); }}>从灵感出稿</button>
        </div>

        {scriptSource === "existing" ? <label className="field">
          <span>已定稿内容</span>
          <select value={selectedContentId} onChange={(e) => setSelectedContentId(e.target.value)}>
            <option value="">请选择</option>
            {existingContents.map((c) => <option key={c.id} value={c.id}>{c.title || "未命名内容"}</option>)}
          </select>
          {!existingContents.length ? <small className="field-hint">还没有已生成六幕脚本的内容卡</small> : null}
        </label> : null}

        {scriptSource === "paste" ? <label className="field full">
          <span>粘贴文案</span>
          <textarea className="large" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="粘贴一段原始文字，AI 会据此写出六幕稿" />
        </label> : null}

        {scriptSource === "inspiration" ? <label className="field">
          <span>选择灵感</span>
          <select value={selectedInspirationId} onChange={(e) => setSelectedInspirationId(e.target.value)}>
            <option value="">请选择</option>
            {inspirations.map((i) => <option key={i.id} value={i.id}>{i.text.slice(0, 30)}</option>)}
          </select>
        </label> : null}

        {scriptSource !== "existing" ? <div className="template-script-actions">
          <button type="button" className="primary-button" disabled={scriptGenerating || (scriptSource === "paste" ? !pasteText.trim() : !selectedInspirationId)} onClick={handleGenerateScript}>
            <Icon name="spark" />{scriptGenerating ? "生成中…" : generatedScript ? "重新生成" : "生成六幕稿"}
          </button>
          {scriptError ? <p className="validation-note">{scriptError}</p> : null}
        </div> : null}

        {generatedScript ? <div className="template-script-preview">
          {generatedScript.acts.map((act, idx) => <article key={act.act ?? idx} className="template-script-act">
            <h4>{act.title}</h4>
            <p>{act.narration}</p>
          </article>)}
        </div> : null}
      </section> : null}

      {currentStep === "upload" ? <section className="panel template-wizard-panel">
        <label className="field full">
          <span>出镜视频</span>
          <input type="file" accept="video/*" onChange={(e) => setUploadVideoFile(e.target.files?.[0] ?? null)} />
        </label>
        {uploadVideoFile ? <p className="field-hint">已选择：{uploadVideoFile.name}</p> : null}
      </section> : null}

      {currentStep === "voice" ? <section className="panel template-wizard-panel">
        <label className="field">
          <span>配音音色（可临时覆盖）</span>
          <input value={voiceTypeInput} onChange={(e) => setVoiceTypeInput(e.target.value)} placeholder="例如 zh_female_vv_uranus_bigtts" />
        </label>
        <small className="field-hint">默认带出模板保存的配音音色，可在此临时修改，仅本次生成生效，不会改动模板本身。</small>
      </section> : null}

      {currentStep === "produce" ? <section className="panel template-wizard-panel">
        {!producedContentId ? <>
          <p>确认无误后开始生成，生成完成前可在这里查看进度。</p>
          <button type="button" className="primary-button" disabled={producing || !canGoNext} onClick={handleProduce}>{producing ? "发起中…" : "开始生成"}</button>
          {produceError ? <p className="validation-note">{produceError}</p> : null}
        </> : <VideoProductionPanel contentId={producedContentId} deliveryMode={activeTemplate.deliveryMode} />}
      </section> : null}

      {currentStep !== "produce" ? <div className="template-wizard-nav">
        {stepIndex > 0 ? <button type="button" className="secondary-button" onClick={() => setStepIndex((i) => i - 1)}>上一步</button> : null}
        <button type="button" className="primary-button" disabled={!canGoNext} onClick={() => setStepIndex((i) => i + 1)}>下一步</button>
      </div> : null}

      {history.length ? <section className="panel template-history-panel">
        <div className="panel-heading"><div><span className="eyebrow">HISTORY</span><h2>本模板历史出片</h2></div></div>
        <ul className="template-history-list">
          {history.map((h) => <li key={h.id}>
            <span>{PRODUCTION_STATUS_LABELS[h.status] ?? h.status}</span>
            {h.masterPath ? <a href={`/api/v1/cockpit/video-productions/${h.id}/file?type=master`} target="_blank" rel="noreferrer">下载成片</a> : null}
          </li>)}
        </ul>
      </section> : null}
    </section>;
  }

  return <section className="page templates-page">
    <div className="page-heading">
      <span className="eyebrow">TEMPLATES</span>
      <h1>模板</h1>
      <p>把交付模式、视觉风格、字幕/BGM/片头片尾固定成一套模板，出片时只需定文案。</p>
      <button type="button" className="primary-button" onClick={() => openEditor(null)}><Icon name="plus" />新建模板</button>
    </div>

    {actionError ? <p className="validation-note">{actionError}</p> : null}

    {loading ? <p className="muted">加载中…</p>
      : listError ? <p className="validation-note">{listError}</p>
      : templates.length ? <div className="template-grid">
      {templates.map((t) => <article key={t.id} className="template-card">
        <div className="template-card-heading">
          <h3>{t.name}</h3>
          {t.isPreset ? <span className="badge">预设</span> : null}
        </div>
        <p className="template-card-mode">交付模式：{DELIVERY_MODE_LABELS[t.deliveryMode]}</p>
        {t.description ? <p className="template-card-desc">{t.description}</p> : null}
        <div className="template-card-actions">
          <button type="button" className="primary-button" onClick={() => openWizard(t)}>用它出片</button>
          <button type="button" className="secondary-button" onClick={() => openEditor(t)}>编辑</button>
          <button type="button" className="text-button" onClick={() => handleDuplicate(t.id)}>复制</button>
          <button type="button" className="text-button danger" onClick={() => handleDelete(t.id)}>删除</button>
        </div>
      </article>)}
    </div> : <p className="muted">还没有模板。</p>}
  </section>;
}

function EditorView({ form, setForm, editingId, saving, saveError, assetUploading, assetError, onSave, onUploadAsset, onCancel }: {
  form: VideoTemplateConfig;
  setForm: (updater: (prev: VideoTemplateConfig) => VideoTemplateConfig) => void;
  editingId: string | null;
  saving: boolean;
  saveError: string | null;
  assetUploading: "bgm" | "intro" | "outro" | null;
  assetError: string | null;
  onSave: () => void;
  onUploadAsset: (kind: "bgm" | "intro" | "outro", file: File) => void;
  onCancel: () => void;
}) {
  const captionEnabled = form.captionStyle !== null;

  function updateCaption(patch: Partial<CaptionStyle>) {
    setForm((prev) => ({ ...prev, captionStyle: prev.captionStyle ? { ...prev.captionStyle, ...patch } : { ...defaultCaptionStyle(), ...patch } }));
  }

  return <section className="page templates-page templates-editor-page">
    <div className="page-heading">
      <span className="eyebrow">TEMPLATE</span>
      <h1>{editingId ? "编辑模板" : "新建模板"}</h1>
      <button type="button" className="text-button" onClick={onCancel}>返回模板列表</button>
    </div>

    <section className="panel template-editor-panel">
      <div className="form-grid">
        <label className="field">
          <span>模板名称</span>
          <input aria-label="模板名称" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} maxLength={40} />
        </label>
        <label className="field">
          <span>交付模式</span>
          <select value={form.deliveryMode} onChange={(e) => setForm((prev) => ({ ...prev, deliveryMode: e.target.value as TemplateDeliveryMode }))}>
            <option value="ppt-narration">图文口播</option>
            <option value="talking-head-broll">真人出镜 + B-roll</option>
            <option value="illustration-tts">插画配音</option>
          </select>
        </label>
        <label className="field">
          <span>视觉风格</span>
          <select value={form.visualStyle} onChange={(e) => setForm((prev) => ({ ...prev, visualStyle: e.target.value as VideoTemplateConfig["visualStyle"] }))}>
            <option value="card">卡片</option>
            <option value="illustration">插画</option>
          </select>
        </label>
        <label className="field">
          <span>目标时长</span>
          <select value={form.scriptPrompt?.targetDurationSec ?? 90} onChange={(e) => setForm((prev) => ({ ...prev, scriptPrompt: { ...prev.scriptPrompt, targetDurationSec: Number(e.target.value) as 30 | 45 | 60 | 90 } }))}>
            {[30, 45, 60, 90].map((v) => <option key={v} value={v}>{v} 秒</option>)}
          </select>
        </label>
      </div>

      <label className="field full">
        <span>简介</span>
        <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} maxLength={200} />
      </label>

      <label className="field full">
        <span>写稿口吻提示（可选）</span>
        <textarea value={form.scriptPrompt?.hookHint ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, scriptPrompt: { ...prev.scriptPrompt, hookHint: e.target.value } }))} placeholder="例如：开头用一个反常识的观察" />
      </label>

      {form.deliveryMode === "illustration-tts" ? <div className="form-grid">
        <label className="field">
          <span>配音音色</span>
          <input value={form.voicePreset?.voiceType ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, voicePreset: { ...prev.voicePreset, voiceType: e.target.value } }))} placeholder="例如 zh_female_vv_uranus_bigtts" />
        </label>
      </div> : null}

      <div className="template-caption-toggle">
        <label><input type="checkbox" checked={captionEnabled} onChange={(e) => setForm((prev) => ({ ...prev, captionStyle: e.target.checked ? defaultCaptionStyle() : null }))} />烧录字幕</label>
      </div>

      {captionEnabled && form.captionStyle ? <div className="form-grid">
        <label className="field">
          <span>字幕字体</span>
          <select value={form.captionStyle.fontFamily} onChange={(e) => updateCaption({ fontFamily: e.target.value })}>
            {CAPTION_FONT_WHITELIST.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
        </label>
        <label className="field">
          <span>字号</span>
          <input type="number" min={12} max={200} value={form.captionStyle.fontSize} onChange={(e) => updateCaption({ fontSize: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>字幕主色</span>
          <input value={form.captionStyle.primaryColor} onChange={(e) => updateCaption({ primaryColor: e.target.value })} />
        </label>
        <label className="field">
          <span>描边颜色</span>
          <input value={form.captionStyle.outlineColor} onChange={(e) => updateCaption({ outlineColor: e.target.value })} />
        </label>
      </div> : null}

      <label className="field">
        <span>BGM 音量</span>
        <input type="range" min={0} max={1} step={0.01} value={form.bgmVolume} onChange={(e) => setForm((prev) => ({ ...prev, bgmVolume: Number(e.target.value) }))} />
        <small>{Math.round(form.bgmVolume * 100)}%</small>
      </label>

      <div className="template-assets-grid">
        <label className="field">
          <span>BGM</span>
          <input type="file" accept="audio/*" disabled={!editingId || assetUploading === "bgm"} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadAsset("bgm", f); }} />
          {form.bgmPath ? <small className="field-hint">已上传</small> : null}
        </label>
        <label className="field">
          <span>片头</span>
          <input type="file" accept="video/*" disabled={!editingId || assetUploading === "intro"} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadAsset("intro", f); }} />
          {form.introPath ? <small className="field-hint">已上传</small> : null}
        </label>
        <label className="field">
          <span>片尾</span>
          <input type="file" accept="video/*" disabled={!editingId || assetUploading === "outro"} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadAsset("outro", f); }} />
          {form.outroPath ? <small className="field-hint">已上传</small> : null}
        </label>
        {!editingId ? <small className="field-hint">保存模板后才能上传素材</small> : null}
        {assetError ? <p className="validation-note">{assetError}</p> : null}
      </div>

      {saveError ? <p className="validation-note">{saveError}</p> : null}
      <button type="button" className="primary-button" disabled={saving || !form.name.trim()} onClick={onSave}>{saving ? "保存中…" : "保存模板"}</button>
    </section>
  </section>;
}
