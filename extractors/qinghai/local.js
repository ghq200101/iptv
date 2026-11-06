/**
 * 青海地方台：望昆仑的格尔木新闻综合、爱上河湟的海东综合频道。
 * 官方 App 的公开电视目录直接给出可播 HLS，无需登录、请求头或本机转发。
 * 2026-10-27 的实播快照仅用于目录暂时不可达时兜底；签名始终原样采用官方值。
 * 格尔木的“当日回放”为全天占位、海东节目表为空，均不作为节目单或回看能力。
 */
import { proxyAwareFetch } from '../../utils/systemProxy.js'

export const LOCAL_CHANNELS = Object.freeze([
  Object.freeze({
    id: 'geermu-news', name: '格尔木新闻综合', rawName: '新闻综合', streamKey: 'xwzh',
    api: 'https://grmapp.geermurmt.cn/tenma01ds_tvradio/Apphome/home?channel_id=&channel_type=1',
    mediaHost: 'miku-live-hls-gemwkl-tv.geermurmt.cn', mediaPath: '/gemwkl-tv/xwzh.m3u8',
    logoHost: 'grmapposs.geermurmt.cn',
    fallbackUrl: 'https://miku-live-hls-gemwkl-tv.geermurmt.cn/gemwkl-tv/xwzh.m3u8?sign=bd290c67d513b07aa49842b8aedd02c2&t=1876791311',
    fallbackLogo: 'https://grmapposs.geermurmt.cn/tianma/2025/03/10/F8A59614F311CC949AC87C94E38479DC.png',
  }),
  Object.freeze({
    id: 'haidong-general', name: '海东综合频道', rawName: '海东综合频道', streamKey: 'zhds',
    api: 'https://hdapp.hdhhy.cn/tenma01ds_tvradio/Apphome/home?channel_id=&channel_type=1',
    mediaHost: 'hls-hdapp.hdhhy.cn', mediaPath: '/ashh-tv/zhds.m3u8',
    logoHost: 'oss.hdhhy.cn',
    fallbackUrl: 'https://hls-hdapp.hdhhy.cn/ashh-tv/zhds.m3u8?sign=26c873e6e3d94ba02aa78c0fbf326dfd&t=1886228277',
    fallbackLogo: 'https://oss.hdhhy.cn/tianma/2026/04/13/DF88CA87DD141DE0AB94417FFDE17615.png',
  }),
])

const MAX_RESPONSE_BYTES = 1024 * 1024
const cache = new Map()

function secureUrl(value, host) {
  const url = new URL(String(value || ''))
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password
    || url.port || url.hash) throw new Error('官方地址域名不符')
  return url
}

function mediaUrl(source, value) {
  const url = secureUrl(value, source.mediaHost)
  if (url.pathname !== source.mediaPath) throw new Error('官方媒体地址不属于本频道')
  return url.href
}

function logoUrl(source, value) {
  try {
    const url = secureUrl(value, source.logoHost)
    if (url.pathname.startsWith('/tianma/') && /\.(png|jpe?g|webp)$/i.test(url.pathname)) return url.href
  } catch { /* 台标异常不影响已验证的直播地址。 */ }
  return ''
}

function channel(source, value = {}) {
  return {
    name: source.name,
    url: mediaUrl(source, value.url || source.fallbackUrl),
    logo: logoUrl(source, value.logo) || source.fallbackLogo,
    groupTitle: '青海', opts: ['network-caching=3000'],
    catchup: 'none', supersedesFeatured: true,
  }
}

/** 不联网的已验证快照，也供冷启动或单台目录故障时保留频道。 */
export function buildLocalChannels() {
  return LOCAL_CHANNELS.map(source => channel(source))
}

async function readJson(response) {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`官方目录 HTTP ${response.status}`)
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('官方目录响应过大')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('官方目录没有内容')
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_RESPONSE_BYTES) throw new Error('官方目录响应过大')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'))
  } catch { throw new Error('官方目录不是有效 JSON') }
}

function safeError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[地址已省略]')
    .replace(/\b(?:sign|t)=[^\s&"'<>]+/gi, '[签名已省略]')
    .slice(0, 180)
}

/** 每路独立刷新，某台的目录或台标故障不会令其它频道消失。 */
export async function fetchLocalChannels({ fetchImpl = proxyAwareFetch, timeoutMs = 10000 } = {}) {
  const results = await Promise.all(LOCAL_CHANNELS.map(async source => {
    try {
      const response = await fetchImpl(source.api, {
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      })
      const payload = await readJson(response)
      if (payload.code !== 200 || !Array.isArray(payload.data?.channel_info)) {
        throw new Error('官方目录没有频道列表')
      }
      const matches = payload.data.channel_info.filter(item => Number(item.id) === 1
        && Number(item.channel_type) === 1 && item.name === source.rawName && item.stream_key === source.streamKey)
      if (matches.length !== 1 || typeof matches[0].m3u8 !== 'string') throw new Error('官方目录缺少唯一目标频道')
      const previous = cache.get(source.id)
      const value = {
        url: mediaUrl(source, matches[0].m3u8),
        logo: logoUrl(source, matches[0].mark_img) || previous?.logo || source.fallbackLogo,
      }
      cache.set(source.id, value)
      return { channel: channel(source, value) }
    } catch (error) {
      const previous = cache.get(source.id)
      return {
        channel: channel(source, previous),
        warning: `${source.name}：${safeError(error)}，沿用${previous ? '上次成功地址' : '已验证地址快照'}`,
      }
    }
  }))
  return {
    channels: results.map(result => result.channel),
    warnings: results.flatMap(result => result.warning ? [result.warning] : []),
  }
}

export function clearLocalCache() {
  cache.clear()
}
