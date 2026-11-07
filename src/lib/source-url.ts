/**
 * 点播源地址归一化。
 *
 * LibreTV-App（静态站 / Tauri 壳）的源配置里 `api` 字段只写裸域名，接口路径由它的
 * API_CONFIG 在请求时拼接（`/api.php/provide/vod/?ac=videolist&...`）。本项目则是
 * 把 `?ac=videolist` 直接拼在源地址后面，若原样搬来裸域名就会请求站点首页拿到 HTML，
 * 解析必然失败。故统一在此补全标准 CMS 路径，让两边配置可直接互用。
 *
 * 只补「纯 origin」这一种最确定的形态；用户显式写了路径（`/vod`、`/at/xml` 等）时不猜，
 * 保持原样交给后续校验与请求逻辑。
 */

/** Apple CMS 采集接口标准路径 */
export const CMS_API_PATH = '/api.php/provide/vod';

/** 只有协议 + 主机（可带端口），没有路径/查询串/锚点 */
const ORIGIN_ONLY = /^(https?:\/\/[^/?#]+)$/i;
/** 已经包含接口脚本（含 `/api.php/provide/vod/at/xml` 这类变体） */
const HAS_API_SCRIPT = /\/api\.php(?:\/|$)/i;

/** 归一化点播源 API 地址；无法识别时原样返回（仅裁剪空白与尾斜杠） */
export function normalizeSourceApiUrl(input: string): string {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) return '';

  const stripped = trimmed.replace(/\/+$/, '');
  // `https://` 这类残缺输入裁掉尾斜杠会变成 `https:`，此时保留原值不做后续判断
  const candidate = stripped.endsWith(':') ? trimmed : stripped;

  if (HAS_API_SCRIPT.test(candidate)) return candidate;
  if (ORIGIN_ONLY.test(candidate)) return `${candidate}${CMS_API_PATH}`;
  return candidate;
}
