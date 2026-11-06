/** 按 2026-10-28 官方响应裁剪；签名值为离线夹具。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import module from '../extractors/zhejiang-local/index.js'
import { CHANNELS, DETAIL_API, PLAY_API, createResolver, channelSign, officialManifestUrl, officialSegmentUrl, validateManifest } from '../extractors/zhejiang-local/api.js'
import { getModule, resolverFor } from '../extractors/registry.js'
import { inlineResolvedManifest } from '../utils/appUtils.js'

const channel = CHANNELS[0]
const host = 'play-sh13.quklive.com'
const manifestUrl = token => `https://${host}/live/${channel.id}.m3u8?auth_key=${token}`
const segment = token => `${host}_${channel.id}-1793195000000.ts?auth_key=${token}`
const playlist = token => `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:11\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.000,\n${segment(token)}\n`
const detail = () => ({ code: 0, value: { windowDetail: {
  sourceId: Number(channel.id), name: channel.rawName, programLive: 1, publish: 1,
  hidePlayer: 0, authType: 1, auth: { type: 2 }, watchFee: 0, watchFeeNew: 0,
} } })

function fixture({ token = 'a', metadata = detail(), control } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(url)
    assert.equal(init.redirect, 'manual')
    if (url.startsWith(DETAIL_API + '?')) return Response.json(metadata)
    if (url === PLAY_API) {
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('sign'), channelSign(channel.id))
      assert.equal(body.get('liveId'), channel.id)
      return Response.json(control || { code: 0, value: { playState: 0, playCopyright: null, url: manifestUrl(token) } })
    }
    assert.equal(url, manifestUrl(token))
    return new Response(playlist(token))
  }
  return { calls, fetchImpl }
}

test('三路注册到浙江，目录不带短效地址，支持标准全代理播放', async () => {
  assert.equal(getModule(module.id), module)
  assert.equal(module.outputGroupName, '浙江')
  assert.equal(module.channelHlsMode, 'proxy')
  assert.equal(module.capabilities.epg, false)
  const { groups } = await module.fetch()
  assert.deepEqual(groups[0].dataList.map(row => row.name), ['东阳新闻综合', '衢江综合', '江山电视一套'])
  for (const row of groups[0].dataList) {
    assert.equal(resolverFor(row.deferredRef), module)
    assert.equal(row.url, undefined)
    assert.equal(row.catchup, 'none')
  }
  assert.equal(resolverFor(channel.ref + '/extra'), null)
})

test('每次播放重新核对身份与播控并取新签名，相对分片用于中继/代理时地址正确', async () => {
  const first = fixture()
  const resolver = createResolver({ fetchImpl: first.fetchImpl })
  const resolved = await resolver.resolve(channel.ref)
  assert.equal(resolved.url, manifestUrl('a'))
  assert.equal(first.calls.length, 3)
  const absolute = `https://${host}/live/${segment('a')}`
  assert.ok(inlineResolvedManifest(resolved).includes(absolute))
  assert.equal(resolved.upstreamUrlTransform(absolute), absolute)
  const second = fixture({ token: 'b' })
  assert.equal((await resolver.resolve(channel.ref, { fetchImpl: second.fetchImpl })).url, manifestUrl('b'))
  assert.equal(second.calls.length, 3)
})

test('只接受当前频道的签名清单和分片，拒绝其他主机、端口和媒体结构', () => {
  assert.equal(officialManifestUrl(manifestUrl('a'), channel), manifestUrl('a'))
  assert.equal(officialSegmentUrl(segment('a'), manifestUrl('a'), channel), `https://${host}/live/${segment('a')}`)
  const alias = `https://hls.quklive.com/live/${host}/${channel.id}.m3u8?auth_key=a`
  assert.equal(officialSegmentUrl(segment('a'), alias, channel), `https://${host}/live/${segment('a')}`)
  for (const bad of [manifestUrl('a').replace(channel.id, CHANNELS[1].id), manifestUrl('a').replace(host, 'evil.example'), manifestUrl('a').replace('?auth_key=a', ''), manifestUrl('a').replace(host, host + ':444')]) {
    assert.throws(() => officialManifestUrl(bad, channel))
  }
  assert.throws(() => officialSegmentUrl(`https://evil.example/${segment('a')}`, manifestUrl('a'), channel))
  assert.throws(() => officialSegmentUrl(segment('a').replace(channel.id, CHANNELS[1].id), manifestUrl('a'), channel))
  for (const tag of ['#EXT-X-ENDLIST', '#EXT-X-KEY:METHOD=AES-128', '#EXT-X-MAP:URI="init.mp4"', '#EXT-X-STREAM-INF:BANDWIDTH=100']) {
    assert.throws(() => validateManifest(playlist('a') + tag, manifestUrl('a'), channel))
  }
})

test('官方停用、改名、付费或登录要求出现时拒绝取流且不删除目录', async () => {
  for (const patch of [{ publish: 0 }, { programLive: 0 }, { name: '测试活动' }, { sourceId: 1 }, { hidePlayer: 1 }, { authType: 3 }, { auth: { type: 1 } }, { watchFee: 1 }, { forceThirdUserLogin: 1 }]) {
    const metadata = detail()
    Object.assign(metadata.value.windowDetail, patch)
    const f = fixture({ metadata })
    assert.equal((await createResolver(f).resolve(channel.ref)).url, '')
    assert.equal(f.calls.length, 1)
  }
  assert.equal((await module.fetch()).groups[0].dataList.length, 3)
  // 江山公开播放器带 doInvitation=1，但正式访问权限仍为 authType=1 / auth.type=2。
  const metadata = detail()
  metadata.value.windowDetail.doInvitation = 1
  assert.equal((await createResolver(fixture({ metadata })).resolve(channel.ref)).url, manifestUrl('a'))
})

test('尊重官方当前时段播控，异常和非法引用返回错误且不泄漏签名', async () => {
  for (const value of [{ playState: 2, url: manifestUrl('a') }, { playState: 0, playCopyright: 2, url: manifestUrl('a') }]) {
    const result = await createResolver(fixture({ control: { code: 0, value } })).resolve(channel.ref)
    assert.equal(result.url, '')
    assert.ok(!result.desc.includes('auth_key'))
  }
  const resolver = createResolver({ fetchImpl: async () => { throw new Error('https://example.invalid/?auth_key=secret') } })
  assert.equal((await resolver.resolve('other')).url, '')
  const result = await resolver.resolve(channel.ref)
  assert.equal(result.url, '')
  assert.ok(!result.desc.includes('secret'))
})
