import { describe, expect, it } from 'vitest';
import { resolveCastUrl, unwrapProxyUrl } from './cast-url';

const ORIGIN = 'https://libretv.example.com';

describe('unwrapProxyUrl', () => {
  it('查询串形式的通用代理与直播代理都解包', () => {
    const inner = 'https://cdn.example.com/video.m3u8?token=x';
    expect(unwrapProxyUrl(`/api/proxy?url=${encodeURIComponent(inner)}`)).toBe(inner);
    expect(unwrapProxyUrl(`/api/live/stream?url=${encodeURIComponent(inner)}`)).toBe(inner);
  });

  it('路径形式的代理也解包（旧版兼容写法）', () => {
    const inner = 'https://cdn.example.com/video.m3u8';
    expect(unwrapProxyUrl(`/api/proxy/${encodeURIComponent(inner)}`)).toBe(inner);
    expect(unwrapProxyUrl(`/api/live/stream/${encodeURIComponent(inner)}`)).toBe(inner);
  });

  it('非代理形态原样返回', () => {
    expect(unwrapProxyUrl('https://cdn.example.com/a.m3u8')).toBe('https://cdn.example.com/a.m3u8');
    expect(unwrapProxyUrl('/api/search?wd=x')).toBe('/api/search?wd=x');
  });

  it('畸形编码不抛错，内层返回原文', () => {
    expect(unwrapProxyUrl('/api/proxy?url=%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('resolveCastUrl', () => {
  it('绝对 http(s) 地址原样返回', () => {
    expect(resolveCastUrl('https://cdn.example.com/a.m3u8', ORIGIN)).toBe('https://cdn.example.com/a.m3u8');
    expect(resolveCastUrl('http://cdn.example.com/a.mp4', ORIGIN)).toBe('http://cdn.example.com/a.mp4');
  });

  it('代理形态解包出原始地址（电视直连 CDN，不走服务端）', () => {
    const inner = 'https://cdn.example.com/live.m3u8';
    expect(resolveCastUrl(`/api/proxy?url=${encodeURIComponent(inner)}`, ORIGIN)).toBe(inner);
    expect(resolveCastUrl(`/api/live/stream?url=${encodeURIComponent(inner)}`, ORIGIN)).toBe(inner);
  });

  it('相对地址按站点 origin 绝对化', () => {
    expect(resolveCastUrl('/video/a.mp4', ORIGIN)).toBe(`${ORIGIN}/video/a.mp4`);
  });

  it('空地址返回空串', () => {
    expect(resolveCastUrl('  ', ORIGIN)).toBe('');
  });
});
