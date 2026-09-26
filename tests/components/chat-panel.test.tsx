// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatPanel } from '@/components/project/chat-panel';

afterEach(cleanup);

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
