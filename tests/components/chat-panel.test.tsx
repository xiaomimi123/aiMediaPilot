// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatPanel, linkify } from '@/components/project/chat-panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
// jsdom 没有 scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
});

const noop = () => {};

describe('ChatPanel', () => {
  it('survives unmount when scrollIntoView returns a Promise (newer Chrome)', () => {
    // 新版 Chrome 的 scrollIntoView 返回 Promise; effect 若把它当返回值, React 卸载时会调用它 → "destroy is not a function"
    Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as Element['scrollIntoView'];
    const { unmount } = render(
      <ChatPanel projectId="p1" initialMessages={[{ id: 'm1', role: 'user', content: '你好', toolName: null, ok: null }]} onTurnStart={vi.fn()} onTurnEvent={vi.fn()} onTurnEnd={vi.fn()} />,
    );
    expect(() => unmount()).not.toThrow();
  });
});

describe('linkify', () => {
  it('turns project and topics paths into links', () => {
    expect(linkify('去 /projects/cmu123abc 看，或者 /topics')).toEqual(['去 ', { href: '/projects/cmu123abc', label: '/projects/cmu123abc' }, ' 看，或者 ', { href: '/topics', label: '/topics' }]);
  });
});

describe('ChatPanel options', () => {
  it('posts to a custom endpoint from a quick prompt', async () => {
    const f = vi.fn(async () => ({ ok: false, body: null, status: 500, json: async () => ({ message: 'x' }) }));
    vi.stubGlobal('fetch', f);
    render(<ChatPanel projectId="" endpoint="/api/assistant/threads/t1/chat" title="总助手" quickPrompts={['今天做什么']} initialMessages={[]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    expect(screen.getByText('总助手')).toBeTruthy();
    fireEvent.click(screen.getByText('今天做什么'));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/assistant/threads/t1/chat');
  });
  it('expands a tool line to show its detail', () => {
    render(<ChatPanel projectId="p1" initialMessages={[{ id: 'm', role: 'tool', content: '概况：粉丝 408', toolName: 'status', ok: true, detail: '粉丝 408\n今天对标爆款 1 条' }]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    fireEvent.click(screen.getByText(/概况：粉丝 408/));
    expect(screen.getByText(/今天对标爆款 1 条/)).toBeTruthy();
  });
  it('keeps the editor defaults', () => {
    render(<ChatPanel projectId="p1" initialMessages={[]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    expect(screen.getByText('编导对话')).toBeTruthy();
  });
});

describe('ChatPanel settings link', () => {
  it('offers a settings link on errors that mention the settings page', () => {
    render(<ChatPanel projectId="p1" initialMessages={[{ id: 'e', role: 'system', content: '还没有可用的模型：去设置页添加一个。', toolName: null, ok: null }]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    expect(screen.getByRole('link', { name: '打开设置页' }).getAttribute('href')).toBe('/settings');
  });
});

describe('ChatPanel note proposals', () => {
  it('renders a note proposal line as a card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/x.md', content: 'x', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z' } }) })));
    render(<ChatPanel projectId="p1" initialMessages={[{ id: 'm', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', ok: true, proposalId: 'np1' }]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    await waitFor(() => expect(screen.getByText('存进 Obsidian')).toBeTruthy());
  });
});

describe('ChatPanel pendingSend', () => {
  it('sends a message handed in from outside', async () => {
    const f = vi.fn(async () => ({ ok: false, body: null, status: 500, json: async () => ({ message: 'x' }) }));
    vi.stubGlobal('fetch', f);
    render(<ChatPanel projectId="p1" initialMessages={[]} pendingSend={{ id: 'a1', text: '按预测的建议改' }} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ text: '按预测的建议改' });
  });
});
