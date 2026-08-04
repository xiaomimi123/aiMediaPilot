"use client";

import { useState } from "react";
import {
  DEFAULT_PAGE_TITLES,
  type ContentItem,
  type InspirationCard,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { EditablePageTitle, Empty } from "../shared";

export function InspirationPoolView({ state, pageTitle, updateTitle, add, update, createContent, remove, openContent }: {
  state: WorkspaceState;
  pageTitle: string;
  updateTitle: (value: string) => void;
  add: (text: string) => void;
  update: (id: string, text: string) => void;
  createContent: (inspiration: InspirationCard) => void;
  remove: (inspiration: InspirationCard) => void;
  openContent: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const cards = [...state.inspirationCards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  const save = () => {
    if (!draft.trim()) return;
    add(draft);
    setDraft("");
  };
  return <section className="page inspiration-page">
    <div className="page-heading"><span className="eyebrow">INSPIRATION POOL</span><EditablePageTitle value={pageTitle} fallback={DEFAULT_PAGE_TITLES.inspirations} onChange={updateTitle} /><p>灵感只是等待判断的想法，不计入内容、目标或复盘；决定要做时，再把它转成一条内容。</p></div>
    <div className="inspiration-workspace">
      <section className="panel inspiration-composer">
        <div className="inspiration-composer-heading"><span className="eyebrow">QUICK CAPTURE</span><h2>想到什么，先放进来</h2><p>不需要分类，也不用现在决定怎么拍。这里可以写下一段完整的场景、观点或内容雏形。</p></div>
        <label>
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") save();
            }}
            placeholder={"写下一段灵感……\n\n可以是一个具体场景、一句反常识观点，或者一条还没有想完整的内容方向。"}
          />
        </label>
        <footer><span>⌘ / Ctrl + Enter 保存</span><button className="primary-button" disabled={!draft.trim()} onClick={save}>存入灵感池</button></footer>
      </section>
      <section className="panel inspiration-wall">
        <header className="inspiration-wall-heading"><div><span className="eyebrow">IDEA WALL</span><h2>灵感墙</h2><p>最新记录在最前面，决定投入后再转为正式内容。</p></div><span className="inspiration-count">{cards.length}<small> 张卡片</small></span></header>
        {cards.length ? <div className="inspiration-grid">{cards.map((card, index) => {
          const converted = card.convertedContentIds
            .map((contentId) => state.contents.find((item) => item.id === contentId))
            .filter((item): item is ContentItem => Boolean(item));
          return <article className="inspiration-card" key={card.id}>
            <button type="button" className="inspiration-card-open" onClick={() => setSelectedCardId(card.id)} aria-label={`查看并编辑灵感：${card.text.slice(0, 30)}`}>
              <header><span>IDEA {String(cards.length - index).padStart(2, "0")}</span><time>{card.createdAt.slice(0, 10)}</time></header>
              <p>{card.text}</p>
            </button>
            <div className="inspiration-card-status">
              {converted.length ? <div className="inspiration-converted"><span>已转为 {converted.length} 条内容</span>{converted.slice(0, 2).map((item) => <button key={item.id} onClick={() => openContent(item.id)}>{item.title}</button>)}</div> : <span className="inspiration-unselected">尚未转为内容</span>}
            </div>
            <footer><button className="text-button inspiration-delete" onClick={() => remove(card)}>删除</button><button className="secondary-button" onClick={() => createContent(card)}>{converted.length ? "再次创建内容" : "转为内容"}</button></footer>
          </article>;
        })}</div> : <Empty title="灵感墙还是空的" body="先在左边写下一段想法。它不会立刻变成内容，也不会影响你的内容统计。" />}
      </section>
    </div>
    {selectedCard ? <InspirationDetailModal card={selectedCard} close={() => setSelectedCardId(null)} save={(text) => { update(selectedCard.id, text); setSelectedCardId(null); }} /> : null}
  </section>;
}

function InspirationDetailModal({ card, close, save }: { card: InspirationCard; close: () => void; save: (text: string) => void }) {
  const [text, setText] = useState(card.text);
  const changed = text.trim() !== card.text.trim();
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="inspiration-detail-modal" role="dialog" aria-modal="true" aria-labelledby="inspiration-detail-title">
      <header><div><span className="eyebrow">IDEA DETAIL</span><h2 id="inspiration-detail-title">灵感详情</h2><p>创建于 {card.createdAt.slice(0, 10)}{card.updatedAt !== card.createdAt ? ` · 最近修改 ${card.updatedAt.slice(0, 10)}` : ""}</p></div><button className="close-button" onClick={close} aria-label="关闭灵感详情">×</button></header>
      <div className="inspiration-detail-body">
        <label className="field"><span>灵感文字</span><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && text.trim() && changed) save(text); }} /></label>
        <div><span>{text.trim().length} 字</span><span>⌘ / Ctrl + Enter 保存</span></div>
      </div>
      <footer><button className="text-button" onClick={close}>取消</button><button className="primary-button" disabled={!text.trim() || !changed} onClick={() => save(text)}>保存修改</button></footer>
    </section>
  </div>;
}
