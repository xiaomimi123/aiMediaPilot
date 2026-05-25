import { prisma } from './prisma';

const DEFAULT_USER_ID = 'default-user';

// 单用户 MVP: 始终使用同一条 User 记录,首次访问时自动创建
export async function getOrCreateDefaultUser() {
  return prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: { id: DEFAULT_USER_ID, name: 'MediaPilot User' },
  });
}
