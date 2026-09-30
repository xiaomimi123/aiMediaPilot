// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScriptPane } from '@/components/project/script-pane';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段` })) };

describe('ScriptPane quoted segment', () => {
  it('marks the quoted segment as evidence, not as just edited, and scrolls to it', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false, message: 'x' }) })));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll as unknown as Element['scrollIntoView'];
    render(<ScriptPane project={toProjectView({ id: 'p1', title: 't', stage: 'scripted', targetSec: 60, script, updatedAt: new Date() })} highlighted={new Set()} quoted="s2" onEdit={async () => {}} onFinalize={async () => {}} />);
    expect(screen.getByText('依据')).toBeTruthy();
    expect(screen.queryByText('刚改')).toBeNull();
    expect(scroll).toHaveBeenCalled();
  });
});
