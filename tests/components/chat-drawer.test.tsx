// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatDrawer } from '@/components/project/chat-drawer';

afterEach(cleanup);

describe('ChatDrawer', () => {
  it('shows a button when closed and keeps the chat mounted', () => {
    const onOpenChange = vi.fn();
    render(
      <ChatDrawer open={false} onOpenChange={onOpenChange} unread>
        <div>对话内容</div>
      </ChatDrawer>,
    );
    expect(screen.getByText('对话内容')).toBeTruthy();
    expect(screen.getByLabelText('有新消息')).toBeTruthy();
    fireEvent.click(screen.getByText('和编导聊'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
  it('closes from the panel header', () => {
    const onOpenChange = vi.fn();
    render(
      <ChatDrawer open onOpenChange={onOpenChange} unread={false}>
        <div>对话内容</div>
      </ChatDrawer>,
    );
    fireEvent.click(screen.getByLabelText('收起对话'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it('makes the closed panel inert so it cannot take focus', () => {
    const { container } = render(
      <ChatDrawer open={false} onOpenChange={() => {}} unread={false}>
        <textarea />
      </ChatDrawer>,
    );
    expect(container.querySelector('aside')!.hasAttribute('inert')).toBe(true);
  });
});
