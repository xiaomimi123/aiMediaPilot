// 抖音 web 选择器 v1 — 真实平台改版会失效,首次真账号验收时按 DOM dump 调整。
// 抖音个人主页 URL: /user/<sec_uid>,sec_uid 是 base64-url-safe 字符串 (含 _ -)。
export const DOUYIN = {
  LOGIN_URL: 'https://www.douyin.com/?recommend=1',
  HOME_URL: 'https://www.douyin.com',
  PROFILE_URL: (uid: string) => `https://www.douyin.com/user/${uid}`,

  // 登录 modal v1 (实测时按 dump 调) — 抖音登录是弹层,登录按钮触发
  LOGIN_CONTAINER: '#login-pannel, [data-e2e="login-container"], .web-login',
  QR_IMG: '#login-pannel img[src^="data:image"], .web-login-scan-code img',

  // 已登录后顶栏头像跳主页用,带 sec_uid
  LOGGED_IN_USER_LINK: 'a[href^="/user/"]',
  LOGGED_IN_PROFILE_HREF_REGEX: /\/user\/([A-Za-z0-9_-]+)/,

  // 个人主页字段
  PROFILE_NICKNAME: '[data-e2e="user-info"] h1, .nickname',
  PROFILE_AVATAR: '[data-e2e="user-avatar"] img, .avatar-component img',
  PROFILE_BIO: '[data-e2e="user-info"] [data-e2e="user-detail-info"], .signature',
  PROFILE_FOLLOWING_COUNT: '[data-e2e="user-info-follow"] .number',
  PROFILE_FOLLOWER_COUNT: '[data-e2e="user-info-fans"] .number',
  PROFILE_LIKE_COUNT: '[data-e2e="user-info-liked"] .number',

  // 视频列表 (作品 tab)
  VIDEO_CARD: '[data-e2e="user-post-list"] li',
  VIDEO_LINK: 'a[href*="/video/"]',
  VIDEO_TITLE: '.title, [data-e2e="user-post-item-title"]',
  VIDEO_LIKE_COUNT: '[data-e2e="user-post-item-like"], .like-count',
  VIDEO_COVER: 'img',
};
