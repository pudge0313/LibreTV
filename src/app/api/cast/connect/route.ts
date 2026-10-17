import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { getOwnedDevice } from '@/lib/cast/device-registry';
import { dlnaPlay, dlnaSeek, dlnaSetAvTransportUri } from '@/lib/cast/dlna';
import { describeUpnpError, ownerKeyFromRequest } from '@/lib/cast/session-owner';
import type { CastStartArgs } from '@/lib/cast/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 发起投屏：POST /api/cast/connect
 * body: { deviceId, url, title, positionSec?, live? }
 *
 * 顺序：SetAVTransportURI（带标题元数据）→ 可选 Seek 接续进度 → Play。
 * Seek 失败不阻断（部分设备不支持 REL_TIME 或刚设源尚未就绪），Play 失败视为
 * 连接失败返回 502。媒体地址由电视直接拉流，服务端不转发流量。
 */
export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  const ownerKey = ownerKeyFromRequest(req);
  if (!ownerKey) return jsonError('会话无效，请重新登录', 401);

  let body: CastStartArgs & { deviceId?: string };
  try {
    body = (await req.json()) as CastStartArgs & { deviceId?: string };
  } catch {
    return jsonError('请求体格式错误', 400);
  }

  const { deviceId, url, title, positionSec, live } = body;
  if (!deviceId || !url || typeof url !== 'string') return jsonError('缺少设备或媒体地址', 400);

  // 媒体地址只做协议白名单校验：该地址是交给电视拉流的，服务端不请求它
  if (!/^https?:\/\//i.test(url)) return jsonError('媒体地址必须是 http(s) 绝对地址', 400);

  const device = getOwnedDevice(deviceId, ownerKey);
  if (!device) return jsonError('设备已离线或不属于当前会话，请重新搜索', 404);

  const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : 'LibreTV 投屏';
  try {
    await dlnaSetAvTransportUri(device.controlUrl, url, safeTitle, Boolean(live));
    if (typeof positionSec === 'number' && positionSec > 1) {
      try {
        await dlnaSeek(device.controlUrl, positionSec);
      } catch {
        /* 接续进度失败不阻断：部分设备设源后需要缓冲窗口才接受 Seek */
      }
    }
    await dlnaPlay(device.controlUrl);
  } catch (err) {
    return jsonError(describeUpnpError(err), 502);
  }

  return NextResponse.json({ ok: true });
}
