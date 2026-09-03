import { describe, expect, it } from 'vitest';
import { integerToHanzi, numberToHanzi } from '@/lib/tts/number-to-hanzi';

describe('integerToHanzi', () => {
  it('转换普通整数', () => {
    expect(integerToHanzi('3000')).toBe('三千');
    expect(integerToHanzi('300')).toBe('三百');
    expect(integerToHanzi('500')).toBe('五百');
    expect(integerToHanzi('1850')).toBe('一千八百五十');
  });

  it('10~19 不读前面的"一"', () => {
    expect(integerToHanzi('14')).toBe('十四');
    expect(integerToHanzi('16')).toBe('十六');
  });

  it('中间/尾部零按习惯补占位, 不重复、不漏读', () => {
    expect(integerToHanzi('1005')).toBe('一千零五');
    expect(integerToHanzi('1500')).toBe('一千五百');
    expect(integerToHanzi('10500')).toBe('一万零五百');
  });

  it('零与空串', () => {
    expect(integerToHanzi('0')).toBe('零');
    expect(integerToHanzi('00')).toBe('零');
  });

  it('万/亿量级', () => {
    expect(integerToHanzi('10000')).toBe('一万');
    expect(integerToHanzi('74亿'.match(/\d+/)![0])).toBe('七十四');
    expect(integerToHanzi('740000000')).toBe('七亿四千万');
  });
});

describe('numberToHanzi', () => {
  it('整数: 拼接 segments.original 还原原文, hanzi 是进位读法', () => {
    const r = numberToHanzi('调用成本3000元');
    expect(r.segments.map((s) => s.original).join('')).toBe('调用成本3000元');
    expect(r.hanzi).toBe('调用成本三千元');
  });

  it('小数: 整数部分进位读, 小数部分逐位读', () => {
    const r = numberToHanzi('涨幅32.2%');
    // 32.2% 命中百分比分支, 这条单测只看纯小数(不带%)的读法本身
    const plain = numberToHanzi('准确率是32.2这个数');
    expect(plain.hanzi).toBe('准确率是三十二点二这个数');
  });

  it('百分比: 读作"百分之X"', () => {
    const r = numberToHanzi('涨幅32.2%');
    expect(r.hanzi).toBe('涨幅百分之三十二点二');
    expect(r.segments.map((s) => s.original).join('')).toBe('涨幅32.2%');
  });

  it('区间"300-500": 读作"X到Y"', () => {
    const r = numberToHanzi('单价300-500元');
    expect(r.hanzi).toBe('单价三百到五百元');
  });

  it('年份: 紧跟"年"字的4位数逐位念, 不是进位读法', () => {
    const r = numberToHanzi('1850年发生的事');
    expect(r.hanzi).toBe('一八五零年发生的事');
    expect(r.segments.map((s) => s.original).join('')).toBe('1850年发生的事');
  });

  it('4位数字不紧跟"年"字时按普通整数进位读', () => {
    const r = numberToHanzi('调用成本1850元');
    expect(r.hanzi).toBe('调用成本一千八百五十元');
  });

  it('一句话里混合多种数字模式, segments 逐段可还原', () => {
    const text = '2026年调用成本从3000元涨到1万，涨幅3到4倍，占比32.2%';
    const r = numberToHanzi(text);
    expect(r.segments.map((s) => s.original).join('')).toBe(text);
    expect(r.hanzi).toBe(
      '二零二六年调用成本从三千元涨到一万，涨幅三到四倍，占比百分之三十二点二',
    );
  });

  it('没有数字的纯文本原样透传', () => {
    const r = numberToHanzi('别只盯着涨价这个数字。');
    expect(r.hanzi).toBe('别只盯着涨价这个数字。');
    expect(r.segments).toEqual([{ original: '别只盯着涨价这个数字。', hanzi: '别只盯着涨价这个数字。' }]);
  });
});
