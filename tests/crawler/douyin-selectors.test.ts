import { describe, expect, it } from 'vitest';
import { DOUYIN } from '@/crawler/douyin/selectors';

describe('Douyin selectors', () => {
  it('LOGGED_IN_PROFILE_HREF_REGEX matches sec_uid path', () => {
    // sec_uid 是 base64-url-safe 字符串
    expect(DOUYIN.LOGGED_IN_PROFILE_HREF_REGEX.test('/user/MS4wLjABAAAAxxxxxxxx_-')).toBe(true);
    expect(DOUYIN.LOGGED_IN_PROFILE_HREF_REGEX.test('/login')).toBe(false);
    expect(DOUYIN.LOGGED_IN_PROFILE_HREF_REGEX.test('/discover')).toBe(false);
  });

  it('PROFILE_URL builds correct sec_uid link', () => {
    expect(DOUYIN.PROFILE_URL('MS4wLjABAAAA_test-id')).toBe(
      'https://www.douyin.com/user/MS4wLjABAAAA_test-id'
    );
  });

  it('LOGIN_URL points to homepage (modal triggered there)', () => {
    expect(DOUYIN.LOGIN_URL).toMatch(/^https:\/\/www\.douyin\.com/);
  });
});
