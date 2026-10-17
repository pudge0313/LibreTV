'use client';

import { api } from '@/lib/client-api';
import type { CastControlAction, CastDevice, CastStartArgs, CastStatus } from './types';

/**
 * 客户端投屏桥：把「发现/连接/控制/轮询」抽象成统一接口，自动选择后端实现：
 * - server：经 LibreTV 服务端做 SSDP 发现与 AVTransport 控制（本期实现，
 *   要求服务端与电视同一局域网）；
 * - native：Tauri 壳原生插件（阶段二预留——壳加入 Rust DLNA 插件后，
 *   手机侧即可发现设备，摆脱服务端拓扑限制）。探测一次并缓存结果。
 */

export interface CastBridge {
  kind: 'server' | 'native';
  discover(): Promise<CastDevice[]>;
  connect(deviceId: string, args: CastStartArgs): Promise<void>;
  control(deviceId: string, action: CastControlAction, positionSec?: number): Promise<void>;
  status(deviceId: string): Promise<CastStatus>;
}

const serverBridge: CastBridge = {
  kind: 'server',
  discover: async () => {
    const res = await api.castDiscover();
    // 发现结果为空时把服务端给的原因带出去，面板直接展示
    if (res.devices.length === 0 && res.hint) throw new Error(res.hint);
    return res.devices;
  },
  connect: async (deviceId, args) => {
    await api.castConnect(deviceId, args);
  },
  control: async (deviceId, action, positionSec) => {
    const res = await api.castControl(deviceId, action, positionSec);
    if (!res.ok) throw new Error(res.error || '设备控制失败');
  },
  status: (deviceId) => api.castStatus(deviceId),
};

/** Tauri 原生桥：命令名与阶段二 Rust 插件的契约保持一致 */
const NATIVE_COMMANDS = {
  probe: 'cast_probe',
  discover: 'cast_discover',
  connect: 'cast_connect',
  control: 'cast_control',
  status: 'cast_status',
} as const;

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function getTauriInvoke(): TauriInternals['invoke'] {
  const internals = (window as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return internals?.invoke?.bind(internals);
}

const nativeBridge: CastBridge = {
  kind: 'native',
  discover: async () => {
    const invoke = getTauriInvoke();
    if (!invoke) throw new Error('原生投屏桥不可用');
    return (await invoke(NATIVE_COMMANDS.discover)) as CastDevice[];
  },
  connect: async (deviceId, args) => {
    const invoke = getTauriInvoke();
    if (!invoke) throw new Error('原生投屏桥不可用');
    await invoke(NATIVE_COMMANDS.connect, { deviceId, ...args });
  },
  control: async (deviceId, action, positionSec) => {
    const invoke = getTauriInvoke();
    if (!invoke) throw new Error('原生投屏桥不可用');
    await invoke(NATIVE_COMMANDS.control, { deviceId, action, positionSec });
  },
  status: async (deviceId) => {
    const invoke = getTauriInvoke();
    if (!invoke) throw new Error('原生投屏桥不可用');
    return (await invoke(NATIVE_COMMANDS.status, { deviceId })) as CastStatus;
  },
};

let nativeProbe: Promise<CastBridge | null> | null = null;

/** 探测壳里是否存在投屏原生插件：cast_probe 可用即 native，否则回落 server */
function probeNativeBridge(): Promise<CastBridge | null> {
  if (!nativeProbe) {
    nativeProbe = (async () => {
      const invoke = getTauriInvoke();
      if (!invoke) return null;
      try {
        await Promise.race([
          invoke(NATIVE_COMMANDS.probe),
          new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 1500)),
        ]);
        return nativeBridge;
      } catch {
        return null;
      }
    })();
  }
  return nativeProbe;
}

export async function getCastBridge(): Promise<CastBridge> {
  return (await probeNativeBridge()) ?? serverBridge;
}
