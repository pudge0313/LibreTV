/**
 * 投屏共享类型（客户端 hook 与服务端 API 路由共用）。
 * 协议：DLNA / UPnP AVTransport（MediaRenderer），覆盖主流国产智能电视与盒子。
 */

/** 发现结果里的投屏设备（客户端可见字段；controlUrl 只存在服务端注册表，不下发） */
export interface CastDevice {
  /** 注册表稳定 id（设备描述地址哈希），控制类请求只接受该 id */
  id: string;
  /** 设备友好名（电视/盒子上设置的名称） */
  name: string;
  /** 设备 IP（展示用） */
  host: string;
}

/** UPnP TransportState 子集（GetTransportInfo 返回值归一化） */
export type CastTransportState =
  | 'PLAYING'
  | 'PAUSED_PLAYBACK'
  | 'STOPPED'
  | 'TRANSITIONING'
  | 'NO_MEDIA_PRESENT'
  | 'UNKNOWN';

/** 电视端播放状态（/api/cast/control GET 轮询返回） */
export interface CastStatus {
  state: CastTransportState;
  positionSec: number;
  durationSec: number;
}

/** 发起投屏的参数 */
export interface CastStartArgs {
  /** 电视直接拉流的媒体地址（公网源天然可达；代理形态已在前端解包） */
  url: string;
  /** 电视端显示的标题（写入 DIDL-Lite 元数据） */
  title: string;
  /** 从本地当前进度接续投屏 */
  positionSec?: number;
  /** 直播流（DIDL class 用 broadcast，电视端部分实现会区别对待） */
  live?: boolean;
}

/** 投屏控制动作 */
export type CastControlAction = 'play' | 'pause' | 'stop' | 'seek';
