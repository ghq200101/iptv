import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { LOCAL_CHANNELS, buildLocalChannels, clearLocalCache, fetchLocalChannels } from '../extractors/qinghai/local.js'

// 按 2026-10-27 两家 Apphome/home 的真实响应裁剪，保留格尔木目录里的重复省台。
const [geermu, haidong] = LOCAL_CHANNELS
const fixtures = {
  'https://grmapp.geermurmt.cn/tenma01ds_tvradio/Apphome/home?channel_id=&channel_type=1': {
    code: 200, data: { channel_info: [{
      id: 1, name: '新闻综合', channel_type: 1, stream_key: 'xwzh',
      m3u8: 'https://miku-live-hls-gemwkl-tv.geermurmt.cn/gemwkl-tv/xwzh.m3u8?sign=bd290c67d513b07aa49842b8aedd02c2&t=1876791311',
      mark_img: 'https://grmapposs.geermurmt.cn/tianma/2025/03/10/F8A59614F311CC949AC87C94E38479DC.png',
    }, {
    id: 2, name: '青海卫视', channel_type: 1, stream_key: 'qhws',
    m3u8: 'https://miku-live-hls-gemwkl-tv.geermurmt.cn/gemwkl-tv/qhws.m3u8?sign=6fbabf88b2f910606c60257f9221c230&t=1876791161',
  }], programs: [{ time_str: '10月27日', program: [{ program_name: '当日回放', start_time: 1793030400, end_time: 1793116799 }] }] }, tmencrypt: 0 },
  'https://hdapp.hdhhy.cn/tenma01ds_tvradio/Apphome/home?channel_id=&channel_type=1': {
    code: 200, data: { channel_info: [{
      id: 1, name: '海东综合频道', channel_type: 1, stream_key: 'zhds',
      m3u8: 'https://hls-hdapp.hdhhy.cn/ashh-tv/zhds.m3u8?sign=26c873e6e3d94ba02aa78c0fbf326dfd&t=1886228277',
      mark_img: 'https://oss.hdhhy.cn/tianma/2026/04/13/DF88CA87DD141DE0AB94417FFDE17615.png',
    }] }, tmencrypt: 0 },
}
const fresh = source => new URL(source.fallbackUrl)
function renewed(source, sign, timestamp) {
  const url = fresh(source)
  url.searchParams.set('sign', sign)
  url.searchParams.set('t', timestamp)
  return url.href
}
function reply(api, update = {}) {
  const value = structuredClone(fixtures[String(api)])
  Object.assign(value.data.channel_info[0], update)
  return Response.json(value)
}
beforeEach(clearLocalCache)

test('快照与官方目录均为两路青海地方直链，不把重复省台、占位节目单变成新频道', async () => {
  const snapshot = buildLocalChannels()
  const result = await fetchLocalChannels({ fetchImpl: async (api, options) => {
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    assert.ok(Object.hasOwn(fixtures, String(api)))
    return reply(api)
  } })
  assert.deepEqual(result.channels, snapshot)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.channels.map(x => x.name), ['格尔木新闻综合', '海东综合频道'])
  for (const item of result.channels) {
    assert.equal(item.groupTitle, '青海')
    assert.equal(item.catchup, 'none')
    assert.equal(item.supersedesFeatured, true)
    assert.equal(item.deferredRef, undefined)
    assert.equal(item.relayHls, undefined)
    assert.equal(item.proxyHls, undefined)
    assert.equal(item.epg, undefined)
    assert.deepEqual(item.opts, ['network-caching=3000'])
  }
})

test('签名更新原样采用，单路失败保留该台上次成功值，另一路继续刷新', async () => {
  const firstUrl = renewed(geermu, 'a'.repeat(32), '1876791400')
  const nextUrl = renewed(haidong, 'b'.repeat(32), '1886228400')
  await fetchLocalChannels({ fetchImpl: async api => reply(api, api === geermu.api ? { m3u8: firstUrl } : {}) })
  const result = await fetchLocalChannels({ fetchImpl: async api => {
    if (api === geermu.api) throw new Error(`upstream failed ${firstUrl}`)
    return reply(api, { m3u8: nextUrl })
  } })
  assert.deepEqual(result.channels.map(x => x.url), [firstUrl, nextUrl])
  assert.deepEqual(result.channels.map(x => x.name), ['格尔木新闻综合', '海东综合频道'])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /格尔木.*上次成功地址/)
  assert.doesNotMatch(result.warnings[0], /https?:|sign=|1876791400|aaaaaaaa/)
})

test('首次目录异常使用已验证快照，超时也不影响另一台', async () => {
  const result = await fetchLocalChannels({ timeoutMs: 5, fetchImpl: (api, { signal }) => {
    if (api === haidong.api) return Promise.resolve(reply(api))
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  assert.deepEqual(result.channels, buildLocalChannels())
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /格尔木.*已验证地址快照/)
})

test('拒绝目录中的外域、同域其它频道、用户信息、非 HTTPS、重定向和错误身份', async () => {
  const badRows = [
    { m3u8: 'https://127.0.0.1/private.m3u8' },
    { m3u8: 'http://miku-live-hls-gemwkl-tv.geermurmt.cn/gemwkl-tv/xwzh.m3u8' },
    { m3u8: 'https://miku-live-hls-gemwkl-tv.geermurmt.cn/gemwkl-tv/qhws.m3u8' },
    { m3u8: 'https://user:pass@miku-live-hls-gemwkl-tv.geermurmt.cn/gemwkl-tv/xwzh.m3u8' },
    { m3u8: 'https://miku-live-hls-gemwkl-tv.geermurmt.cn:8443/gemwkl-tv/xwzh.m3u8' },
    { stream_key: 'qhws' }, { channel_type: 2 }, { name: '青海卫视' }, { id: 2 },
  ]
  for (const bad of badRows) {
    const result = await fetchLocalChannels({ fetchImpl: async api => reply(api, api === geermu.api ? bad : {}) })
    assert.equal(result.channels[0].url, geermu.fallbackUrl)
    assert.equal(result.channels[1].url, haidong.fallbackUrl)
    assert.equal(result.warnings.length, 1)
  }
  const redirected = await fetchLocalChannels({ fetchImpl: async api => api === geermu.api
    ? new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } }) : reply(api) })
  assert.equal(redirected.channels[0].url, geermu.fallbackUrl)
  assert.match(redirected.warnings[0], /HTTP 302/)
})

test('官方台标错误时保持已验证图标，新直播地址仍生效', async () => {
  const url = renewed(haidong, 'c'.repeat(32), '1886228500')
  const result = await fetchLocalChannels({ fetchImpl: async api => reply(api,
    api === haidong.api ? { m3u8: url, mark_img: 'https://evil.example/wrong-logo.png' } : {}) })
  assert.equal(result.channels[1].url, url)
  assert.equal(result.channels[1].logo, haidong.fallbackLogo)
  assert.deepEqual(result.warnings, [])
})

test('响应无长度头仍限制为 1 MiB，异常 JSON 和加密响应不会污染地址缓存', async () => {
  let cancelled = false
  const huge = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)) },
    cancel() { cancelled = true },
  }))
  for (const response of [huge, new Response('{'), Response.json({ code: 200, data: 'encrypted', tmencrypt: 1 })]) {
    const result = await fetchLocalChannels({ fetchImpl: async api => api === geermu.api ? response : reply(api) })
    assert.equal(result.channels[0].url, geermu.fallbackUrl)
    assert.equal(result.warnings.length, 1)
  }
  assert.equal(cancelled, true)
})
