// 小红书 web 选择器 v1 — 平台改版时会失效,Task 18 真账号验收时调整
export const XHS = {
  LOGIN_URL: 'https://www.xiaohongshu.com/login',
  HOME_URL: 'https://www.xiaohongshu.com',
  PROFILE_URL: (uid: string) => `https://www.xiaohongshu.com/user/profile/${uid}`,

  // 登录页二维码 img (探查确认)
  QR_IMG: 'img.qrcode-img',
  LOGIN_CONTAINER: '.login-container',

  // 登录后 profile 抓取 selectors v1 (后续调优)
  LOGGED_IN_USER_LINK: 'a.user.side-bar-component',
  LOGGED_IN_PROFILE_HREF_REGEX: /\/user\/profile\/([a-f0-9]+)/,

  PROFILE_NICKNAME: '.user-nickname',
  PROFILE_AVATAR: 'img.user-image',
  PROFILE_BIO: '.user-desc',
  PROFILE_FOLLOWER_COUNT: '[data-type="fans"] .count',
  PROFILE_FOLLOWING_COUNT: '[data-type="follows"] .count',
  PROFILE_NOTE_COUNT: '[data-type="notes"] .count',
  PROFILE_LIKE_COUNT: '[data-type="interaction"] .count',

  NOTE_CARD: 'section.note-item',
  NOTE_LINK: 'a.cover',
  NOTE_TITLE: '.title',
  NOTE_LIKE_COUNT: '.like-count',
  NOTE_COVER: '.cover img',
};
