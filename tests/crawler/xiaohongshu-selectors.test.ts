import { describe, expect, it } from 'vitest';
import { XHS } from '@/crawler/xiaohongshu/selectors';

describe('XHS selectors', () => {
  it('LOGGED_IN_PROFILE_HREF_REGEX matches profile path', () => {
    expect(XHS.LOGGED_IN_PROFILE_HREF_REGEX.test('/user/profile/5d3a4b1c000000000000abcd')).toBe(true);
    expect(XHS.LOGGED_IN_PROFILE_HREF_REGEX.test('/login')).toBe(false);
  });

  it('PROFILE_URL builds correct uid link', () => {
    expect(XHS.PROFILE_URL('abc123')).toBe('https://www.xiaohongshu.com/user/profile/abc123');
  });
});
