import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { deviceIdOfLocation } from '@/lib/cast/device-registry';
import { parseDeviceDescription } from '@/lib/cast/dlna';
import { ownerKeyFromRequest } from '@/lib/cast/session-owner';
import { registerDevices } from '@/lib/cast/device-registry';
import { ssdpDiscover } from '@/lib/cast/ssdp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 投屏设备发现：POST /api/cast/discover
 *
 * 服务端对局域网发一轮 SSDP M-SEARCH（约 3s），再逐台拉取设备描述 XML 解析出
 * friendlyName 与 AVTransport 控制地址；只有带 AVTransport 服务的渲染设备
 * （电视/盒子）才会入选。结果注册进服务端注册表并绑定发现者会话，客户端只拿到
 * id/name/host，控制地址永不下发。
 *
 * 环境限制：无 UDP 多播能力（serverless）或服务器与电视不在同一局域网时，
 * 返回空列表 + hint，由前端展示原因。
 */

/** 设备描述拉取上限：一轮发现总时长需要可控 */
const MAX_DESCRIPTIONS = 12;
const DESCRIPTION_TIMEOUT_MS = 2500;

export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  const ownerKey = ownerKeyFromRequest(req);
  if (!ownerKey) return jsonError('会话无效，请重新登录', 401);

  let socketFailed = false;
  let hits: Awaited<ReturnType<typeof ssdpDiscover>> = [];
  try {
    hits = await ssdpDiscover(3000);
  } catch {
    socketFailed = true;
  }

  const parsed: Array<{ id: string; name: string; host: string; controlUrl: string }> = [];
  await Promise.all(
    hits.slice(0, MAX_DESCRIPTIONS).map(async (hit) => {
      try {
        const res = await fetch(hit.location, { signal: AbortSignal.timeout(DESCRIPTION_TIMEOUT_MS) });
        if (!res.ok) return;
        const description = parseDeviceDescription(await res.text(), hit.location);
        if (!description) return;
        const host = new URL(hit.location).hostname;
        parsed.push({
          id: deviceIdOfLocation(hit.location),
          name: description.name,
          host,
          controlUrl: description.controlUrl,
        });
      } catch {
        /* 描述拉取失败：无法控制的设备直接跳过 */
      }
    })
  );

  const devices = registerDevices(ownerKey, parsed);
  const hint =
    devices.length === 0
      ? socketFailed
        ? '当前服务器环境不支持局域网设备发现（缺少 UDP 多播能力）'
        : '未发现可投屏设备：请确认电视已开启 DLNA/投屏开关，且与 LibreTV 服务器在同一局域网'
      : undefined;
  return NextResponse.json({ devices, hint });
}
