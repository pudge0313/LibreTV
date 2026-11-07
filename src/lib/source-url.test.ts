import { describe, expect, it } from 'vitest';
import { CMS_API_PATH, normalizeSourceApiUrl } from './source-url';

/**
 * LibreTV-App 的源配置只写裸域名（api 字段），CMS 接口路径由调用方拼接。
 * 本项目直接拼查询串，因此裸域名必须补全为 /api.php/provide/vod 才能拿到 JSON。
 */
describe('normalizeSourceApiUrl', () => {
  it('裸域名补全标准 CMS 接口路径', () => {
    expect(normalizeSourceApiUrl('https://360zy.com')).toBe(`https://360zy.com${CMS_API_PATH}`);
    expect(normalizeSourceApiUrl('http://ffzy5.tv')).toBe(`http://ffzy5.tv${CMS_API_PATH}`);
  });

  it('裸域名带尾斜杠同样补全（只保留一个斜杠）', () => {
    expect(normalizeSourceApiUrl('https://360zy.com/')).toBe(`https://360zy.com${CMS_API_PATH}`);
    expect(normalizeSourceApiUrl('https://360zy.com///')).toBe(`https://360zy.com${CMS_API_PATH}`);
  });

  it('带端口的裸域名补全', () => {
    expect(normalizeSourceApiUrl('http://192.168.1.10:8080')).toBe(
      `http://192.168.1.10:8080${CMS_API_PATH}`
    );
  });

  it('协议大写也能识别', () => {
    expect(normalizeSourceApiUrl('HTTPS://360zy.com')).toBe(`HTTPS://360zy.com${CMS_API_PATH}`);
  });

  it('首尾空白被裁剪', () => {
    expect(normalizeSourceApiUrl('  https://360zy.com  ')).toBe(`https://360zy.com${CMS_API_PATH}`);
  });

  it('已写全接口路径的地址原样保留（仅去尾斜杠）', () => {
    expect(normalizeSourceApiUrl('https://360zy.com/api.php/provide/vod')).toBe(
      'https://360zy.com/api.php/provide/vod'
    );
    expect(normalizeSourceApiUrl('https://360zy.com/api.php/provide/vod/')).toBe(
      'https://360zy.com/api.php/provide/vod'
    );
  });

  it('接口变体（如 XML 输出）不被改写', () => {
    const xml = 'https://xml.example.com/api.php/provide/vod/at/xml';
    expect(normalizeSourceApiUrl(xml)).toBe(xml);
  });

  it('自定义路径不猜测，原样保留', () => {
    expect(normalizeSourceApiUrl('https://example.com/vod')).toBe('https://example.com/vod');
    expect(normalizeSourceApiUrl('https://example.com/custom/api')).toBe('https://example.com/custom/api');
  });

  it('空串与非 http 协议原样返回（交由后续校验拦截）', () => {
    expect(normalizeSourceApiUrl('')).toBe('');
    expect(normalizeSourceApiUrl('   ')).toBe('');
    expect(normalizeSourceApiUrl('ftp://example.com')).toBe('ftp://example.com');
    expect(normalizeSourceApiUrl('example.com')).toBe('example.com');
  });

  it('幂等：重复调用结果一致', () => {
    const once = normalizeSourceApiUrl('https://360zy.com');
    expect(normalizeSourceApiUrl(once)).toBe(once);
  });
});
