import type { Platform } from '@prisma/client';

export const PLATFORM_META: Record<
  Platform,
  {
    label: string;
    loginUrl: string;
    homeUrl: string;
  }
> = {
  XIAOHONGSHU: {
    label: '小红书',
    loginUrl: 'https://www.xiaohongshu.com/login',
    homeUrl: 'https://www.xiaohongshu.com',
  },
  DOUYIN: {
    label: '抖音',
    loginUrl: 'https://www.douyin.com',
    homeUrl: 'https://www.douyin.com',
  },
  WECHAT_MP: { label: '微信公众号', loginUrl: '', homeUrl: '' },
  BILIBILI: { label: 'B 站', loginUrl: '', homeUrl: '' },
  KUAISHOU: { label: '快手', loginUrl: '', homeUrl: '' },
  WEIBO: { label: '微博', loginUrl: '', homeUrl: '' },
};
