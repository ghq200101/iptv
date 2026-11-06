#!/usr/bin/env node
/**
 * 山东市县台官方节目单回归测试：只认 data.date 正好是请求那天的（不带 time 时官方会退回旧的
 * 同星期编排）、「不存在的节目单」当官方没发、HH:MM:SS 按上海日期拼、跨午夜、重叠截断、
 * 请求地址的 time 落在那天上海中午。样本按 2026-10-24 崂山频道、东营新闻综合的真实响应裁剪。
 *
 * 运行： node scripts/test-shandong-counties-epg.mjs
 *       TZ=UTC node scripts/test-shandong-counties-epg.mjs
 *       TZ=America/Los_Angeles node scripts/test-shandong-counties-epg.mjs
 */
import assert from 'node:assert/strict'

import sdEpg, { PROGRAM_API, parseProgrammes, programUrl, shanghaiDay } from '../extractors/shandong-counties/epg.js'
import { CHANNEL_BY_KEY } from '../extractors/shandong-counties/channels.js'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ✅ ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ✅ ${name}`) }
const sh = text => Date.parse(`${text.replace(' ', 'T')}+08:00`)
const row = (name, start_time, end_time) => ({ name, start_time, end_time, cateid: '', catename: '', review: '0', isplay: 0, subscribed: '0' })
const day = (date, body, extra = {}) => ({
  code: 1,
  data: { id: '20650', orgid: '295', type: 'tv', channel: '崂山频道', channelid: '1', weekdayname: '周六', date, weekday: '6', body, ...extra },
  errmsg: '', score: {}, t: 4.1, s: 'new',
})

const LAOSHAN = day('2026-10-24', [
  row('早安山东', '06:56:00', '07:30:00'),
  row('纪录片', '07:30:00', '08:00:00'),
  row(' 崂山新闻 ', '08:00:00', '08:20:00'),
  row('崂山剧场：如果奔跑是我的人生', '19:55:00', '22:20:00'),
  row('一周要闻', '22:20:00', '22:35:00'),
])
// 不带 time 时东营新闻综合给的是 2025-03-15（同为周六）的旧编排
const DONGYING_STALE = day('2025-03-15', [row('民生零距离', '06:00:00', '06:30:00')], { orgid: '537', channel: '新闻综合' })
const MISSING = { code: 0, data: '不存在的节目单', errmsg: '不存在的节目单', score: {}, t: 4.8, s: 'new' }

console.log('山东市县台节目单')

check('上海日期：与机器时区无关，非法日期拒绝', () => {
  assert.deepEqual(shanghaiDay('20261024'), { start: sh('2026-10-24 00:00'), end: sh('2026-10-25 00:00'), iso: '2026-10-24' })
  assert.equal(shanghaiDay('20261332'), null)
})

check('崂山：按当天拼时间，标题去空白，升序', () => {
  const list = parseProgrammes(LAOSHAN, '20261024')
  assert.equal(list.length, 5)
  assert.deepEqual(list[0], { title: '早安山东', start: sh('2026-10-24 06:56'), stop: sh('2026-10-24 07:30') })
  assert.equal(list[2].title, '崂山新闻')
  assert.equal(list.at(-1).stop, sh('2026-10-24 22:35'))
})

check('日期对不上的旧周模板当官方没发；「不存在的节目单」也是', () => {
  assert.deepEqual(parseProgrammes(DONGYING_STALE, '20261024'), [])
  assert.deepEqual(parseProgrammes(MISSING, '20261025'), [])
  assert.throws(() => parseProgrammes({ code: 0, data: '参数错误', errmsg: '参数错误' }, '20261024'), /接口拒绝：参数错误/)
  assert.throws(() => parseProgrammes({ code: 1, data: { date: '2026-10-24' } }, '20261024'), /结构不符合预期/)
})

check('跨午夜、重叠截断、同一开始时间只留一条、不到一分钟丢掉', () => {
  const list = parseProgrammes(day('2026-10-24', [
    row('电视剧', '20:00:00', '21:10:00'),
    row('新闻', '21:00:00', '21:30:00'),
    row('重复', '21:00:00', '21:20:00'),
    row('国歌', '21:30:00', '21:30:30'),
    row('午夜剧场', '23:30:00', '01:00:00'),
  ]), '20261024')
  assert.deepEqual(list.map(item => item.title), ['电视剧', '新闻', '午夜剧场'])
  assert.equal(list[0].stop, sh('2026-10-24 21:00'))
  assert.equal(list[2].stop, sh('2026-10-25 01:00'))
})

check('请求地址：机构号、频道号，time 是那天上海中午', () => {
  const url = new URL(programUrl(CHANNEL_BY_KEY.get('295-1'), '20261024'))
  assert.equal(`${url.origin}${url.pathname}`, PROGRAM_API)
  assert.equal(url.searchParams.get('orgid'), '295')
  assert.equal(url.searchParams.get('channelid'), '1')
  assert.equal(Number(url.searchParams.get('time')) * 1000, sh('2026-10-24 12:00'))
})

await checkAsync('programmes：按 key 取，频道表外的 key 拒绝', async () => {
  const urls = []
  const fetchImpl = async url => { urls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify(LAOSHAN) } }
  const list = await sdEpg.programmes('295-1', '20261024', { fetchImpl })
  assert.equal(list.length, 5)
  assert.match(urls[0], /orgid=295&channelid=1&time=\d+$/)
  await assert.rejects(sdEpg.programmes('1-1', '20261024', { fetchImpl }), /频道无效/)
})

check('频道清单：每台一个 key、按台名对上', () => {
  const listed = sdEpg.channels()
  assert.equal(new Set(listed.map(item => item.key)).size, listed.length)
  assert.deepEqual(listed.find(item => item.key === '295-1'), { ref: 'sdcounty-295-1', name: '崂山频道', key: '295-1' })
  assert.equal(sdEpg.days, 2)
})

console.log(`\n${passed} 项通过`)
