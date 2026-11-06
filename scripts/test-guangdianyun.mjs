#!/usr/bin/env node
/**
 * 广电云市县台回归测试：MQTT 上线包与 PHP 原版逐字节一致、刷新只收 liveStatus=1、
 * 播放时先上线再取地址、会话复用与保活、清单 403 换 clientId 重来、404 当停推、
 * 没人看自动断开。接口与 WebSocket 都用假实现，响应按 2026-10-24 真实返回裁剪。
 *
 * 运行： node scripts/test-guangdianyun.mjs
 */
import assert from 'node:assert/strict'

import gdyModules, { buildGroups } from '../extractors/guangdianyun/index.js'
import { CHANNELS, CHANNEL_BY_REF, GROUPS, PROVINCE_IDS, SLOW_GROUP } from '../extractors/guangdianyun/channels.js'
import {
  API_BASE, MQTT_PINGREQ, MQTT_WS, STATS_WS, checkLive, connackVerdict, createResolver, mqttConnectPacket,
} from '../extractors/guangdianyun/api.js'
import { getModule, listModules, moduleRegion, resolverFor } from '../extractors/registry.js'

const henan = getModule('guangdianyun-henan')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ✅ ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ✅ ${name}`) }
const tick = () => new Promise(resolve => setImmediate(resolve))

const LIUZHOU = CHANNEL_BY_REF.get('gdy-1902-3370')
const SUB_KEY = 'sub_aba57c979af8f05e1664fc8d30778290'
const HLS = 'http://47447-live.hlsplay.aodianyun.com/tv_radio_47447/tv_channel_1902.m3u8?auth_key=1792904108-0-0-7ca9&extra_key=EfZs'
const MANIFEST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:341952\n#EXT-X-TARGETDURATION:3\n'
  + '#EXTINF:3.000,\n47447.hlsplay.aodianyun.com_tv_channel_1902-1792818580088.ts?auth_key=1792904998-0-0-ab\n'

const info = (liveStatus = 1, extra = {}) => ({
  code: 200, errorCode: 0, errMessage: '',
  data: { id: 1902, name: '柳州新闻综合频道', uin: 3370, liveStatus, sub_key: SUB_KEY, logoUrl: '', ...extra },
})
const json = body => ({ ok: true, status: 200, url: '', json: async () => body, text: async () => JSON.stringify(body) })
const text = (status, body, url = HLS) => ({ ok: status === 200, status, url, text: async () => body, json: async () => JSON.parse(body) })

/** 假 WebSocket：统计连接回 OK，MQTT 回 CONNACK；记下发出的每一包 */
function fakeSockets({ connackCode = 0, statsReply = 'OK' } = {}) {
  const sockets = []
  class FakeWebSocket {
    constructor(url, options = {}) {
      this.url = url
      this.options = options
      this.sent = []
      this.closed = false
      sockets.push(this)
      setImmediate(() => this.onopen?.())
    }
    send(data) {
      if (this.closed) throw new Error('closed')
      this.sent.push(data)
      if (this.sent.length > 1) return
      setImmediate(() => {
        if (this.url === STATS_WS) this.onmessage?.({ data: statsReply })
        else this.onmessage?.({ data: new Uint8Array([0x20, 0x02, 0x00, connackCode]).buffer })
      })
    }
    close() { this.closed = true }
  }
  return { sockets, FakeWebSocket }
}

function harness({ manifests = [], liveStatus = 1, connackCode = 0 } = {}) {
  const calls = []
  const { sockets, FakeWebSocket } = fakeSockets({ connackCode })
  let clock = Date.parse('2026-10-24T05:00:00Z')
  let timerFn = null
  let cleared = 0
  const queue = [...manifests]
  const fetchImpl = async url => {
    calls.push(url)
    if (url.startsWith(`${API_BASE}/channelInfo`)) return json(info(liveStatus))
    if (url.startsWith(`${API_BASE}/getPlayAddress`)) {
      const clientId = new URL(url).searchParams.get('clientId')
      return json({ code: 200, errorCode: 0, data: { hlsUrl: `${HLS}&cid=${clientId}` }, errMessage: '' })
    }
    const next = queue.length > 1 ? queue.shift() : (queue[0] ?? [200, MANIFEST])
    return text(next[0], next[1], url)
  }
  const resolver = createResolver({
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
    dispatcher: () => undefined,
    now: () => clock,
    setTimer: fn => { timerFn = fn; return { unref() {} } },
    clearTimer: () => { cleared++; timerFn = null },
  })
  return {
    resolver, calls, sockets,
    advance: ms => { clock += ms },
    fire: () => timerFn?.(),
    hasTimer: () => timerFn != null,
    cleared: () => cleared,
  }
}

console.log('广电云市县台')

check('MQTT 上线包与群友 PHP 拼的十六进制逐字节一致', () => {
  const uuid = '54289a2c-5916-4af1-a390-3961651acea7'
  const hex = s => Buffer.from(s, 'utf8').toString('hex')
  const php = '105800044d51545404c2003c0024' + hex(uuid) + '00000024' + hex(SUB_KEY)
  assert.equal(mqttConnectPacket(uuid, SUB_KEY).toString('hex'), php)
  assert.deepEqual([...MQTT_PINGREQ], [0xc0, 0x00])
})

check('CONNACK：返回码 0 才算上线，别的码报拒绝，不是 CONNACK 的包先不下结论', () => {
  assert.equal(connackVerdict(new Uint8Array([0x20, 2, 0, 0]).buffer), true)
  assert.match(connackVerdict(new Uint8Array([0x20, 2, 0, 5]).buffer), /拒绝连接（5）/)
  assert.equal(connackVerdict(new Uint8Array([0x90, 3, 0, 1, 0]).buffer), undefined)
})

check('频道表：引用唯一；电视台按省归组，慢直播统一一组排最后；排除的活动间、备线不在表里', () => {
  assert.equal(new Set(CHANNELS.map(row => row.ref)).size, CHANNELS.length)
  assert.equal(new Set(CHANNELS.map(row => row.name)).size, CHANNELS.length)
  for (const row of CHANNELS) {
    assert.match(row.ref, /^gdy-\d+-\d+$/)
    assert.ok(row.province && row.name && row.rawName, row.ref)
    const expected = row.group === SLOW_GROUP ? SLOW_GROUP : row.city ? `${row.province}-${row.city}` : row.province
    assert.equal(row.group, expected, row.ref)
    if (row.group === SLOW_GROUP) assert.equal(row.logo, undefined, `${row.ref} 慢直播不配台标`)
    if (row.logo) assert.match(row.logo, /^https:\/\/static-pro\.guangdianyun\.tv\/\d+\/program\//)
  }
  assert.equal(GROUPS.at(-1), SLOW_GROUP)
  assert.equal(GROUPS.filter(group => group === SLOW_GROUP).length, 1)
  // 直播黄石（3071）这类以后可以挪进慢直播，目前不收；各台备线、转播央视、测试间不收
  for (const excluded of ['gdy-1725-1632', 'gdy-1726-1632', 'gdy-3071-3065', 'gdy-803-1610', 'gdy-1933-3277', 'gdy-3780-1167',
    'gdy-808-1610', 'gdy-902-1610', 'gdy-2179-2656', 'gdy-3953-4736', 'gdy-3408-1723', 'gdy-3863-4206']) {
    assert.equal(CHANNEL_BY_REF.has(excluded), false, excluded)
  }
  assert.equal(CHANNEL_BY_REF.get('gdy-170-1356').name, '乐清综合')
  assert.equal(CHANNEL_BY_REF.get('gdy-171-1356').name, '乐清新闻')
  assert.equal(CHANNEL_BY_REF.get('gdy-3706-4436').group, '河南')
  // 山东三台跟山东市县模块的地市分组走
  assert.equal(CHANNEL_BY_REF.get('gdy-2308-3185').group, '山东-淄博')
  assert.equal(CHANNEL_BY_REF.get('gdy-3492-4042').group, '山东-菏泽')
  assert.equal(CHANNEL_BY_REF.get('gdy-3493-4042').group, '山东-菏泽')
  assert.ok(!GROUPS.includes('山东'))
  assert.equal(CHANNEL_BY_REF.get('gdy-3900-3744').group, SLOW_GROUP)
})

await checkAsync('刷新：只收 liveStatus=1；被删的和停推的跳过；没查到的照留', async () => {
  const sample = ['gdy-1902-3370', 'gdy-142-1081', 'gdy-3031-3065', 'gdy-2778-1610'].map(ref => CHANNEL_BY_REF.get(ref))
  const fetchImpl = async url => {
    const id = new URL(url).searchParams.get('id')
    if (id === '142') return json(info(0))
    if (id === '3031') return json({ code: 200, errorCode: 1, data: '', errMessage: '直播间不存在' })
    if (id === '2778') throw new Error('ECONNRESET')
    return json(info(1))
  }
  const results = await checkLive(sample, { fetchImpl })
  assert.deepEqual(results.map(item => item.state), ['live', 'offline', 'gone', 'unknown'])
  const groups = buildGroups(results)
  assert.deepEqual(groups.map(group => group.name), ['江苏', '广西'])
  const withSlow = buildGroups([...results, { channel: CHANNEL_BY_REF.get('gdy-3900-3744'), state: 'live' }])
  assert.deepEqual(withSlow.map(group => group.name), ['江苏', '广西', SLOW_GROUP])
  assert.equal(withSlow.at(-1).dataList[0].name, '许昌春水桥')
  // 只有地市分组里的市台打头，其余频道不带 leading
  const zibo = buildGroups([{ channel: CHANNEL_BY_REF.get('gdy-2308-3185'), state: 'live' }, ...results])
  assert.equal(zibo.find(group => group.name === '山东-淄博').dataList[0].leading, true)
  assert.equal(groups[1].dataList[0].leading, undefined)
  const liuzhou = groups[1].dataList[0]
  assert.equal(liuzhou.deferredRef, 'gdy-1902-3370')
  assert.equal(liuzhou.relayHls, true)
  assert.equal(liuzhou.catchup, 'none')
})

await checkAsync('刷新：全部查不到时报错，让上一轮的频道表留着', async () => {
  await assert.rejects(henan.fetch({}, { fetchImpl: async () => { throw new Error('offline') } }), /请求失败/)
})

await checkAsync('刷新：停推的台进 skipped，恢复推流后下一轮回到播放列表', async () => {
  let live = 0
  const fetchImpl = async url => json(info(new URL(url).searchParams.get('id') === '142' ? live : 1))
  const first = await henan.fetch({}, { fetchImpl })
  const names = result => result.groups.flatMap(group => group.dataList.map(channel => channel.name))
  assert.equal(names(first).includes('南阳新闻综合'), false)
  assert.ok(first.meta.skipped.includes('南阳新闻综合：台方当前没有推流'))
  live = 1
  const second = await henan.fetch({}, { fetchImpl })
  assert.ok(names(second).includes('南阳新闻综合'))
  assert.equal(second.meta.skipped.length, 0)
})

await checkAsync('播放：先让 clientId 上线（心跳 + MQTT）再取地址，清单交给本机中继', async () => {
  const h = harness()
  const result = await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(result.relayHls, true)
  assert.equal(result.manifestText, MANIFEST)
  assert.equal(h.sockets.length, 2)
  const stats = h.sockets.find(socket => socket.url === STATS_WS)
  const mqtt = h.sockets.find(socket => socket.url === MQTT_WS)
  assert.deepEqual(mqtt.options.protocols, ['mqtt'])
  const hello = JSON.parse(stats.sent[0])
  assert.equal(hello.msg, 'first')
  assert.equal(hello.id, 1902)
  assert.equal(hello.uin, 3370)
  const uuid = hello.uuid
  assert.equal(Buffer.from(mqtt.sent[0]).toString('hex'), mqttConnectPacket(uuid, SUB_KEY).toString('hex'))
  const address = h.calls.find(url => url.includes('/getPlayAddress'))
  assert.equal(new URL(address).searchParams.get('clientId'), uuid)
  // 两条连接都确认上线之后才取地址
  assert.ok(h.calls.indexOf(address) > h.calls.findIndex(url => url.includes('/channelInfo')))
  assert.match(result.url, new RegExp(`cid=${uuid}$`))
})

await checkAsync('播放：同一台的后续轮询复用会话，不再新开连接；保活每轮各发一次', async () => {
  const h = harness()
  await h.resolver.resolve(LIUZHOU.ref)
  await h.resolver.resolve(LIUZHOU.ref)
  await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(h.sockets.length, 2)
  assert.equal(h.calls.filter(url => url.includes('/getPlayAddress')).length, 1)
  h.advance(25000)
  h.fire()
  const [stats, mqtt] = [h.sockets.find(s => s.url === STATS_WS), h.sockets.find(s => s.url === MQTT_WS)]
  assert.equal(JSON.parse(stats.sent.at(-1)).msg, '')
  assert.deepEqual([...mqtt.sent.at(-1)], [0xc0, 0x00])
})

await checkAsync('播放：清单 403（会话失效）换一个 clientId 重新上线，只重试一次', async () => {
  const h = harness({ manifests: [[403, '<html>403</html>'], [200, MANIFEST]] })
  const result = await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(result.manifestText, MANIFEST)
  assert.equal(h.sockets.length, 4)
  assert.ok(h.sockets.slice(0, 2).every(socket => socket.closed), '旧会话的两条连接要关掉')
  const ids = h.calls.filter(url => url.includes('/getPlayAddress')).map(url => new URL(url).searchParams.get('clientId'))
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
})

await checkAsync('播放：清单 404（台方停推）不反复重连，报没有推流并关掉会话', async () => {
  const h = harness({ manifests: [[404, 'stream not found']] })
  const result = await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(result.url, '')
  assert.match(result.desc, /当前没有推流/)
  assert.equal(h.sockets.length, 2)
  assert.ok(h.sockets.every(socket => socket.closed))
  assert.equal(h.resolver.sessionCount(), 0)
  // 冷却期内播放器的连环重试不打上游
  const again = await h.resolver.resolve(LIUZHOU.ref)
  assert.match(again.desc, /当前没有推流/)
  assert.equal(h.sockets.length, 2)
})

await checkAsync('播放：channelInfo 说未开播就不建会话', async () => {
  const h = harness({ liveStatus: 0 })
  const result = await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(result.url, '')
  assert.match(result.desc, /当前未开播/)
  assert.equal(h.sockets.length, 0)
})

await checkAsync('播放：MQTT 拒绝上线时两条连接都关掉，不去取地址', async () => {
  const h = harness({ connackCode: 4 })
  const result = await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(result.url, '')
  assert.match(result.desc, /拒绝连接/)
  await tick()
  assert.ok(h.sockets.every(socket => socket.closed))
  assert.equal(h.calls.some(url => url.includes('/getPlayAddress')), false)
})

await checkAsync('没人看了：空闲超过一分半关掉两条连接，定时器跟着停；再播重新上线', async () => {
  const h = harness()
  await h.resolver.resolve(LIUZHOU.ref)
  h.advance(60000)
  h.fire()
  assert.equal(h.resolver.sessionCount(), 1)
  h.advance(31000)
  h.fire()
  assert.equal(h.resolver.sessionCount(), 0)
  assert.ok(h.sockets.every(socket => socket.closed))
  assert.equal(h.hasTimer(), false)
  await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(h.sockets.length, 4)
  assert.equal(h.hasTimer(), true)
})

await checkAsync('平台主动断开任一条连接，会话作废，下次播放重新上线', async () => {
  const h = harness()
  await h.resolver.resolve(LIUZHOU.ref)
  h.sockets.find(socket => socket.url === MQTT_WS).onclose()
  assert.equal(h.resolver.sessionCount(), 0)
  await h.resolver.resolve(LIUZHOU.ref)
  assert.equal(h.sockets.length, 4)
})

await checkAsync('同一台同时来的几个请求只建一个会话', async () => {
  const h = harness()
  const results = await Promise.all([1, 2, 3].map(() => h.resolver.resolve(LIUZHOU.ref)))
  assert.ok(results.every(result => result.manifestText === MANIFEST))
  assert.equal(h.sockets.length, 2)
})

await checkAsync('resolve 不抛异常：引用无效、接口异常都回中文原因', async () => {
  const h = harness()
  assert.match((await h.resolver.resolve('gdy-1-1')).desc, /引用无效/)
  const broken = createResolver({ fetchImpl: async () => { throw new Error('boom') }, WebSocketImpl: class {}, dispatcher: () => undefined })
  const result = await broken.resolve(LIUZHOU.ref)
  assert.equal(result.url, '')
  assert.match(result.desc, /广电云/)
})

check('按省拆成 20 个模块：各进对应省面板、按引用各认各的、不暴露配置项', () => {
  assert.equal(getModule('guangdianyun'), undefined)
  const provinces = [...new Set(CHANNELS.map(row => row.province))]
  assert.deepEqual(Object.keys(PROVINCE_IDS), provinces, '每个省都要有模块 id，顺序同频道表')
  const modules = listModules().filter(module => module.id.startsWith('guangdianyun-'))
  assert.deepEqual(modules.map(module => module.id), gdyModules.map(module => module.id))
  assert.equal(modules.length, 20)
  for (const module of modules) {
    const province = module.region
    assert.equal(module.id, `guangdianyun-${PROVINCE_IDS[province]}`)
    assert.equal(module.name, `市县台·${province}`)
    assert.equal(moduleRegion(module), province)
    assert.equal(module.category, undefined)
    assert.equal(module.catalogVersion, 1)
    assert.equal(module.defaultEnabled, false, `${module.id} 默认关闭`)
    assert.equal(module.capabilities.resolve, true)
    assert.equal(module.capabilities.epg, true)
    assert.equal(module.capabilities.catchup, false)
    assert.deepEqual(module.configSchema, [])
    assert.equal(module.refreshConfigurable, false)
    // 节目单只列本省电视台，慢直播没有节目单，不去问
    const epg = module.epg.channels()
    assert.ok(epg.length > 0, module.id)
    assert.ok(epg.every(item => CHANNEL_BY_REF.get(item.ref).province === province && CHANNEL_BY_REF.get(item.ref).group !== SLOW_GROUP))
  }
  // 每个频道恰好归一个模块
  for (const row of CHANNELS) {
    const owners = modules.filter(module => module.claimsRef(row.ref))
    assert.deepEqual(owners.map(module => module.id), [`guangdianyun-${PROVINCE_IDS[row.province]}`], row.ref)
  }
  assert.equal(resolverFor('gdy-1902-3370')?.id, 'guangdianyun-guangxi')
  assert.equal(resolverFor('gdy-2308-3185')?.id, 'guangdianyun-shandong')
  assert.equal(resolverFor('gdy-3900-3744')?.id, 'guangdianyun-henan', '慢直播跟着所属台的省份模块走')
  assert.equal(resolverFor('gdy-1-1'), null)
})

await checkAsync('省份模块的输出只含本省：电视台进省（或省-市）分组，慢直播进「慢直播」', async () => {
  const live = async () => json(info(1))
  const result = await henan.fetch({}, { fetchImpl: live })
  assert.deepEqual(result.groups.map(group => group.name), ['河南', SLOW_GROUP])
  assert.ok(result.groups[1].dataList.every(channel => CHANNEL_BY_REF.get(channel.deferredRef).province === '河南'))
  const shandong = await getModule('guangdianyun-shandong').fetch({}, { fetchImpl: live })
  assert.deepEqual(shandong.groups.map(group => group.name), ['山东-淄博', '山东-菏泽'])
})

await checkAsync('只清一个省的缓存时，别的省正在播的会话不断', async () => {
  const h = harness()
  const liuzhou = CHANNEL_BY_REF.get('gdy-1902-3370')
  const huangshi = CHANNEL_BY_REF.get('gdy-3031-3065')
  await h.resolver.resolve(liuzhou.ref)
  await h.resolver.resolve(huangshi.ref)
  assert.equal(h.resolver.sessionCount(), 2)
  h.resolver.clear(ref => CHANNEL_BY_REF.get(ref)?.province === '湖北')
  assert.equal(h.resolver.sessionCount(), 1)
  assert.ok(h.sockets.slice(0, 2).every(socket => !socket.closed), '广西的两条连接还开着')
  h.resolver.clear()
  assert.equal(h.resolver.sessionCount(), 0)
})

for (const module of gdyModules) module.clearResolveCache()
console.log(`\n${passed} 项通过`)
