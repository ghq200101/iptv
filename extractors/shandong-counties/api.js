/**
 * 闪电新闻融媒平台（app.litenews.cn）取流。
 *
 * 实测（2026-10-24，详见 README.md）：
 * - `GET /v1/app/play/tv/live?orgid=<机构号>` 免登录、不看 Referer，返回该区县融媒体中心的全部直播：
 *   每条有 id、name、stream（HLS 主清单）、logo / icon。一个机构一次请求就拿到全部频道。
 * - stream 带 k / t 两个参数，每次请求都换。alivealone302 上的去掉 k、改掉 t 照样 200；
 *   blivealone302 上的 t 是约一小时后的整点、去掉签名就取不到。所以地址不能写进播放列表：
 *   频道主键按地址算，k / t 一变，用户对这台的隐藏、改名、换组、排序就全部失效。
 *   播放列表里写固定的 ref，播放时由 resolve 给当前地址，app 回 302。
 * - 主清单只有一档，子清单在网宿 CDN 上、按取主清单的出口 IP 绑定（wsBindIP），所以
 *   必须是 302 让播放器自己取主清单，不能经本机中继（不标 relayHls）。
 * - 停推的台照样出现在接口里，主清单 404（少数第三方 CDN 上的会一直挂着不回）。
 *   刷新时逐台取一次主清单，只输出能取到的。
 */
import { proxyAwareFetch } from '../../utils/systemProxy.js'
import { CHANNEL_BY_REF } from './channels.js'

export const API_BASE = 'https://app.litenews.cn/v1/app/play/tv'
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
const MAX_BYTES = 512 * 1024
const IMAGE_RE = /^https?:\/\/[^\s"']+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"']*)?$/i

async function request(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    const text = response.ok ? await response.text() : ''
    return { status: response.status, text }
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? `超时 ${timeoutMs}ms` : (error?.message || String(error)))
  } finally {
    clearTimeout(timer)
  }
}

/** 接口的一个机构 → Map(频道 id → { name, stream, logo })。接口拒绝或结构不对时抛错。 */
export function parseOrg(payload) {
  if (!payload || typeof payload !== 'object' || Number(payload.code) !== 1 || !Array.isArray(payload.data)) {
    throw new Error(`接口拒绝：${payload?.errmsg || payload?.data || '返回结构不符合预期'}`)
  }
  const result = new Map()
  for (const item of payload.data) {
    const id = Number(item?.id)
    const stream = String(item?.stream || '').trim()
    if (!Number.isInteger(id) || !/^https?:\/\/\S+$/.test(stream)) continue
    // logo 是频道标；icon 多是电视台站标，个别机构填的是 m3u8 地址，只认图片
    const logo = [item.logo, item.icon].map(value => String(value || '').trim()).find(value => IMAGE_RE.test(value)) || ''
    result.set(id, { name: String(item.name || '').trim(), stream, logo })
  }
  return result
}

export async function fetchOrg(org, { fetchImpl = proxyAwareFetch, timeoutMs = 10000 } = {}) {
  const { status, text } = await request(`${API_BASE}/live?orgid=${org}`, { fetchImpl, timeoutMs })
  if (status !== 200) throw new Error(`HTTP ${status}`)
  if (text.length > MAX_BYTES) throw new Error('返回过大')
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error('返回不是 JSON') }
  return parseOrg(payload)
}

/** 主清单能取到、是 HLS 才算在推流；404、超时、连不上都当停推。 */
export async function isLive(url, { fetchImpl = proxyAwareFetch, timeoutMs = 8000 } = {}) {
  try {
    const { status, text } = await request(url, { fetchImpl, timeoutMs })
    return status === 200 && text.trimStart().startsWith('#EXTM3U')
  } catch {
    return false
  }
}

async function pool(items, concurrency, task) {
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      await task(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

/**
 * 刷新：按机构取频道（一个机构一次请求），再逐台取一次主清单确认在推流。
 * → [{ channel, state: 'live' | 'offline' | 'gone' | 'unknown', stream?, logo?, error? }]
 * gone = 接口里已经没有这台；unknown = 所在机构的接口这轮没取到，给不出地址。
 */
export async function checkChannels(channels, { fetchImpl = proxyAwareFetch, timeoutMs = 10000, concurrency = 6, onOrg } = {}) {
  const borrowed = channel => channel.logoFrom ? channel.logoFrom.split('-').map(Number) : null
  const orgs = [...new Set(channels.flatMap(channel => [channel.org, borrowed(channel)?.[0]]).filter(Boolean))]
  const orgData = new Map()
  const orgErrors = new Map()
  await pool(orgs, concurrency, async org => {
    try {
      const data = await fetchOrg(org, { fetchImpl, timeoutMs })
      orgData.set(org, data)
      onOrg?.(org, data)
    } catch (error) {
      orgErrors.set(org, error?.message || String(error))
    }
  })

  const results = new Array(channels.length)
  await pool(channels, concurrency, async (channel, index) => {
    const data = orgData.get(channel.org)
    if (!data) {
      results[index] = { channel, state: 'unknown', error: orgErrors.get(channel.org) }
      return
    }
    const entry = data.get(channel.id)
    if (!entry) {
      results[index] = { channel, state: 'gone' }
      return
    }
    const live = await isLive(entry.stream, { fetchImpl, timeoutMs: Math.min(timeoutMs, 8000) })
    if (!live) {
      results[index] = { channel, state: 'offline' }
      return
    }
    // 自己没图的借所属电视台在别处登记的站标（见 channels.js 顶部）
    const [logoOrg, logoId] = borrowed(channel) || []
    const logo = channel.noLogo ? '' : (entry.logo || orgData.get(logoOrg)?.get(logoId)?.logo || '')
    results[index] = { channel, state: 'live', stream: entry.stream, logo }
  })
  return results
}

/**
 * 播放时给地址：按机构缓存接口结果（刷新时顺带写入），过期再取一次。
 * 缓存 20 分钟：blivealone302 的签名约一小时后到期，留足余量；同一机构并发请求只打一次接口。
 */
export function createResolver({ fetchImpl = proxyAwareFetch, ttlMs = 20 * 60 * 1000, now = Date.now } = {}) {
  const cache = new Map()     // org → { at, data }
  const pending = new Map()   // org → Promise<data>

  function remember(org, data) {
    cache.set(org, { at: now(), data })
  }

  async function orgData(org) {
    const hit = cache.get(org)
    if (hit && now() - hit.at < ttlMs) return hit.data
    if (!pending.has(org)) {
      pending.set(org, fetchOrg(org, { fetchImpl })
        .then(data => { remember(org, data); return data })
        .finally(() => pending.delete(org)))
    }
    return pending.get(org)
  }

  async function resolve(ref) {
    const channel = CHANNEL_BY_REF.get(String(ref || ''))
    if (!channel) return { url: '', desc: '山东市县：频道引用无效' }
    try {
      const entry = (await orgData(channel.org)).get(channel.id)
      if (!entry) return { url: '', desc: `山东市县：官方已不再列出${channel.name}` }
      return { url: entry.stream, desc: '' }
    } catch (error) {
      return { url: '', desc: `山东市县：闪电新闻接口请求失败（${error?.message || error}）` }
    }
  }

  return { resolve, remember, clear: () => cache.clear() }
}
