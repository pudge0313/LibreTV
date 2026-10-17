import { SESSION_COOKIE } from '@/lib/auth';
import { ownerKeyFromSessionToken } from './device-registry';

/**
 * 从请求 Cookie 提取会话 token 并派生设备注册表归属键。
 * 三个 /api/cast 路由共用；无会话时返回空串（由各路由的 guardRequest 先行拦截，
 * 这里兜底只为类型完整，空串派生的 key 不会与任何真实会话的发现结果冲突匹配——
 * 但为绝对起见，调用方在 token 为空时直接拒绝）。
 */
export function ownerKeyFromRequest(req: Request): string {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const token = decodeURIComponent(part.slice(eq + 1).trim());
    return token ? ownerKeyFromSessionToken(token) : '';
  }
  return '';
}

/** 统一的 502 语义：电视端无响应/拒绝（区分超时给更友好的提示） */
export function describeUpnpError(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return '设备无响应，请确认电视已开机且与 LibreTV 服务在同一局域网';
  }
  if (err instanceof Error && /HTTP 5\d\d/.test(err.message)) {
    return '电视端拒绝了投屏请求，可能不支持该视频格式';
  }
  return '设备连接失败，请重新搜索后再试';
}
