#!/usr/bin/env node
/**
 * 广电云官方节目单回归测试：HH:MM:SS 按上海日期拼、跨午夜、丢「节目回放」占位与不到一分钟的
 * 条目、标题去空白、重叠截断、平台拒绝报错、请求地址与官网一致。样本按 2026-10-24
 * 黄石新闻综合、濮阳新闻综合、临平新闻三台的真实响应裁剪。
 *
 * 运行： node scripts/test-guangdianyun-epg.mjs
 *       TZ=UTC node scripts/test-guangdianyun-epg.mjs
 *       TZ=America/Los_Angeles node scripts/test-guangdianyun-epg.mjs
 */
import assert from 'node:assert/strict'

import { PROGRAMME_API, epgFor, parseProgrammes, programmes, shanghaiDay } from '../extractors/guangdianyun/epg.js'
import { getModule } from '../extractors/registry.js'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ✅ ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ✅ ${name}`) }
const sh = text => Date.parse(`${text.replace(' ', 'T')}+08:00`)
const ok = list => ({ code: 200, errorCode: 0, errorMessage: '', data: { list, timestamp: 1792819320, playbackStatus: 1 } })
const row = (name, startTime, endTime) => ({ id: 1, name, startTime, endTime, mssUrl: '', sTaskId: 0, eTaskId: 0, mTaskId: 0 })

const HUANGSHI = ok([
  row(' 品质', '00:00:00', '00:24:00'),
  row('黄石新闻', '06:30:00', '07:00:00'),
  row('央视朝闻天下', '07:00:00', '08:00:00'),
  row('转央视新闻联播', '19:00:00', '19:35:00'),
  row('黄石新闻', '19:35:00', '20:06:00'),
  row('品质', '23:54:00', '23:59:59'),
])
const PUYANG = ok([
  row('节目回放', '06:00:00', '07:00:00'),
  row('国歌', '07:00:00', '07:00:49'),
  row('濮阳新闻', '07:00:49', '07:15:49'),
  row('阳光热线', '07:29:00', '08:00:00'),
  row('节目回放', '10:00:00', '11:00:00'),
])

console.log('广电云节目单')

check('上海日期：与机器时区无关，非法日期拒绝', () => {
  assert.deepEqual(shanghaiDay('20261024'), { start: sh('2026-10-24 00:00'), end: sh('2026-10-25 00:00'), iso: '2026-10-24' })
  assert.equal(shanghaiDay('20261332'), null)
  assert.equal(shanghaiDay('2026-10-24'), null)
})

check('黄石：按当天拼时间，标题去首尾空白，升序', () => {
  const list = parseProgrammes(HUANGSHI, '20261024')
  assert.equal(list.length, 6)
  assert.deepEqual(list[0], { title: '品质', start: sh('2026-10-24 00:00'), stop: sh('2026-10-24 00:24') })
  assert.deepEqual(list[3], { title: '转央视新闻联播', start: sh('2026-10-24 19:00'), stop: sh('2026-10-24 19:35') })
  assert.equal(list.at(-1).stop, sh('2026-10-24 23:59:59'))
})

check('濮阳：整点「节目回放」是回看占位，丢掉；不到一分钟的国歌丢掉', () => {
  const list = parseProgrammes(PUYANG, '20261024')
  assert.deepEqual(list.map(item => item.title), ['濮阳新闻', '阳光热线'])
  assert.equal(list[0].start, sh('2026-10-24 07:00:49'))
})

check('结束时间不大于开始时间按跨午夜处理；重叠截断、同一时刻去重', () => {
  const list = parseProgrammes(ok([
    row('电影', '23:00:00', '01:30:00'),
    row('新闻', '20:00:00', '21:00:00'),
    row('新闻重播', '20:00:00', '20:40:00'),
    row('剧场', '20:50:00', '22:00:00'),
    row('', '12:00:00', '13:00:00'),
    row('坏数据', '25:00:00', '26:00:00'),
  ]), '20261024')
  assert.deepEqual(list.map(item => [item.title, item.start, item.stop]), [
    ['新闻', sh('2026-10-24 20:00'), sh('2026-10-24 20:50')],
    ['剧场', sh('2026-10-24 20:50'), sh('2026-10-24 22:00')],
    ['电影', sh('2026-10-24 23:00'), sh('2026-10-25 01:30')],
  ])
})

check('空表是官方没发：返回空数组；平台拒绝和结构变化报错', () => {
  assert.deepEqual(parseProgrammes(ok([]), '20261024'), [])
  assert.throws(() => parseProgrammes({ code: 200, errorCode: 3, data: '', errorMessage: '直播间Id不得为空' }, '20261024'), /直播间Id不得为空/)
  assert.throws(() => parseProgrammes({ code: 200, errorCode: 0, data: {} }, '20261024'), /结构/)
  assert.throws(() => parseProgrammes([], '20261024'), /结构/)
})

await checkAsync('请求地址与官网一致：channelId + uin + date', async () => {
  let requested = ''
  const fetchImpl = async url => { requested = url; return { ok: true, status: 200, text: async () => JSON.stringify(HUANGSHI) } }
  const list = await programmes('3031-3065', '20261025', { fetchImpl })
  assert.equal(requested, `${PROGRAMME_API}?channelId=3031&uin=3065&date=2026-10-25`)
  assert.equal(list[1].start, sh('2026-10-25 06:30'))
  await assert.rejects(programmes('1-1', '20261025', { fetchImpl }), /频道无效/)
})

check('模块挂了节目单：频道按引用对上，取今明两天', () => {
  const module = getModule('guangdianyun-hubei')
  assert.equal(module.epg.days, 2)
  assert.equal(module.epg.programmes, programmes)
  const huangshi = module.epg.channels().find(item => item.key === '3031-3065')
  assert.deepEqual(huangshi, { ref: 'gdy-3031-3065', name: '黄石新闻综合', key: '3031-3065' })
  // 别省的台不在湖北模块的节目单里；慢直播不去问
  assert.equal(module.epg.channels().some(item => item.key === '1902-3370'), false)
  assert.equal(epgFor('河南').channels().some(item => item.key === '3900-3744'), false)
})

console.log(`\n${passed} 项通过`)
