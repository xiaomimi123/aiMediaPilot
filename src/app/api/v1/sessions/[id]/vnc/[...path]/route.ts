import { fail } from '@/lib/api';

/**
 * VNC reverse proxy 预留入口。
 * Plan 1 不实现 — 前端 iframe 直连 process.env.CHROMIUM_VNC_URL (默认 http://localhost:6080)。
 * Plan 2 / SaaS 阶段补 WebSocket 反代 + 鉴权逻辑。
 */
export async function GET() {
  return fail('VNC reverse proxy not yet implemented; use direct VNC URL in Plan 1', 501);
}
