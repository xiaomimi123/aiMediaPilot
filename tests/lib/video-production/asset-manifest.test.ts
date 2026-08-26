import { describe, expect, it } from 'vitest';
import { buildAssetSection, type ContentAsset } from '@/lib/video-production/asset-manifest';

const IMG: ContentAsset = {
  id: 'a1', kind: 'image', description: 'DeepSeek 官方定价页, 显示 V4 高峰时段单价',
  fileName: 'pricing.png', text: null,
};
const TABLE: ContentAsset = {
  id: 'a2', kind: 'table', description: '各模型价格对比',
  fileName: null, text: '模型\t输入价\t输出价\nDeepSeek V4\t2元\t8元',
};
const TEXT: ContentAsset = {
  id: 'a3', kind: 'text', description: '课程完整目录',
  fileName: null, text: '第一章 环境搭建\n第二章 RAG 检索\n第三章 工具调用',
};

describe('buildAssetSection', () => {
  it('没有素材时返回空串 —— 老任务 prompt 字符级不变', () => {
    expect(buildAssetSection([])).toBe('');
  });

  it('图片素材给出可直接用的相对路径, 不是绝对路径', () => {
    // 渲染时素材会被拷进镜头 workDir, HTML 里必须用相对路径引用
    const s = buildAssetSection([IMG]);
    expect(s).toContain('pricing.png');
    expect(s).not.toContain('/Users/');
    expect(s).toMatch(/<img|img 标签|src=/);
  });

  it('每条素材都带上你写的描述 —— Builder 靠它判断该在哪一镜用', () => {
    expect(buildAssetSection([IMG])).toContain('DeepSeek 官方定价页');
  });

  it('表格素材把原始内容给出来, 让 Builder 渲染成真表格', () => {
    const s = buildAssetSection([TABLE]);
    expect(s).toContain('DeepSeek V4');
    expect(s).toContain('各模型价格对比');
  });

  it('长文素材同样给出原文', () => {
    expect(buildAssetSection([TEXT])).toContain('第二章 RAG 检索');
  });

  it('明确要求优先用真实素材, 而不是另画抽象图形', () => {
    expect(buildAssetSection([IMG])).toMatch(/优先|真实素材/);
  });

  it('明确说明素材只在内容对得上的镜头用, 不要硬塞', () => {
    // 否则模型会把同一张图塞进每一镜 —— 今晚已经见过它对模糊指令的处理方式
    expect(buildAssetSection([IMG])).toMatch(/对得上|相关|不要.*硬塞|无关/);
  });

  it('多条素材逐条列出, 不合并成一段', () => {
    const s = buildAssetSection([IMG, TABLE, TEXT]);
    expect(s).toContain('pricing.png');
    expect(s).toContain('各模型价格对比');
    expect(s).toContain('课程完整目录');
  });

  it('过长的文字素材被截断, 避免撑爆 prompt', () => {
    const huge: ContentAsset = { ...TEXT, text: 'x'.repeat(5000) };
    const s = buildAssetSection([huge]);
    expect(s.length).toBeLessThan(3000);
    expect(s).toMatch(/截断|省略|\.\.\./);
  });
});
