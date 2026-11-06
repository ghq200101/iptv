/**
 * 闪电新闻融媒平台官方节目单。
 *
 * `GET app.litenews.cn/v1/app/play/tv/program?orgid=<机构号>&channelid=<频道号>&time=<unix 秒>`，
 * 免登录。实测（2026-10-24）：
 * - time 落在哪天就给哪天的编排，data.date 是 YYYY-MM-DD；那天没排时回 code 0「不存在的节目单」。
 * - 不带 time 时给的是「最近一份同星期几的编排」，224 台里多数停在 2022～2026 年间的某天，
 *   是旧的周模板，不是当天节目，不用；只认 data.date 正好是请求那天的。
 * - body 每条有 name、start_time / end_time（当天 HH:MM:SS）。结束不大于开始的按跨午夜处理。
 * - 当时只有崂山频道排了当天起往后几天，其余台照样每轮去取，哪天排了就自动有。
 *
 * 和取流链路没有共享状态：只用 channels.js 的频道表和调用方注入的 fetch。
 */
import { CHANNEL_BY_KEY, CHANNELS } from './channels.js'

export const PROGRAM_API = 'https://app.litenews.cn/v1/app/play/tv/program'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_PROGRAMME_MS = 60 * 1000
const MAX_BYTES = 512 * 1024

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

/** 接口的一天 → [{ title, start, stop }]（毫秒），升序、互不重叠。那天没排、或给的是别的日子，返回空数组。 */
export function parseProgrammes(payload, day) {
  const range = shanghaiDay(day)
  if (!range) throw new Error('闪电新闻节目单日期无效')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('闪电新闻节目单返回结构不符合预期')
  if (Number(payload.code) !== 1) {
    if (/不存在的节目单/.test(String(payload.errmsg || payload.data || ''))) return []
    throw new Error(`闪电新闻节目单接口拒绝：${payload.errmsg || payload.code}`)
  }
  const data = payload.data
  if (!data || typeof data !== 'object' || !Array.isArray(data.body)) throw new Error('闪电新闻节目单返回结构不符合预期')
  if (data.date !== range.iso) return []
  const rows = []
  for (const item of data.body) {
    const title = String(item?.name ?? '').replace(/\s+/g, ' ').trim()
    const from = clock(item?.start_time)
    let to = clock(item?.end_time)
    if (!title || from == null || to == null || from >= DAY_MS) continue
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

/** 请求地址：time 取那天上海中午，离日界线两头都远。 */
export function programUrl(channel, day) {
  const range = shanghaiDay(day)
  if (!range) throw new Error('闪电新闻节目单日期无效')
  const time = Math.floor((range.start + DAY_MS / 2) / 1000)
  return `${PROGRAM_API}?orgid=${channel.org}&channelid=${channel.id}&time=${time}`
}

export async function programmes(key, day, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const channel = CHANNEL_BY_KEY.get(String(key))
  if (!channel) throw new Error('闪电新闻节目单频道无效')
  const url = programUrl(channel, day)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let text
  try {
    const response = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!response.ok) throw new Error(`闪电新闻节目单 HTTP ${response.status}`)
    text = await response.text()
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`闪电新闻节目单超时 ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (text.length > MAX_BYTES) throw new Error('闪电新闻节目单过大')
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error('闪电新闻节目单不是 JSON') }
  return parseProgrammes(payload, day)
}

export default {
  days: 2,
  channels: () => CHANNELS.map(row => ({ ref: row.ref, name: row.name, key: row.key })),
  programmes,
}
