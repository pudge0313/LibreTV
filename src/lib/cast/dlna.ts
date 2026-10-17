import type { CastTransportState } from './types';

/**
 * DLNA / UPnP AVTransport 控制封装（仅服务端使用）。
 *
 * AVTransport 的动作集合在所有渲染设备上是标准化的事实约定（SetAVTransportURI /
 * Play / Pause / Stop / Seek / GetPositionInfo / GetTransportInfo），直接用
 * 固定 SOAP 模板即可驱动绝大多数国产电视与盒子，无需解析各家的 SCPD。
 * 超时统一收紧（电视端偶发数秒无响应），由上层决定失败语义。
 *
 * 注入面说明：本模块不含任何 shell/子进程调用；外部数据（视频 URL、标题）
 * 全部经 xmlEscape 转义后才进入 SOAP/DIDL 报文，控制目标地址只来自服务端
 * 自行发现的设备注册表，不接受客户端传入的原始地址。
 */

const AVT_SERVICE_TYPE = 'urn:schemas-upnp-org:service:AVTransport:1';

/** XML 文本转义（用于 URI 与标题嵌入 SOAP / DIDL） */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 解码 XML 实体（设备描述里的 friendlyName 常含中文实体/CDATA） */
export function decodeXmlEntities(raw: string): string {
  let text = raw.trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) text = cdata[1];
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const n = parseInt(hex, 16);
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const n = parseInt(dec, 10);
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function soapEnvelope(action: string, inner: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${AVT_SERVICE_TYPE}">${inner}</u:${action}></s:Body>` +
    `</s:Envelope>`
  );
}

/** 调用一次 AVTransport 动作，返回响应原文；网络/HTTP 层失败抛错 */
export async function avTransportCall(
  controlUrl: string,
  action: string,
  innerArgs: string,
  timeoutMs: number
): Promise<string> {
  const res = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${AVT_SERVICE_TYPE}#${action}"`,
    },
    body: soapEnvelope(action, innerArgs),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AVTransport ${action} HTTP ${res.status}`);
  return res.text();
}

/** 构造 DIDL-Lite 元数据：电视端列表展示标题，class 区分点播/直播 */
export function buildDidlMetadata(title: string, url: string, live: boolean): string {
  const upnpClass = live ? 'object.item.videoItem.broadcast' : 'object.item.videoItem';
  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
    `<item id="libretv-cast-1" restricted="0">` +
    `<dc:title>${xmlEscape(title)}</dc:title>` +
    `<upnp:class>${upnpClass}</upnp:class>` +
    `<res>${xmlEscape(url)}</res>` +
    `</item></DIDL-Lite>`
  );
}

export function dlnaSetAvTransportUri(
  controlUrl: string,
  url: string,
  title: string,
  live: boolean,
  timeoutMs = 6000
): Promise<string> {
  const inner =
    `<InstanceID>0</InstanceID>` +
    `<CurrentURI>${xmlEscape(url)}</CurrentURI>` +
    `<CurrentURIMetaData>${xmlEscape(buildDidlMetadata(title, url, live))}</CurrentURIMetaData>`;
  return avTransportCall(controlUrl, 'SetAVTransportURI', inner, timeoutMs);
}

export function dlnaPlay(controlUrl: string, timeoutMs = 4000): Promise<string> {
  return avTransportCall(controlUrl, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>', timeoutMs);
}

export function dlnaPause(controlUrl: string, timeoutMs = 4000): Promise<string> {
  return avTransportCall(controlUrl, 'Pause', '<InstanceID>0</InstanceID>', timeoutMs);
}

export function dlnaStop(controlUrl: string, timeoutMs = 4000): Promise<string> {
  return avTransportCall(controlUrl, 'Stop', '<InstanceID>0</InstanceID>', timeoutMs);
}

export function dlnaSeek(controlUrl: string, positionSec: number, timeoutMs = 4000): Promise<string> {
  return avTransportCall(
    controlUrl,
    'Seek',
    `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${formatSeekTime(positionSec)}</Target>`,
    timeoutMs
  );
}

export function dlnaGetPositionInfo(controlUrl: string, timeoutMs = 3500): Promise<string> {
  return avTransportCall(controlUrl, 'GetPositionInfo', '<InstanceID>0</InstanceID>', timeoutMs);
}

export function dlnaGetTransportInfo(controlUrl: string, timeoutMs = 3500): Promise<string> {
  return avTransportCall(controlUrl, 'GetTransportInfo', '<InstanceID>0</InstanceID>', timeoutMs);
}

/** 秒 → UPnP REL_TIME（H:MM:SS）；非法输入按 0 处理 */
export function formatSeekTime(totalSec: number): string {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** UPnP 时间（H:MM:SS / MM:SS）→ 秒；NOT_IMPLEMENTED 或畸形返回 NaN */
export function parseTimeToSec(raw: string): number {
  const text = raw.trim();
  const long = text.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (long) return Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3]);
  const short = text.match(/^(\d+):(\d{1,2})$/);
  if (short) return Number(short[1]) * 60 + Number(short[2]);
  return NaN;
}

/**
 * 从 SOAP 响应里取第一个指定标签的文本值。
 * AVTransport 响应的值标签不带命名空间前缀（只有 Response 元素带 u:），
 * 用字符串定位即可，避免动态构造正则；结尾容忍任意前缀的闭合标签。
 */
export function parseSoapValue(xml: string, localName: string): string {
  const exact = xml.indexOf(`<${localName}>`);
  let valueStart = -1;
  if (exact >= 0) {
    valueStart = exact + localName.length + 2;
  } else {
    const withAttrs = xml.indexOf(`<${localName} `);
    if (withAttrs < 0) return '';
    const gt = xml.indexOf('>', withAttrs);
    if (gt < 0) return '';
    valueStart = gt + 1;
  }
  const close = xml.indexOf('</', valueStart);
  if (close < 0) return '';
  return decodeXmlEntities(xml.slice(valueStart, close));
}

/** GetPositionInfo 响应 → 秒（缺省/NOT_IMPLEMENTED 归 0） */
export function parseGetPositionInfo(body: string): { positionSec: number; durationSec: number } {
  const positionSec = parseTimeToSec(parseSoapValue(body, 'RelTime'));
  const durationSec = parseTimeToSec(parseSoapValue(body, 'TrackDuration'));
  return {
    positionSec: Number.isFinite(positionSec) ? positionSec : 0,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
  };
}

/** GetTransportInfo 响应 → 归一化状态 */
export function parseGetTransportInfo(body: string): CastTransportState {
  const raw = parseSoapValue(body, 'CurrentTransportState').toUpperCase();
  switch (raw) {
    case 'PLAYING':
    case 'PAUSED_PLAYBACK':
    case 'STOPPED':
    case 'TRANSITIONING':
    case 'NO_MEDIA_PRESENT':
      return raw;
    default:
      return 'UNKNOWN';
  }
}

/**
 * 解析设备描述 XML，取 friendlyName 与 AVTransport 控制地址。
 * 不带 AVTransport 服务的设备（如纯 MediaServer）返回 null——没有控制点就没法投。
 */
export function parseDeviceDescription(
  xml: string,
  descriptionUrl: string
): { name: string; controlUrl: string } | null {
  const nameMatch = xml.match(/<friendlyName(?:\s[^>]*)?>([\s\S]*?)<\/friendlyName>/i);
  const name = decodeXmlEntities(nameMatch ? nameMatch[1] : '') || '未知设备';

  const urlBaseMatch = xml.match(/<URLBase(?:\s[^>]*)?>([\s\S]*?)<\/URLBase>/i);
  const base = urlBaseMatch ? decodeXmlEntities(urlBaseMatch[1]).trim() || descriptionUrl : descriptionUrl;

  const services = xml.matchAll(/<service\b[^>]*>([\s\S]*?)<\/service>/gi);
  for (const service of services) {
    const block = service[1];
    const typeMatch = block.match(/<serviceType(?:\s[^>]*)?>([\s\S]*?)<\/serviceType>/i);
    if (!typeMatch || decodeXmlEntities(typeMatch[1]).trim() !== AVT_SERVICE_TYPE) continue;
    const controlMatch = block.match(/<controlURL(?:\s[^>]*)?>([\s\S]*?)<\/controlURL>/i);
    if (!controlMatch) continue;
    const controlPath = decodeXmlEntities(controlMatch[1]).trim();
    if (!controlPath) continue;
    try {
      return { name, controlUrl: new URL(controlPath, base).toString() };
    } catch {
      return null;
    }
  }
  return null;
}
