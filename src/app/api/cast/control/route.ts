import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { getOwnedDevice } from '@/lib/cast/device-registry';
import {
  dlnaGetTransportInfo,
  dlnaGetPositionInfo,
  dlnaPause,
  dlnaPlay,
  dlnaSeek,
  dlnaStop,
  parseGetTransportInfo,
  parseGetPositionInfo,
} from '@/lib/cast/dlna';
import { describeUpnpError, ownerKeyFromRequest } from '@/lib/cast/session-owner';
import type { CastControlAction } from '@/lib/cast/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 投屏控制与状态轮询：
 * - POST /api/cast/control  body: { deviceId, action: play|pause|stop|seek, positionSec? }
 * - GET  /api/cast/control?deviceId=...  → { state, positionSec, durationSec }
 *
 * GET 并行调用 GetTransportInfo + GetPositionInfo；单个查询失败按UNKNOWN/0 处理
 * （部分设备在 TRANSITIONING 阶段会拒绝其中之一），两个都失败才整体报错。
 */
export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  const ownerKey = ownerKeyFromRequest(req);
  if (!ownerKey) return jsonError('会话无效，请重新登录', 401);

  let body: { deviceId?: string; action?: CastControlAction; positionSec?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('请求体格式错误', 400);
  }

  const { deviceId, action, positionSec } = body;
  const actions: CastControlAction[] = ['play', 'pause', 'stop', 'seek'];
  if (!deviceId || !action || !actions.includes(action)) return jsonError('缺少设备或控制动作', 400);
  if (action === 'seek' && !(typeof positionSec === 'number' && positionSec >= 0)) {
    return jsonError('缺少跳转目标时间', 400);
  }

  const device = getOwnedDevice(deviceId, ownerKey);
  if (!device) return jsonError('设备已离线或不属于当前会话，请重新搜索', 404);

  try {
    switch (action) {
      case 'play':
        await dlnaPlay(device.controlUrl);
        break;
      case 'pause':
        await dlnaPause(device.controlUrl);
        break;
      case 'stop':
        await dlnaStop(device.controlUrl);
        break;
      case 'seek':
        await dlnaSeek(device.controlUrl, positionSec as number);
        break;
    }
  } catch (err) {
    // Stop 失败（电视已关等）也要让前端会话能收尾：返回 ok=false 而非 5xx
    return NextResponse.json({ ok: false, error: describeUpnpError(err) });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  const ownerKey = ownerKeyFromRequest(req);
  if (!ownerKey) return jsonError('会话无效，请重新登录', 401);

  const deviceId = new URL(req.url).searchParams.get('deviceId');
  if (!deviceId) return jsonError('缺少设备 id', 400);

  const device = getOwnedDevice(deviceId, ownerKey);
  if (!device) return jsonError('设备已离线或不属于当前会话，请重新搜索', 404);

  const [transport, position] = await Promise.allSettled([
    dlnaGetTransportInfo(device.controlUrl),
    dlnaGetPositionInfo(device.controlUrl),
  ]);

  if (transport.status === 'rejected' && position.status === 'rejected') {
    return jsonError(describeUpnpError(transport.reason), 502);
  }

  const state =
    transport.status === 'fulfilled' ? parseGetTransportInfo(transport.value) : 'UNKNOWN';
  const pos = position.status === 'fulfilled' ? parseGetPositionInfo(position.value) : { positionSec: 0, durationSec: 0 };
  return NextResponse.json({ state, positionSec: pos.positionSec, durationSec: pos.durationSec });
}
