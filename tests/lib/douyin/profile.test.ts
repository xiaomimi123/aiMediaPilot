import { describe, expect, it } from 'vitest';
import { parseSelfProfile, PROFILE_METRICS } from '@/lib/douyin/profile';

describe('parseSelfProfile', () => {
  it('reads followers, likes and work count from profile/self', () => {
    const json = { status_code: 0, user: { sec_uid: 'MS4wX', nickname: '爱做梦的小米哥', follower_count: 408, total_favorited: 2453, aweme_count: 85 } };
    expect(parseSelfProfile(json)).toEqual({ followers: 408, totalLikes: 2453, awemeCount: 85 });
  });
  it('rejects a response without a user (login lost)', () => {
    expect(() => parseSelfProfile({ status_code: 8 })).toThrow();
  });
  it('uses distinct metric keys from the creator-center ones', () => {
    expect(Object.values(PROFILE_METRICS)).toEqual(['profile_followers', 'profile_total_favorited', 'profile_aweme_count']);
  });
});
