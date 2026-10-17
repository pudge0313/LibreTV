import { createSocket } from 'node:dgram';

/**
 * SSDP 设备发现（仅服务端使用）。
 *
 * 浏览器/WebView 无法收发 UDP，投屏发现由 LibreTV 服务端代劳：对多播地址发
 * M-SEARCH，收集 MediaRenderer/AVTransport 响应并按设备描述地址去重。
 * Docker/NAS 等同机部署时服务端与电视同处一个局域网，天然可达；
 * serverless/公网部署没有 UDP 多播能力，bind 失败时返回空列表（上层给出提示）。
 */

export interface SsdpHit {
  /** 设备描述 XML 地址（UPnP LOCATION） */
  location: string;
  usn: string;
  /** 搜索目标（响应里的 ST 头） */
  st: string;
}

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

/** 搜索目标：MediaRenderer 直指 + AVTransport 服务 + rootdevice 兜底（部分电视只应答 rootdevice） */
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:service:AVTransport:1',
  'upnp:rootdevice',
];

/** 大小写不敏感地解析响应头（不同厂商 ST/USN/LOCATION 大小写不一） */
function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return headers;
}

/** 对结果目标类型做过滤：渲染设备/AVTransport/兜底的 rootdevice，滤掉 MediaServer 等噪音 */
function isRelevantTarget(st: string): boolean {
  const lower = st.toLowerCase();
  return (
    lower.includes('mediarenderer') ||
    lower.includes('avtransport') ||
    lower === 'upnp:rootdevice' ||
    lower === 'ssdp:all'
  );
}

/**
 * 发一轮 M-SEARCH 并收集响应，超时后返回去重结果。
 * Socket 出错（无多播权限等）按空结果处理，不向上抛——发现失败是可降级场景。
 */
export function ssdpDiscover(timeoutMs = 3000): Promise<SsdpHit[]> {
  return new Promise((resolve) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    // key 用 LOCATION 去重：同一设备会对多个 ST 各回一条响应
    const found = new Map<string, SsdpHit>();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* 已关闭/未绑定 */
      }
      resolve([...found.values()]);
    };

    socket.on('error', finish);
    socket.on('message', (buf) => {
      const text = buf.toString('utf8');
      if (!/^HTTP\/1\.\d 200/i.test(text)) return;
      const headers = parseHeaders(text);
      const location = headers.get('location');
      if (!location || found.has(location)) return;
      const st = headers.get('st') || headers.get('nt') || '';
      if (!isRelevantTarget(st)) return;
      found.set(location, { location, usn: headers.get('usn') || '', st });
    });

    socket.bind(() => {
      for (const st of SEARCH_TARGETS) {
        const packet = Buffer.from(
          [
            'M-SEARCH * HTTP/1.1',
            `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
            'MAN: "ssdp:discover"',
            'MX: 2',
            `ST: ${st}`,
            '',
            '',
          ].join('\r\n')
        );
        socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_ADDR);
      }
      setTimeout(finish, timeoutMs);
    });
  });
}
