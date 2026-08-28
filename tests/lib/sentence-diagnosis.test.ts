import { describe, it, expect } from 'vitest';
import { diagnoseSentences, splitSentences } from '@/lib/script/sentence-diagnosis';

describe('splitSentences', () => {
  it('按句末标点切，保留原文位置', () => {
    const s = splitSentences('我卡了两天。后来做了个U盘！好用吗？');
    expect(s.map((x) => x.text)).toEqual(['我卡了两天。', '后来做了个U盘！', '好用吗？']);
    expect(s[1].start).toBe(6);
  });

  it('没有句末标点的整段算一句', () => {
    expect(splitSentences('就这么一句没标点')).toHaveLength(1);
  });

  it('空白不产出空句', () => {
    expect(splitSentences('  \n  ')).toEqual([]);
  });
});

describe('diagnoseSentences', () => {
  it('垫话定位到具体句子', () => {
    const d = diagnoseSentences('我做了个U盘。说实话这东西挺好用的。');
    const filler = d.find((x) => x.issues.some((i) => i.kind === 'filler'));
    expect(filler?.text).toContain('说实话');
    expect(filler?.issues[0].detail).toContain('说实话');
  });

  it('干净的句子没有问题', () => {
    const d = diagnoseSentences('我卡了两天。后来做了个U盘。');
    expect(d.every((x) => x.issues.length === 0)).toBe(true);
  });

  it('气口过长的句子被点出来', () => {
    const long = '这个项目从一开始的环境配置到后面的依赖安装再到路径调整每一个环节都需要非常仔细地反复确认才能勉强跑通';
    const d = diagnoseSentences(long + '。');
    expect(d[0].issues.some((i) => i.kind === 'breath')).toBe(true);
  });

  it('套话句式被点出来', () => {
    const d = diagnoseSentences('在这个飞速发展的时代，AI 越来越重要。');
    expect(d[0].issues.some((i) => i.kind === 'cliche')).toBe(true);
  });

  it('和前面重复的句子被点出来', () => {
    const d = diagnoseSentences('我做了一个预装好环境的U盘。我做了一个预装好环境的U盘。');
    expect(d[1].issues.some((i) => i.kind === 'repeat')).toBe(true);
    expect(d[0].issues.some((i) => i.kind === 'repeat')).toBe(false);
  });

  it('只给问题位置，不给替换文字', () => {
    const d = diagnoseSentences('说实话这个东西真的很好。');
    for (const s of d) {
      for (const i of s.issues) {
        expect(i).not.toHaveProperty('suggestion');
        expect(i).not.toHaveProperty('replacement');
      }
    }
  });
});
