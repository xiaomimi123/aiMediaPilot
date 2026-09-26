import { describe, expect, it } from 'vitest';
import { applySegmentEdit } from '@/lib/script/edit';
import { SEGMENT_ROLES, type Script } from '@/lib/script/model';

const script: Script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `原文${i + 1}` })) };

describe('applySegmentEdit', () => {
  it('only touches the target segment', () => {
    const next = applySegmentEdit(script, 's4', '新文');
    expect(next.segments[3].text).toBe('新文');
    expect(next.segments.filter((_, i) => i !== 3).map((s) => s.text)).toEqual(['原文1', '原文2', '原文3', '原文5', '原文6']);
    expect(script.segments[3].text).toBe('原文4'); // 不改原对象
  });
  it('throws a readable error listing valid ids', () => {
    expect(() => applySegmentEdit(script, 's9', 'x')).toThrow('没有编号为 s9 的段落，可用编号：s1、s2、s3、s4、s5、s6');
  });
});
