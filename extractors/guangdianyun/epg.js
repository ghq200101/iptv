/**
 * 广电云官方节目单。
 *
 * 官网播放页的节目单组件调 programme.guangdianyun.tv/v1/programme/Index/getListByChannel，
 * 参数 channelId（直播间 id）、uin（租户号）、date（YYYY-MM-DD，不带就是今天）。不用登录、
 * 不看 Referer。实测（2026-10-24）：
 * - 成功时 code 200、errorCode 0；data.list 每条只有 name、startTime / endTime（当天的
 *   HH:MM:SS），没有日期，按请求的上海日期拼。结束时间不大于开始时间的，按跨过午夜处理。
 * - 首批 95 台里约 22 台有编排，其余 list 为空，按官方没发处理；照样每轮去取，哪天排了就自动有。
 * - 濮阳新闻综合整天是整点「节目回放」，是回看切片的占位，不当节目。
 * - 有的台编排不连续（临平只有 18:30 一档新闻），缺的时段就空着，不补。
 *
 * 和取流链路没有共享状态：只用 channels.js 的频道表和调用方注入的 fetch。
 */
import { CHANNEL_BY_KEY, CHANNELS, SLOW_GROUP } from './channels.js'

export const PROGRAMME_API = 'https://programme.guangdianyun.tv/v1/programme/Index/getListByChannel'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_PROGRAMME_MS = 60 * 1000
const MAX_BYTES = 512 * 1024
const PLACEHOLDER_TITLES = new Set(['节目回放', '精彩节目'])

/** 上海日期 YYYYMMDD → { start, end, iso }；非法日期返回 null。 */
export function shanghaiDay(day) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(day ?? ''))
  if (!match) return null
  const [year, month, date] = match.slice(1).map(Number)
  const utc = Date.UTC(year, month - 1, date)
  const check = new Date(utc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null
  const start = utc - SHANGHAI_OFFSET_MS
  return { start, end: start + DAY_MS, iso: `${match[1]}-${match[2]}-${match[3]}` }
}

function clock(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim())
  if (!match) return null
  const [hours, minutes, seconds = 0] = match.slice(1).map(Number)
  if (hours > 24 || minutes > 59 || seconds > 59) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1000
}

/** 接口的一天 → [{ title, start, stop }]（毫秒），升序、互不重叠。官方拒绝时抛错。 */
export function parseProgrammes(payload, day) {
  const range = shanghaiDay(day)
  if (!range) throw new Error('广电云节目单日期无效')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('广电云节目单返回结构不符合预期')
  if (Number(payload.code) !== 200 || Number(payload.errorCode) !== 0) {
    throw new Error(`广电云节目单接口拒绝：${payload.errorMessage || payload.errorCode}`)
  }
  const list = payload.data?.list
  if (!Array.isArray(list)) throw new Error('广电云节目单返回结构不符合预期')
  const rows = []
  for (const item of list) {
    const title = String(item?.name ?? '').replace(/\s+/g, ' ').trim()
    const from = clock(item?.startTime)
    let to = clock(item?.endTime)
    if (!title || PLACEHOLDER_TITLES.has(title) || from == null || to == null || from >= DAY_MS) continue
    if (to <= from) to += DAY_MS
    const start = range.start + from
    const stop = range.start + to
    if (stop - start < MIN_PROGRAMME_MS) continue
    rows.push({ title, start, stop })
  }
  rows.sort((a, b) => a.start - b.start)
  const result = []
  for (const row of rows) {
    const previous = result.at(-1)
    if (previous?.start === row.start) continue
    if (previous && previous.stop > row.start) previous.stop = row.start
    result.push(row)
  }
  return result.filter(row => row.stop - row.start >= MIN_PROGRAMME_MS)
}

export async function programmes(key, day, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const channel = CHANNEL_BY_KEY.get(String(key))
  if (!channel) throw new Error('广电云节目单频道无效')
  const range = shanghaiDay(day)
  if (!range) throw new Error('广电云节目单日期无效')
  const url = `${PROGRAMME_API}?channelId=${channel.pid}&uin=${channel.uin}&date=${range.iso}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let text
  try {
    const response = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!response.ok) throw new Error(`广电云节目单 HTTP ${response.status}`)
    text = await response.text()
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`广电云节目单超时 ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (text.length > MAX_BYTES) throw new Error('广电云节目单过大')
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error('广电云节目单不是 JSON') }
  return parseProgrammes(payload, day)
}

/** 按省拆模块后每个模块一份：只列本省电视台；慢直播是固定机位，没有节目单，不去问 */
export function epgFor(province) {
  return {
    days: 2,
    channels: () => CHANNELS
      .filter(row => row.province === province && row.group !== SLOW_GROUP)
      .map(row => ({ ref: row.ref, name: row.name, key: row.key })),
    programmes,
  }
}
