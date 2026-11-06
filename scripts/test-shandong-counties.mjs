#!/usr/bin/env node
/**
 * 山东市县台回归测试：频道表（台名补地名、排除的广播 / 慢直播 / 德州转发不在表里）、接口解析
 * （只认图片当台标）、刷新只收主清单取得到的、停推 / 被撤 / 接口没取到分开报、台标的 noLogo 与
 * logoFrom、按地市分组且只写固定 ref（地址的 k / t 每次都换，写进去频道主键就跟着变）、
 * 播放时按机构缓存给当前地址、整轮接口都失败时报错保留上一轮。接口用假实现，响应按
 * 2026-10-24 真实返回裁剪。
 *
 * 运行： node scripts/test-shandong-counties.mjs
 */
import assert from 'node:assert/strict'

import sd, { buildGroups } from '../extractors/shandong-counties/index.js'
import { CHANNELS, CHANNEL_BY_KEY, CITY_NAMES } from '../extractors/shandong-counties/channels.js'
import { API_BASE, checkChannels, createResolver, isLive, parseOrg } from '../extractors/shandong-counties/api.js'
import { getModule, resolverFor } from '../extractors/registry.js'
import { buildChannelId } from '../utils/playlistConfig.js'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ✅ ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ✅ ${name}`) }

const DONGYING_NEWS = 'https://alivealone302.litenews.cn/537/202304_1651887564107485184/playlist.m3u8?k=82690c8355e0c40b0511b38dfb1cc182&t=1792830009'
const ok = data => ({ code: 1, data, errmsg: '', score: {}, t: 3.5, s: 'new' })
const ORGS = {
  537: ok([
    { name: '新闻综合', icon: 'https://img11.litenews.cn/537/2023/05/03/f582654a7005568a9ad9bbbe823a1022.png',
      logo: 'https://img11.litenews.cn/537/2025/09/22/1cc35a10c39141969abeaa0a4a748d2b.png', stream: DONGYING_NEWS, id: 1, state: 1, program: 1 },
    { name: '公共频道', icon: '', logo: '', stream: 'https://alivealone302.litenews.cn/537/202304_1651887564182982656/playlist.m3u8?k=ce37&t=1792829864', id: 3 },
  ]),
  181: ok([
    // 邹城综合的 icon 填成了 m3u8，不能当台标
    { name: '邹城综合频道', icon: 'https://elivealone302.litenews.cn/181/BpNavSc84bahjgR5rAN6d6FCKGh7sKJN/playlist.m3u8',
      stream: 'https://blivealone302.litenews.cn/b181/91db69c983c54a3b8271b434776cd554/index.m3u8?t=1792833600&k=7dee', id: 1 },
  ]),
  171: ok([
    { name: '长清综合', icon: 'https://img11.iqilu.com/171/2019/12/04/fd4b8088a20fee0fe02b46c31c91e87c.png', logo: null,
      stream: 'https://alivealone302.litenews.cn/171/16236930b5ef4329a8a1d47037ee56b6/playlist.m3u8?k=549b&t=1792829999', id: 2 },
    { name: '长清生活', icon: '', logo: '', stream: 'https://alivealone302.litenews.cn/171/b6df53d1f77f4e068055b4eac603bdcb/playlist.m3u8?k=3ba1&t=1792829999', id: 20 },
  ]),
  227: ok([
    { name: '综合频道', icon: 'https://img11.iqilu.com/227/2020/01/01/44f326106b1b7ff6d8f3520860754f6c.jpg',
      stream: 'https://alivealone302.litenews.cn/227/aaaa/playlist.m3u8?k=1&t=1', id: 1 },
  ]),
}
const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1, BANDWIDTH=3608000\nhttps://example.100ycdn.com/playlist.m3u8?wsBindIP=2\n'

function fakeFetch({ orgs = ORGS, dead = new Set(), failOrgs = new Set() } = {}) {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url.startsWith(`${API_BASE}/live?`)) {
      const org = Number(new URL(url).searchParams.get('orgid'))
      if (failOrgs.has(org)) throw new Error('ECONNRESET')
      const body = JSON.stringify(orgs[org] || ok([]))
      return { ok: true, status: 200, text: async () => body }
    }
    if (dead.has(url)) return { ok: false, status: 404, text: async () => '' }
    return { ok: true, status: 200, text: async () => MASTER }
  }
  return { fetchImpl, calls }
}

console.log('山东市县台')

check('频道表：编号与台名唯一，通用名都补了地名，排除项不在表里', () => {
  assert.equal(new Set(CHANNELS.map(row => row.key)).size, CHANNELS.length)
  assert.equal(new Set(CHANNELS.map(row => row.name)).size, CHANNELS.length)
  for (const row of CHANNELS) {
    assert.ok(row.city && row.name && row.rawName, row.key)
    assert.doesNotMatch(row.name, /^(综合|新闻综合|生活|公共)/, `${row.key} 台名要带地名`)
    if (row.name.endsWith('频道')) assert.ok(['济铁频道', '崂山频道', '李沧频道', '泰山频道'].includes(row.name), `${row.key} 去掉结尾的「频道」`)
    if (row.logoFrom) assert.match(row.logoFrom, /^\d+-\d+$/)
  }
  // 广播、慢直播、文化广场航拍、德州市台转发的县台、诸城转发的潍坊台、测试间
  for (const excluded of ['227-5', '221-58', '167-6', '113-66', '179-21', '179-9', '115-71', '115-130', '89-20', '217-10']) {
    assert.equal(CHANNEL_BY_KEY.has(excluded), false, excluded)
  }
  assert.equal(CHANNEL_BY_KEY.get('537-1').name, '东营新闻综合')
  assert.equal(CHANNEL_BY_KEY.get('101-1').name, '张店一套')
  assert.equal(CHANNEL_BY_KEY.get('101-1').rawName, 'ZDTV-1')
})

check('接口解析：logo 优先、没有再用 icon，只认图片地址，没地址的条目丢掉', () => {
  const dongying = parseOrg(ORGS[537])
  assert.equal(dongying.get(1).logo, 'https://img11.litenews.cn/537/2025/09/22/1cc35a10c39141969abeaa0a4a748d2b.png')
  assert.equal(dongying.get(1).stream, DONGYING_NEWS)
  assert.equal(dongying.get(3).logo, '')
  assert.equal(parseOrg(ORGS[181]).get(1).logo, '')
  assert.equal(parseOrg(ORGS[171]).get(2).logo, 'https://img11.iqilu.com/171/2019/12/04/fd4b8088a20fee0fe02b46c31c91e87c.png')
  assert.equal(parseOrg(ok([{ id: 9, name: '空', stream: '' }])).size, 0)
  assert.throws(() => parseOrg({ code: 0, data: '参数错误', errmsg: '参数错误' }), /接口拒绝：参数错误/)
})

await checkAsync('主清单：200 且是 HLS 才算在推流，404 和连不上都不算', async () => {
  const { fetchImpl } = fakeFetch({ dead: new Set(['https://dead/x.m3u8']) })
  assert.equal(await isLive(DONGYING_NEWS, { fetchImpl }), true)
  assert.equal(await isLive('https://dead/x.m3u8', { fetchImpl }), false)
  assert.equal(await isLive('https://x', { fetchImpl: async () => { throw new Error('timeout') } }), false)
  assert.equal(await isLive('https://x', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>' }) }), false)
})

await checkAsync('刷新：一个机构只请求一次；停推、被撤、接口没取到分开报', async () => {
  const sample = ['537-1', '537-3', '537-7', '181-1', '303-1'].map(key => CHANNEL_BY_KEY.get(key))
  const dead = new Set([ORGS[537].data[1].stream])
  const { fetchImpl, calls } = fakeFetch({ dead, failOrgs: new Set([303]) })
  const results = await checkChannels(sample, { fetchImpl })
  assert.deepEqual(results.map(item => item.state), ['live', 'offline', 'gone', 'live', 'unknown'])
  assert.equal(results[0].stream, DONGYING_NEWS)
  assert.equal(calls.filter(url => url.includes('orgid=537')).length, 1)
  assert.match(results[4].error, /ECONNRESET/)
})

await checkAsync('台标：noLogo 的不用接口图，logoFrom 借所属电视台的站标', async () => {
  const sample = [CHANNEL_BY_KEY.get('171-20'), CHANNEL_BY_KEY.get('227-1')]
  assert.equal(sample[0].logoFrom, '171-2')
  assert.equal(sample[1].noLogo, true)
  const results = await checkChannels(sample, fakeFetch())
  assert.equal(results[0].logo, 'https://img11.iqilu.com/171/2019/12/04/fd4b8088a20fee0fe02b46c31c91e87c.png')
  assert.equal(results[1].logo, '')
})

check('输出：按地市分组、只写在推流的台；写固定 ref 不写地址，不回看', () => {
  assert.equal(CITY_NAMES.length, 16)
  const groups = buildGroups([
    { channel: CHANNEL_BY_KEY.get('537-1'), state: 'live', stream: DONGYING_NEWS, logo: 'https://img/l.png' },
    { channel: CHANNEL_BY_KEY.get('537-3'), state: 'offline' },
    { channel: CHANNEL_BY_KEY.get('303-1'), state: 'unknown' },
    { channel: CHANNEL_BY_KEY.get('171-2'), state: 'live', stream: 'https://a/171.m3u8?k=1&t=2', logo: '' },
  ])
  assert.deepEqual(groups.map(group => group.name), ['山东-济南', '山东-东营'])
  assert.deepEqual(groups[1].dataList, [{
    name: '东营新闻综合', deferredRef: 'sdcounty-537-1', logo: 'https://img/l.png', catchup: 'none', opts: ['network-caching=3000'],
  }])
  assert.equal('relayHls' in groups[1].dataList[0], false, '子清单绑取主清单的 IP，必须 302 给播放器自己取')
})

check('频道主键不随地址里的 k / t 变：用户的隐藏、改名、换组不会每轮失效', () => {
  const id = url => buildChannelId({ groupName: '山东-东营', channelName: '东营新闻综合', url })
  assert.equal(id('${replace}/sdcounty-537-1'), id('${replace}/sdcounty-537-1'))
  // 反例：要是把官方地址写进播放列表，两轮刷新的主键就不同
  assert.notEqual(id(`${DONGYING_NEWS}`), id(DONGYING_NEWS.replace('k=82690c', 'k=000000')))
})

await checkAsync('播放：按机构缓存给当前地址，过期重取，同机构并发只打一次接口', async () => {
  let clock = 0
  const { fetchImpl, calls } = fakeFetch()
  const resolver = createResolver({ fetchImpl, ttlMs: 1000, now: () => clock })
  const [a, b] = await Promise.all([resolver.resolve('sdcounty-537-1'), resolver.resolve('sdcounty-537-3')])
  assert.equal(a.url, DONGYING_NEWS)
  assert.match(b.url, /202304_1651887564182982656/)
  assert.equal(calls.length, 1)
  await resolver.resolve('sdcounty-537-1')
  assert.equal(calls.length, 1)
  clock = 1001
  await resolver.resolve('sdcounty-537-1')
  assert.equal(calls.length, 2)

  // 刷新时取到的机构数据直接进缓存，播放不再打接口
  const warm = createResolver({ fetchImpl, now: () => 0 })
  warm.remember(171, parseOrg(ORGS[171]))
  assert.match((await warm.resolve('sdcounty-171-20')).url, /b6df53d1f77f4e068055b4eac603bdcb/)
  assert.equal(calls.length, 2)

  assert.match((await resolver.resolve('sdcounty-537-7')).desc, /不再列出东营科教/)
  assert.match((await resolver.resolve('sdcounty-1-1')).desc, /引用无效/)
  const broken = createResolver({ fetchImpl: async () => { throw new Error('ENOTFOUND') } })
  const failed = await broken.resolve('sdcounty-537-1')
  assert.equal(failed.url, '')
  assert.match(failed.desc, /ENOTFOUND/)
})

await checkAsync('fetch：报跳过与警告；接口全部取不到时报错，保留上一轮', async () => {
  const realChannels = CHANNELS.length
  const { fetchImpl } = fakeFetch({ dead: new Set([ORGS[537].data[1].stream]) })
  const result = await sd.fetch({}, { fetchImpl })
  const names = result.groups.flatMap(group => group.dataList.map(item => item.name))
  assert.ok(names.includes('东营新闻综合'))
  assert.ok(result.meta.skipped.includes('东营公共：台方当前没有推流'))
  assert.ok(result.meta.skipped.includes('东营科教：官方已不再列出这台'))
  assert.equal(result.meta.warnings.length, 0)
  assert.equal(names.length + result.meta.skipped.length, realChannels)

  await assert.rejects(sd.fetch({}, { fetchImpl: async () => { throw new Error('ENOTFOUND') } }), /ENOTFOUND/)
})

check('模块已注册：默认关闭、按地市分组（不并进山东）、按 ref 路由、带节目单、不暴露配置项', () => {
  const module = getModule('shandong-counties')
  assert.ok(module)
  assert.equal(module.defaultEnabled, false)
  assert.equal(module.outputGroupName, undefined)
  assert.equal(module.capabilities.resolve, true)
  assert.equal(resolverFor('sdcounty-537-1')?.id, 'shandong-counties')
  assert.equal(resolverFor('sdcounty-1-1'), null)
  assert.equal(module.capabilities.epg, true)
  assert.equal(module.capabilities.catchup, false)
  assert.deepEqual(module.configSchema, [])
  assert.equal(module.refreshConfigurable, false)
  assert.equal(module.epg.channels().length, CHANNELS.length)
})

console.log(`\n${passed} 项通过`)
