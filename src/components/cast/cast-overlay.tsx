'use client';

import { useEffect, useState } from 'react';
import { formatTime } from '@/lib/utils';
import { Spinner } from '@/components/states';
import { Icon } from '@/components/icon';
import type { CastDevice } from '@/lib/cast/types';
import type { CastStartArgs, UseCast } from '@/lib/cast/use-cast';

/**
 * 投屏浮层：挂在播放器容器内部（绝对定位）而非全局 Drawer——
 * ArtPlayer 原生全屏会创建新的顶层渲染上下文，fixed 定位的全局组件盖不住它，
 * 只有播放器容器的子节点才能在全屏态显示。设备列表与遥控态共用这一个浮层。
 */

/** ArtPlayer 控制条按钮用的内联 SVG（与 Icon 组件的 cast 图形同源，lucide 线性风格） */
export const CAST_BUTTON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 12a9 9 0 0 1 8 8"/><path d="M2 16a5 5 0 0 1 4 4"/><path d="M2 20h.01"/></svg>';

interface CastOverlayProps {
  open: boolean;
  onClose: () => void;
  cast: UseCast;
  /** 发起投屏时构造参数（父级持有当前 url/title/本地进度） */
  getStartArgs: () => CastStartArgs;
  /** 投屏成功后的本地善后（暂停本机、停预取/停拉流） */
  onCastStarted: () => void;
  /** 用户主动断开后的本地善后（tvPositionSec 用于本地续播） */
  onCastStopped: (tvPositionSec: number | null) => void;
  /** 直播态：无进度条、无 Seek */
  live?: boolean;
}

/** 设备行 */
function DeviceRow({
  device,
  connecting,
  disabled,
  onSelect,
}: {
  device: CastDevice;
  connecting: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-left transition-colors hover:bg-white/10 disabled:opacity-50"
      disabled={disabled}
      onClick={onSelect}
    >
      <Icon name="tv" className="w-5 h-5 shrink-0 text-white/80" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white truncate">{device.name}</span>
        <span className="block text-[10px] text-white/50 truncate">{device.host}</span>
      </span>
      {connecting && <Spinner size="sm" tone="onDark" />}
    </button>
  );
}

/** 遥控态：进度条（直播隐藏）+ 播放/暂停 + 断开 */
function RemoteState({ cast, live, onStop }: { cast: UseCast; live: boolean; onStop: () => void }) {
  const session = cast.session;
  const [scrub, setScrub] = useState<number | null>(null);
  if (!session) return null;

  const position = scrub ?? session.positionSec;
  const duration = session.durationSec > 0 ? session.durationSec : 0;

  const commitScrub = () => {
    if (scrub === null) return;
    void cast.seek(scrub);
    setScrub(null);
  };

  const stateLabel =
    session.state === 'PLAYING'
      ? '播放中'
      : session.state === 'PAUSED_PLAYBACK'
        ? '已暂停'
        : session.state === 'TRANSITIONING'
          ? '缓冲中...'
          : '';

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2 text-white/70 text-xs">
        <Icon name="cast" className="w-4 h-4 shrink-0" />
        <span className="truncate">正在投屏到「{session.deviceName}」</span>
        {stateLabel && <span className="ml-auto shrink-0 text-white/50">{stateLabel}</span>}
      </div>
      <p className="text-sm text-white font-medium line-clamp-2 leading-relaxed">{session.title}</p>

      {!live && duration > 0 && (
        <div className="flex flex-col gap-1">
          <input
            type="range"
            min={0}
            max={duration}
            step={1}
            value={Math.min(position, duration)}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={commitScrub}
            onTouchEnd={commitScrub}
            onKeyUp={commitScrub}
            className="w-full accent-[#2563eb] cursor-pointer"
            aria-label="投屏播放进度"
          />
          <div className="flex justify-between text-[10px] text-white/50 tabular-nums">
            <span>{formatTime(position)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          className="flex-1 h-9 rounded-md bg-white/10 border border-white/20 text-sm text-white hover:bg-white/20 transition-colors disabled:opacity-50"
          disabled={Boolean(session.endedNotice) || session.state === 'TRANSITIONING'}
          onClick={() => void cast.togglePlay()}
        >
          {session.state === 'PLAYING' ? '暂停' : '播放'}
        </button>
        <button
          className="flex-1 h-9 rounded-md bg-white/10 border border-white/20 text-sm text-white hover:bg-white/20 transition-colors"
          onClick={onStop}
        >
          断开投屏
        </button>
      </div>
    </div>
  );
}

export function CastOverlay({
  open,
  onClose,
  cast,
  getStartArgs,
  onCastStarted,
  onCastStopped,
  live = false,
}: CastOverlayProps) {
  const { session, devices, discovering, connectingId, error } = cast;

  // 打开面板且无进行中的会话时自动发现一轮
  useEffect(() => {
    if (!open || session) return;
    if (devices.length === 0 && !discovering && !error) {
      void cast.discover();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  if (!open) return null;

  const handleStop = async () => {
    const tvPosition = await cast.stopCast();
    onCastStopped(tvPosition);
    onClose();
  };

  const handleSelect = async (device: CastDevice) => {
    const ok = await cast.startCast(device, getStartArgs());
    if (ok) {
      onCastStarted();
      onClose();
    }
  };

  const endedNotice = session?.endedNotice;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 animate-fade-in">
      <div className="w-[90%] max-w-xs sm:max-w-sm bg-black/85 backdrop-blur border border-white/10 rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">投屏到电视</h3>
          <button
            className="p-1 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            onClick={onClose}
            aria-label="关闭投屏面板"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        {endedNotice ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-white/70 leading-relaxed">
              {endedNotice}
              {live ? '' : '，本机已从电视端进度继续播放。'}
            </p>
            <button
              className="h-9 rounded-md bg-white/10 border border-white/20 text-sm text-white hover:bg-white/20 transition-colors"
              onClick={() => {
                cast.dismissEndedNotice();
                onClose();
              }}
            >
              知道了
            </button>
          </div>
        ) : session ? (
          <RemoteState cast={cast} live={live} onStop={() => void handleStop()} />
        ) : (
          <div className="flex flex-col gap-2 min-h-[120px]">
            {devices.length > 0 && (
              <p className="text-[10px] text-white/40 truncate">
                点击设备开始投屏，本机播放将暂停
              </p>
            )}
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                connecting={connectingId === device.id}
                disabled={connectingId !== null}
                onSelect={() => void handleSelect(device)}
              />
            ))}
            {discovering && devices.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6 text-white/50">
                <Spinner size="md" tone="onDark" />
                <span className="text-xs">正在搜索局域网设备...</span>
              </div>
            )}
            {!discovering && devices.length === 0 && (
              <div className="flex-1 flex items-center py-6">
                <p className="text-xs text-white/50 leading-relaxed">
                  {error || '未发现可投屏设备。请确认电视已开启 DLNA/投屏功能，且与 LibreTV 服务器在同一局域网。'}
                </p>
              </div>
            )}
            <button
              className="self-start flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors disabled:opacity-50"
              disabled={discovering}
              onClick={() => void cast.discover()}
            >
              <Icon name="refresh" className="w-3.5 h-3.5" />
              重新搜索
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
