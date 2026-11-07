import { describe, expect, it } from 'vitest';
import { getAppBuiltinSources, mergeAppSources, parseAppLegacySources } from './app-sources';
import { CMS_API_PATH } from './source-url';

describe('getAppBuiltinSources', () => {
  const list = getAppBuiltinSources();

  it('内置源数量与 App 配置一致（剔除 xykk 非 CMS 源与测试占位源）', () => {
    expect(list.length).toBe(20);
  });

  it('全部补全为可请求的 CMS 接口地址', () => {
    for (const src of list) {
      expect(src.url.endsWith(CMS_API_PATH)).toBe(true);
      expect(src.url).toMatch(/^https?:\/\//);
    }
  });

  it('key 与 URL 均唯一，且 key 带 app_ 前缀', () => {
    expect(new Set(list.map((s) => s.key)).size).toBe(list.length);
    expect(new Set(list.map((s) => s.url)).size).toBe(list.length);
    for (const src of list) expect(src.key.startsWith('app_')).toBe(true);
  });

  it('保留 App 的 name / detail 字段', () => {
    const zy360 = list.find((s) => s.name === '360资源');
    expect(zy360?.url).toBe(`https://360zy.com${CMS_API_PATH}`);
    const heimuer = list.find((s) => s.name === '黑木耳');
    expect(heimuer?.detail).toBe('https://heimuer.tv');
  });
});

describe('parseAppLegacySources', () => {
  it('按 selectedAPIs 迁移内置源与自定义源', () => {
    const result = parseAppLegacySources({
      selectedAPIs: JSON.stringify(['zy360', 'custom_0']),
      customAPIs: JSON.stringify([
        { name: '我的源', url: 'https://foo.example.com', detail: 'https://foo.example.com', isAdult: false },
      ]),
    });
    expect(result).not.toBeNull();
    expect(result!.sources.map((s) => s.name)).toEqual(['360资源', '我的源']);
    expect(result!.sources[0].url).toBe(`https://360zy.com${CMS_API_PATH}`);
    expect(result!.sources[1].url).toBe(`https://foo.example.com${CMS_API_PATH}`);
    expect(result!.selectedKeys).toEqual(result!.sources.map((s) => s.key));
  });

  it('没有 selectedAPIs 时导入全部自定义源', () => {
    const result = parseAppLegacySources({
      customAPIs: JSON.stringify([{ name: 'A', url: 'https://a.example.com' }]),
    });
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0].name).toBe('A');
  });

  it('兼容逗号分隔的旧版自定义源字符串', () => {
    const result = parseAppLegacySources({
      customAPIs: 'https://a.example.com,https://b.example.com',
    });
    expect(result!.sources).toHaveLength(2);
    expect(result!.sources[1].url).toBe(`https://b.example.com${CMS_API_PATH}`);
  });

  it('过滤非法地址与未知内置 key', () => {
    const result = parseAppLegacySources({
      selectedAPIs: JSON.stringify(['not-exist', 'custom_9']),
      customAPIs: JSON.stringify([{ name: '坏源', url: 'ftp://x.example.com' }]),
    });
    expect(result!.sources).toHaveLength(0);
  });

  it('保留成人标记', () => {
    const result = parseAppLegacySources({
      customAPIs: JSON.stringify([{ name: 'A', url: 'https://a.example.com', isAdult: true }]),
    });
    expect(result!.sources[0].isAdult).toBe(true);
  });

  it('按 URL 去重（选中内置源又在自定义里重复）', () => {
    const result = parseAppLegacySources({
      selectedAPIs: JSON.stringify(['zy360', 'custom_0']),
      customAPIs: JSON.stringify([{ name: '重复', url: 'https://360zy.com' }]),
    });
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0].key).toBe('app_zy360');
  });

  it('非 App 旧版配置返回 null（本项目的 v2 配置不应误判）', () => {
    expect(parseAppLegacySources({ 'libretv-settings': '{}' })).toBeNull();
    expect(parseAppLegacySources({ viewingHistory: '[]' })).toBeNull();
  });
});

describe('mergeAppSources', () => {
  const legacy = parseAppLegacySources({
    selectedAPIs: JSON.stringify(['zy360', 'custom_0']),
    customAPIs: JSON.stringify([{ name: '自定义', url: 'https://foo.example.com' }]),
  })!;

  it('全部新增时追加源并补齐勾选', () => {
    const merged = mergeAppSources([], [], legacy);
    expect(merged.added).toHaveLength(2);
    expect(merged.selectedKeys).toEqual(['app_zy360', 'app_custom_0']);
  });

  it('同地址已存在则跳过，且不被勾选', () => {
    const existing = [{ key: 'manual_0', name: '已有', url: `https://360zy.com${CMS_API_PATH}` }];
    const merged = mergeAppSources(existing, [], legacy);
    expect(merged.added.map((s) => s.key)).toEqual(['app_custom_0']);
    expect(merged.selectedKeys).toEqual(['app_custom_0']);
  });

  it('key 撞车时跳过，绝不选中别人的同 key 源', () => {
    const existing = [{ key: 'app_zy360', name: '占位', url: 'https://other.example.com' }];
    const merged = mergeAppSources(existing, ['manual_x'], legacy);
    expect(merged.added.map((s) => s.key)).toEqual(['app_custom_0']);
    expect(merged.selectedKeys).toEqual(['manual_x', 'app_custom_0']);
  });

  it('保留调用方原有的勾选状态', () => {
    const merged = mergeAppSources([], ['keep_me'], legacy);
    expect(merged.selectedKeys).toContain('keep_me');
  });
});
