import type { SourceConfig } from './types';
import { normalizeSourceApiUrl } from './source-url';

/**
 * 复用 LibreTV-App（静态站 / Tauri 壳，v1.5.x）的视频源配置方案。
 *
 * App 的源清单写在 `public/js/config.js` 的 API_SITES 里，字段为
 * `{ api: '裸域名', name, detail?, adult? }`；自定义源存在 localStorage 的
 * `customAPIs`（`[{name,url,detail,isAdult}]`），勾选状态存在 `selectedAPIs`
 * （内置源用短名，自定义源用 `custom_<下标>`）。本项目沿用同一套字段语义，
 * 差异只在：url 必须补全为标准 CMS 接口路径（见 source-url.ts），key 统一加
 * `app_` 前缀以免与用户自建源、订阅源撞 key。
 *
 * 这里刻意 1:1 移植 App 的清单，不额外增删：App 里 `xykk`（小鸭看看）不是苹果 CMS，
 * 站内搜索与详情都由 App 自己的解析器前置拦截，搬到本项目只会是一个永远失败的源；
 * `testSource` 是空内容测试占位。两者都排除。
 */

/** App API_SITES 的原始形态 */
interface AppApiSite {
  /** App 里的短名，用于 selectedAPIs 对齐 */
  appKey: string;
  name: string;
  /** 裸域名（不含接口路径） */
  api: string;
  detail?: string;
}

/** 与 LibreTV-App public/js/config.js 的 API_SITES 保持一致（仅剔除非 CMS 源与占位源） */
const APP_API_SITES: readonly AppApiSite[] = [
  { appKey: 'dyttzy', name: '电影天堂资源', api: 'http://caiji.dyttzyapi.com', detail: 'http://caiji.dyttzyapi.com' },
  { appKey: 'ruyi', name: '如意资源', api: 'https://cj.rycjapi.com' },
  { appKey: 'bfzy', name: '暴风资源', api: 'https://bfzyapi.com' },
  { appKey: 'tyyszy', name: '天涯资源', api: 'https://tyyszy.com' },
  { appKey: 'xiaomaomi', name: '小猫咪资源', api: 'https://zy.xiaomaomi.cc' },
  { appKey: 'ffzy', name: '非凡影视', api: 'http://ffzy5.tv', detail: 'http://ffzy5.tv' },
  { appKey: 'heimuer', name: '黑木耳', api: 'https://json.heimuer.xyz', detail: 'https://heimuer.tv' },
  { appKey: 'zy360', name: '360资源', api: 'https://360zy.com' },
  { appKey: 'wolong', name: '卧龙资源', api: 'https://wolongzyw.com' },
  { appKey: 'hwba', name: '华为吧资源', api: 'https://cjhwba.com' },
  { appKey: 'jisu', name: '极速资源', api: 'https://jszyapi.com', detail: 'https://jszyapi.com' },
  { appKey: 'dbzy', name: '豆瓣资源', api: 'https://dbzy.com' },
  { appKey: 'mozhua', name: '魔爪资源', api: 'https://mozhuazy.com' },
  { appKey: 'mdzy', name: '魔都资源', api: 'https://www.mdzyapi.com' },
  { appKey: 'zuid', name: '最大资源', api: 'https://api.zuidapi.com' },
  { appKey: 'yinghua', name: '樱花资源', api: 'https://m3u8.apiyhzy.com' },
  { appKey: 'baidu', name: '百度云资源', api: 'https://api.apibdzy.com' },
  { appKey: 'wujin', name: '无尽资源', api: 'https://api.wujinapi.me' },
  { appKey: 'wwzy', name: '旺旺短剧', api: 'https://wwzy.tv' },
  { appKey: 'ikun', name: 'iKun资源', api: 'https://ikunzyapi.com' },
];

/** 内置源 key 前缀：与用户自建源（custom_N）、订阅源（sub_...）区隔 */
export const APP_SOURCE_KEY_PREFIX = 'app_';

/** App 内置源 → 本项目 SourceConfig（地址已补全为 CMS 接口） */
export function getAppBuiltinSources(): SourceConfig[] {
  return APP_API_SITES.map((site) => ({
    key: `${APP_SOURCE_KEY_PREFIX}${site.appKey}`,
    name: site.name,
    url: normalizeSourceApiUrl(site.api),
    ...(site.detail ? { detail: site.detail } : {}),
  }));
}

/** 迁移结果：sources 均为「用户原本已勾选」的源，故 selectedKeys 与之一一对应 */
export interface AppLegacyImport {
  sources: SourceConfig[];
  selectedKeys: string[];
}

/** 宽松读取 localStorage 里的数组字段：兼容 JSON 字符串、真实数组、逗号分隔的旧写法 */
function readArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  // 极老的版本把自定义源存成逗号分隔的地址串
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 取地址主机名作为缺省源名 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** 把 App 的一条自定义源（对象或纯地址字符串）转成 SourceConfig */
function toCustomSource(item: unknown, index: number): SourceConfig | null {
  let name = '';
  let rawUrl = '';
  let detail: string | undefined;
  let isAdult = false;

  if (typeof item === 'string') {
    rawUrl = item;
  } else if (typeof item === 'object' && item !== null) {
    const rec = item as Record<string, unknown>;
    rawUrl = typeof rec.url === 'string' ? rec.url : typeof rec.api === 'string' ? rec.api : '';
    name = typeof rec.name === 'string' ? rec.name.trim() : '';
    detail = typeof rec.detail === 'string' && rec.detail.trim() ? rec.detail.trim() : undefined;
    isAdult = rec.isAdult === true || rec.adult === true;
  }

  const url = normalizeSourceApiUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    key: `${APP_SOURCE_KEY_PREFIX}custom_${index}`,
    name: name || hostnameOf(url),
    url,
    ...(detail ? { detail } : {}),
    ...(isAdult ? { isAdult: true } : {}),
  };
}

/**
 * 解析 LibreTV-App 的旧版导出配置（`LibreTV-Settings` + `data.selectedAPIs` /
 * `data.customAPIs`，cfgVer 1.0.0）。
 *
 * 迁移语义：只导入用户当时**已勾选**的源——内置源按 selectedAPIs 里的短名回填，
 * 自定义源按 `custom_<下标>` 取——避免把用户明确没启用的源塞进列表。
 * 未提供 selectedAPIs 的更老配置退化为「导入全部自定义源」。
 *
 * 返回 null 表示这不是 App 旧版配置（例如是本项目 v2 的导出），调用方应走原有分支。
 */
export function parseAppLegacySources(data: Record<string, unknown>): AppLegacyImport | null {
  const customRaw = readArray(data.customAPIs);
  const selectedRaw = readArray(data.selectedAPIs);
  if (customRaw === null && selectedRaw === null) return null;

  const customs = (customRaw ?? [])
    .map((item, i) => toCustomSource(item, i))
    .filter((s): s is SourceConfig => s !== null);

  const byKey = new Map(customs.map((s) => [s.key, s]));
  const builtins = new Map(getAppBuiltinSources().map((s) => [s.key, s]));

  const picked: SourceConfig[] = [];
  const pushUnique = (src: SourceConfig | undefined) => {
    if (!src) return;
    if (picked.some((s) => s.url === src.url)) return;
    picked.push(src);
  };

  if (selectedRaw === null) {
    // 没有勾选信息：App 默认勾选全部自定义源
    customs.forEach(pushUnique);
  } else {
    for (const item of selectedRaw) {
      const id = typeof item === 'string' ? item.trim() : '';
      if (!id) continue;
      if (id.startsWith('custom_')) {
        pushUnique(byKey.get(`${APP_SOURCE_KEY_PREFIX}${id}`));
      } else {
        pushUnique(builtins.get(`${APP_SOURCE_KEY_PREFIX}${id}`));
      }
    }
  }

  return { sources: picked, selectedKeys: picked.map((s) => s.key) };
}

/**
 * 把迁移结果合并进现有源列表：地址或 key 已存在即跳过（绝不覆盖用户现有源），
 * 且只为真正新增的源补勾选——key 撞车被跳过的条目不能顺手把别人的源选中。
 */
export function mergeAppSources(
  existing: SourceConfig[],
  selectedKeys: string[],
  legacy: AppLegacyImport
): { added: SourceConfig[]; selectedKeys: string[] } {
  const usedUrls = new Set(existing.map((s) => s.url));
  const usedKeys = new Set(existing.map((s) => s.key));
  const added: SourceConfig[] = [];

  for (const src of legacy.sources) {
    if (usedUrls.has(src.url) || usedKeys.has(src.key)) continue;
    usedUrls.add(src.url);
    usedKeys.add(src.key);
    added.push(src);
  }

  const addedKeys = new Set(added.map((s) => s.key));
  const nextSelected = Array.from(
    new Set([...selectedKeys, ...legacy.selectedKeys.filter((k) => addedKeys.has(k))])
  );
  return { added, selectedKeys: nextSelected };
}
