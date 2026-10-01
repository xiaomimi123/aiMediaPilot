// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { LessonsCard } from '@/components/settings/lessons-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LessonsCard', () => {
  it('explains the library when empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: [] }) })));
    render(<LessonsCard />);
    await waitFor(() => expect(screen.getByText(/还没有写法经验/)).toBeTruthy());
    expect(screen.getByText('写法库')).toBeTruthy();
  });
});
