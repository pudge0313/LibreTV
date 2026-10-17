import { createHash } from 'node:crypto';
import type { CastDevice } from './types';

/**
 * 服务端投屏设备注册表（进程内存实现，与 auth.ts 的限流同一前提：单实例部署）。
 *
 * 安全模型：控制类请求不接受客户端传入的设备地址，只接受「本轮发现」注册进来的
 * 设备 id——发现结果绑定发现者会话（会话 token 哈希），控制时校验归属，杜绝把
 * 接口当成任意内网地址代理的 SSRF 注入面。TTL 为滑动式：每次命中都续期，
 * 长时间投屏不会中途失效。
 */

const DEVICE_TTL_MS = 10 * 60 * 1000;
/** 注册表总量上限（多用户共用部署时封顶内存占用，淘汰最先过期的） */
const MAX_DEVICES = 64;

interface DeviceRecord extends CastDevice {
  controlUrl: string;
  ownerKey: string;
  expiresAt: number;
}

const devices = new Map<string, DeviceRecord>();

function prune(): void {
  const now = Date.now();
  for (const [id, record] of devices) {
    if (now > record.expiresAt) devices.delete(id);
  }
  if (devices.size > MAX_DEVICES) {
    const sorted = [...devices.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [id] of sorted.slice(0, devices.size - MAX_DEVICES)) devices.delete(id);
  }
}

/** 由会话 token 派生注册表归属键（不存原始 token） */
export function ownerKeyFromSessionToken(token: string): string {
  return createHash('sha256').update(`cast:${token}`).digest('hex').slice(0, 32);
}

/** 设备 id：由描述地址派生，重复发现在 TTL 内保持稳定，前端可据此匹配「投屏中」状态 */
export function deviceIdOfLocation(location: string): string {
  return createHash('sha256').update(location).digest('hex').slice(0, 16);
}

/** 写入一轮发现结果，返回客户端可见列表 */
export function registerDevices(
  ownerKey: string,
  found: Array<CastDevice & { controlUrl: string }>
): CastDevice[] {
  prune();
  const now = Date.now();
  for (const device of found) {
    devices.set(device.id, {
      id: device.id,
      name: device.name,
      host: device.host,
      controlUrl: device.controlUrl,
      ownerKey,
      expiresAt: now + DEVICE_TTL_MS,
    });
  }
  return found.map(({ id, name, host }) => ({ id, name, host }));
}

/** 取归属于自己的设备；命中即滑动续期。不存在/过期/非本人发现返回 null */
export function getOwnedDevice(id: string, ownerKey: string): DeviceRecord | null {
  prune();
  const record = devices.get(id);
  if (!record || record.ownerKey !== ownerKey) return null;
  if (Date.now() > record.expiresAt) {
    devices.delete(id);
    return null;
  }
  record.expiresAt = Date.now() + DEVICE_TTL_MS;
  return record;
}
