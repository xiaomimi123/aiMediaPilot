import { describe, it, expect } from 'vitest';
import { pickDouyinViewMode } from '@/lib/cockpit/douyin-view-mode';

const validAct = (overrides: Record<string, unknown> = {}) => ({
  act: 'hook',
  title: '开场',
  narration: '这是一段足够长的旁白文本用于校验',
  visual: '特写镜头',
  note: '备注',
  targetSec: 5,
  beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }],
  facts: [],
  ...overrides,
});

const ACT_KEYS = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'];

function validSixActPayload() {
  return {
    script: {
      acts: ACT_KEYS.map((act) => validAct({ act })),
    },
    four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
    hooks: [],
    titles: [],
    cover: { textOverlay: '', shotIdea: '', colorTone: '' },
  };
}

describe('pickDouyinViewMode', () => {
  it('returns "legacy" when retentionBeats array is present', () => {
    const data = {
      hooks: [],
      retentionBeats: [{ startSec: 0, endSec: 3, beat: '开场' }],
      titles: [],
      cover: { textOverlay: '', shotIdea: '', colorTone: '' },
    };
    expect(pickDouyinViewMode(data)).toBe('legacy');
  });

  it('returns "sections" for the old two-stage script.sections shape', () => {
    const data = {
      hooks: [],
      script: {
        sections: [{ role: 'hook', startSec: 0, endSec: 3, text: '开场白' }],
      },
      titles: [],
      cover: { textOverlay: '', shotIdea: '', colorTone: '' },
    };
    expect(pickDouyinViewMode(data)).toBe('sections');
  });

  it('returns "six-act" when script.acts + four_dims validate as a six-act script', () => {
    expect(pickDouyinViewMode(validSixActPayload())).toBe('six-act');
  });

  it('returns "empty" when neither retentionBeats, sections, nor a valid six-act shape is present', () => {
    expect(pickDouyinViewMode({ hooks: [], titles: [], cover: {} })).toBe('empty');
  });

  it('returns "empty" for null/undefined input', () => {
    expect(pickDouyinViewMode(null)).toBe('empty');
    expect(pickDouyinViewMode(undefined)).toBe('empty');
  });

  it('prefers "legacy" over a would-be six-act shape when retentionBeats is present', () => {
    const data = {
      ...validSixActPayload(),
      retentionBeats: [{ startSec: 0, endSec: 3, beat: '开场' }],
    };
    expect(pickDouyinViewMode(data)).toBe('legacy');
  });

  it('returns "empty" when script.acts is malformed (fails six-act schema) and no sections/retentionBeats exist', () => {
    const data = {
      script: { acts: [validAct()] }, // only 1 act, not 6
      four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
    };
    expect(pickDouyinViewMode(data)).toBe('empty');
  });
});
