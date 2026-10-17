/**
 * 投屏地址解析：把播放器拿到的地址还原成电视可直接拉流的绝对 URL。
 *
 * 代理形态（/api/proxy 与 /api/live/stream，查询串与路径两种写法）只服务于
 * 浏览器的 CORS/防盗链问题——电视端不需要代理且直连 CDN 更稳，投屏前统一解包
 * 还原原始地址；其余相对地址按站点 origin 绝对化。
 */

/** 查询串形式的代理前缀 → 内层地址参数名固定为 url */
const QUERY_PROXY_PREFIXES = ['/api/proxy?url=', '/api/live/stream?url='];
/** 路径形式的代理前缀（/api/proxy/<encodeURIComponent(target)>，见 proxy-handlers.ts） */
const PATH_PROXY_PREFIXES = ['/api/proxy/', '/api/live/stream/'];

/** 安全解码：畸形编码返回原文而非抛错 */
function tryDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 解包代理形态地址；非代理形态原样返回 */
export function unwrapProxyUrl(url: string): string {
  const trimmed = url.trim();
  for (const prefix of QUERY_PROXY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const inner = tryDecodeURIComponent(trimmed.slice(prefix.length));
      return inner || trimmed;
    }
  }
  for (const prefix of PATH_PROXY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const inner = tryDecodeURIComponent(trimmed.slice(prefix.length));
      return inner || trimmed;
    }
  }
  return trimmed;
}

/**
 * 解析出投屏目标地址：
 * 1. 已是绝对 http(s) 地址 → 原样返回；
 * 2. 代理形态 → 解包出内层原始地址；
 * 3. 其余（相对地址等）→ 按 origin 绝对化，解析失败返回原文。
 */
export function resolveCastUrl(url: string, origin: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const unwrapped = unwrapProxyUrl(trimmed);
  if (/^https?:\/\//i.test(unwrapped)) return unwrapped;
  try {
    return new URL(unwrapped, origin).toString();
  } catch {
    return unwrapped;
  }
}
