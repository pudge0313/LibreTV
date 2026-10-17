import { describe, expect, it } from 'vitest';
import {
  buildDidlMetadata,
  decodeXmlEntities,
  formatSeekTime,
  parseDeviceDescription,
  parseGetPositionInfo,
  parseGetTransportInfo,
  parseSoapValue,
  parseTimeToSec,
} from './dlna';

describe('formatSeekTime', () => {
  it('秒 → H:MM:SS', () => {
    expect(formatSeekTime(0)).toBe('0:00:00');
    expect(formatSeekTime(62)).toBe('0:01:02');
    expect(formatSeekTime(3723)).toBe('1:02:03');
    expect(formatSeekTime(86399)).toBe('23:59:59');
  });

  it('非法输入按 0 处理', () => {
    expect(formatSeekTime(NaN)).toBe('0:00:00');
    expect(formatSeekTime(-5)).toBe('0:00:00');
    expect(formatSeekTime(1.9)).toBe('0:00:01');
  });
});

describe('parseTimeToSec', () => {
  it('H:MM:SS 与 MM:SS 都能解析', () => {
    expect(parseTimeToSec('0:01:02')).toBe(62);
    expect(parseTimeToSec('1:02:03')).toBe(3723);
    expect(parseTimeToSec('05:30')).toBe(330);
  });

  it('NOT_IMPLEMENTED / 空串 / 畸形返回 NaN', () => {
    expect(parseTimeToSec('NOT_IMPLEMENTED')).toBeNaN();
    expect(parseTimeToSec('')).toBeNaN();
    expect(parseTimeToSec('1:2:3:4')).toBeNaN();
  });
});

describe('parseSoapValue', () => {
  const body =
    '<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">' +
    '<Track>1</Track><TrackDuration>0:04:23</TrackDuration>' +
    '<TrackURI>http://cdn.example.com/a.m3u8?token=x&amp;y=1</TrackURI>' +
    '<RelTime>0:01:02</RelTime></u:GetPositionInfoResponse>';

  it('取指定标签文本并解码实体', () => {
    expect(parseSoapValue(body, 'RelTime')).toBe('0:01:02');
    expect(parseSoapValue(body, 'TrackDuration')).toBe('0:04:23');
    expect(parseSoapValue(body, 'TrackURI')).toBe('http://cdn.example.com/a.m3u8?token=x&y=1');
  });

  it('缺失标签返回空串', () => {
    expect(parseSoapValue(body, 'AbsTime')).toBe('');
  });
});

describe('parseGetPositionInfo', () => {
  it('RelTime/TrackDuration → 秒；缺省归 0', () => {
    expect(
      parseGetPositionInfo('<x><RelTime>0:01:02</RelTime><TrackDuration>0:04:23</TrackDuration></x>')
    ).toEqual({ positionSec: 62, durationSec: 263 });
    expect(parseGetPositionInfo('<x><RelTime>NOT_IMPLEMENTED</RelTime></x>')).toEqual({
      positionSec: 0,
      durationSec: 0,
    });
  });
});

describe('parseGetTransportInfo', () => {
  it('归一化传输状态', () => {
    expect(parseGetTransportInfo('<x><CurrentTransportState>PLAYING</CurrentTransportState></x>')).toBe('PLAYING');
    expect(parseGetTransportInfo('<x><CurrentTransportState>PAUSED_PLAYBACK</CurrentTransportState></x>')).toBe(
      'PAUSED_PLAYBACK'
    );
    expect(parseGetTransportInfo('<x><CurrentTransportState>WHATEVER</CurrentTransportState></x>')).toBe('UNKNOWN');
    expect(parseGetTransportInfo('<x></x>')).toBe('UNKNOWN');
  });
});

describe('buildDidlMetadata', () => {
  it('标题与地址做 XML 转义，直播用 broadcast class', () => {
    const vod = buildDidlMetadata('电影<上>"集"&插曲', 'http://cdn/a.m3u8?a=1&b=2', false);
    expect(vod).toContain('<dc:title>电影&lt;上&gt;&quot;集&quot;&amp;插曲</dc:title>');
    expect(vod).toContain('<res>http://cdn/a.m3u8?a=1&amp;b=2</res>');
    expect(vod).toContain('object.item.videoItem');

    const live = buildDidlMetadata('CCTV-1', 'http://cdn/live.m3u8', true);
    expect(live).toContain('object.item.videoItem.broadcast');
  });
});

describe('parseDeviceDescription', () => {
  const BASE = 'http://192.168.1.5:49152/description.xml';

  const SAMPLE = `<?xml version="1.0"?>
  <root xmlns="urn:schemas-upnp-org:device-1-0">
    <specVersion><major>1</major><minor>0</minor></specVersion>
    <device>
      <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
      <friendlyName> living-room TV &#x5ba2;&#x5385; </friendlyName>
      <UDN>uuid:abcd-1234</UDN>
      <serviceList>
        <service>
          <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
          <controlURL>/upnp/control/render</controlURL>
        </service>
        <service>
          <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
          <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
          <controlURL>/upnp/control/avtransport</controlURL>
        </service>
      </serviceList>
    </device>
  </root>`;

  it('解析友好名与 AVTransport 控制地址（相对路径按描述地址解析）', () => {
    const parsed = parseDeviceDescription(SAMPLE, BASE);
    expect(parsed).toEqual({
      name: 'living-room TV 客厅',
      controlUrl: 'http://192.168.1.5:49152/upnp/control/avtransport',
    });
  });

  it('URLBase 存在时按其解析相对控制地址', () => {
    const withBase = SAMPLE.replace('<specVersion>', '<URLBase>http://192.168.1.5:8080/</URLBase><specVersion>');
    const parsed = parseDeviceDescription(withBase, BASE);
    expect(parsed?.controlUrl).toBe('http://192.168.1.5:8080/upnp/control/avtransport');
  });

  it('无 AVTransport 服务的设备（MediaServer）返回 null', () => {
    const server = SAMPLE.replace('AVTransport:1</serviceType>', 'ContentDirectory:1</serviceType>');
    expect(parseDeviceDescription(server, BASE)).toBeNull();
  });

  it('CDATA 与实体混合的 friendlyName 可解码', () => {
    const cdata = SAMPLE.replace(
      '<friendlyName> living-room TV &#x5ba2;&#x5385; </friendlyName>',
      '<friendlyName><![CDATA[小米电视 & 主卧]]></friendlyName>'
    );
    expect(parseDeviceDescription(cdata, BASE)?.name).toBe('小米电视 & 主卧');
  });

  it('decodeXmlEntities 处理数字实体与基础实体', () => {
    expect(decodeXmlEntities('A&amp;B&lt;C&#x41;&#66;')).toBe('A&B<CAB');
  });
});
