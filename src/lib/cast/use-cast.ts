'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getCastBridge, type CastBridge } from './bridge';
import { resolveCastUrl } from './cast-url';
import type { CastDevice, CastStartArgs, CastTransportState } from './types';

export type { CastStartArgs };

/**
 * 投屏会话 hook。
 *
 * 会话是全局单例（同一时刻只投一台设备），存模块级 store：播放器组件随路由
 * 反复挂载/卸载，投屏不能跟着断；UI 通过 useSyncExternalStore 订阅。
 * 轮询循环同样挂在模块级：每 2s 拉一次电视端状态，驱动遥控态 UI，并把进度
 * 转发给 progressHandler（播放器用它同步观看历史）。
 *
 * 自动收尾语义：一旦状态出现过 PLAYING/PAUSED，再回到 STOPPED 视为电视端主动
 * 停止（或格式不被支持），本地会话结束并给出提示；连续 3 次轮询失败视为失联。
 */

export interface CastSession {
  deviceId: string;
  deviceName: string;
  /** 电视端正在播的标题 */
  title: string;
  state: CastTransportState;
  positionSec: number;
  durationSec: number;
  /** 会话异常终止的原因（电视端停止/失联），UI 展示后由用户关闭 */
  endedNotice?: string;
}

type ProgressHandler = ((position: number, duration: number) => void) | null;

// —— 模块级会话 store ——
let session: CastSession | null = null;
const listeners = new Set<() => void>();
let activeBridge: CastBridge | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollFailures = 0;
let transportSeen = false;
let progressHandler: ProgressHandler = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function setSession(next: CastSession | null): void {
  session = next;
  emit();
}

function updateSession(patch: Partial<CastSession>): void {
  if (!session) return;
  session = { ...session, ...patch };
  emit();
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function endSession(notice: string): void {
  stopPolling();
  if (!session) return;
  setSession({ ...session, endedNotice: notice });
}

async function pollOnce(): Promise<void> {
  const current = session;
  // endedNotice 态不再轮询，等用户关闭
  if (!current || current.endedNotice || !activeBridge) {
    stopPolling();
    return;
  }
  try {
    const status = await activeBridge.status(current.deviceId);
    pollFailures = 0;
    if (status.state === 'PLAYING' || status.state === 'PAUSED_PLAYBACK') transportSeen = true;
    updateSession({
      state: status.state,
      positionSec: status.positionSec,
      durationSec: status.durationSec,
    });
    progressHandler?.(status.positionSec, status.durationSec);
    if (transportSeen && status.state === 'STOPPED') endSession('电视端已停止播放');
  } catch {
    pollFailures += 1;
    if (pollFailures >= 3) endSession('与设备失去连接');
  }
}

function startPolling(): void {
  stopPolling();
  pollFailures = 0;
  transportSeen = false;
  pollTimer = setInterval(() => {
    void pollOnce();
  }, 2000);
  void pollOnce();
}

/** 播放器注册进度转发（同步观看历史）；卸载时传 null 注销 */
export function setCastProgressHandler(handler: ProgressHandler): void {
  progressHandler = handler;
}

export function useCastSession(): CastSession | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => session,
    () => null
  );
}

// —— hook：设备列表/发现是面板本地状态；会话与控制走模块级单例 ——

export interface UseCast {
  session: CastSession | null;
  devices: CastDevice[];
  discovering: boolean;
  connectingId: string | null;
  error: string;
  discover: () => Promise<void>;
  /** 换集/换台跟投时只有会话里的 id/name，host 不强制 */
  startCast: (device: Pick<CastDevice, 'id' | 'name'>, args: CastStartArgs) => Promise<boolean>;
  togglePlay: () => Promise<void>;
  seek: (sec: number) => Promise<void>;
  /** 断开投屏；返回断开时电视端进度（供本地续播 seek，未知为 null） */
  stopCast: () => Promise<number | null>;
  dismissEndedNotice: () => void;
}

export function useCast(): UseCast {
  const sessionState = useCastSession();
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  // 卸载后丢弃异步回调里的 setState（轮询/store 在模块级，继续正常工作）
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const discover = useCallback(async () => {
    setDiscovering(true);
    setError('');
    try {
      const bridge = await getCastBridge();
      const list = await bridge.discover();
      if (!mountedRef.current) return;
      setDevices(list);
    } catch (err) {
      if (!mountedRef.current) return;
      setDevices([]);
      setError(err instanceof Error ? err.message : '设备发现失败');
    } finally {
      if (mountedRef.current) setDiscovering(false);
    }
  }, []);

  const startCast = useCallback(
    async (device: Pick<CastDevice, 'id' | 'name'>, args: CastStartArgs): Promise<boolean> => {
      setError('');
      setConnectingId(device.id);
      try {
        const bridge = await getCastBridge();
        // 投屏地址统一在此解包/绝对化：播放器只管传页面当前剧集原始地址
        const payload: CastStartArgs = { ...args, url: resolveCastUrl(args.url, window.location.origin) };
        await bridge.connect(device.id, payload);
        activeBridge = bridge;
        setSession({
          deviceId: device.id,
          deviceName: device.name,
          title: payload.title,
          state: 'TRANSITIONING',
          positionSec: payload.positionSec ?? 0,
          durationSec: 0,
        });
        startPolling();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : '投屏失败，请重试');
        return false;
      } finally {
        if (mountedRef.current) setConnectingId(null);
      }
    },
    []
  );

  const togglePlay = useCallback(async () => {
    const current = session;
    if (!current || current.endedNotice) return;
    try {
      await activeBridge?.control(current.deviceId, current.state === 'PLAYING' ? 'pause' : 'play');
      updateSession({ state: current.state === 'PLAYING' ? 'PAUSED_PLAYBACK' : 'PLAYING' });
    } catch {
      /* 轮询会带来真实状态，这里不重复报错 */
    }
  }, []);

  const seek = useCallback(async (sec: number) => {
    const current = session;
    if (!current || current.endedNotice) return;
    updateSession({ positionSec: sec });
    try {
      await activeBridge?.control(current.deviceId, 'seek', sec);
    } catch {
      /* 同上：交给轮询校正 */
    }
  }, []);

  const stopCast = useCallback(async (): Promise<number | null> => {
    const current = session;
    if (!current) return null;
    const tvPosition = current.positionSec > 0 ? current.positionSec : null;
    stopPolling();
    try {
      await activeBridge?.control(current.deviceId, 'stop');
    } catch {
      /* 电视可能已关机：本地照常收尾 */
    }
    setSession(null);
    return tvPosition;
  }, []);

  const dismissEndedNotice = useCallback(() => {
    setSession(null);
  }, []);

  return {
    session: sessionState,
    devices,
    discovering,
    connectingId,
    error,
    discover,
    startCast,
    togglePlay,
    seek,
    stopCast,
    dismissEndedNotice,
  };
}
