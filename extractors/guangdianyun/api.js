/**
 * 广电云取流：官方接口 + 「在线会话」保活。
 *
 * 实测（2026-10-24，详见 README.md）：
 * - getPlayAddress 给的清单地址带 extra_key，只对「在线」的 clientId 有效。取地址前要先让这个
 *   clientId 上线：统计 WebSocket 发一条 msg:"first" 心跳，MQTT WebSocket 用它连上
 *   （password 是 channelInfo 的 sub_key）。两条都开着才给能用的地址，缺一条就 403。
 * - 地址拿到后还得一直在线：两条连接都开着、每 30 秒内保活一次，同一地址连拉 5 分钟始终 200；
 *   只剩 MQTT 约 20 秒失效，只剩心跳约 60 秒失效；断过一次就永久 403，同一 clientId 重连也
 *   救不回，只能换 clientId 重取。
 * - 分片自带 24 小时 auth_key，不看在线状态，播放器直连 CDN 即可。
 * - 少数租户（淮安、金普、永嘉）不校验 extra_key，同样走会话，不单独分支。
 *
 * 所以按「有人在看」开会话：relay 模式下播放器每轮询一次清单都会调到 resolve，第一次调用时
 * 建会话取地址，之后每次调用续期；空闲超过 IDLE_MS 关掉两条连接。每个在播频道常驻两条
 * WebSocket，10 台同时保活实测内存约 20MB、流量约每秒 85 字节。
 *
 * 会话用的 WebSocket 与取清单的 HTTP 都走 systemProxyDispatcher：extra_key 是否绑出口 IP
 * 没验证过，统一出口最稳。
 */
import { randomUUID } from 'node:crypto'
import { WebSocket as UndiciWebSocket } from 'undici'
import { proxyAwareFetch, systemProxyDispatcher } from '../../utils/systemProxy.js'
import { CHANNEL_BY_REF, CHANNELS } from './channels.js'

export const API_BASE = 'https://1812501212048408.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/node-api.online/node-api/tv'
export const STATS_WS = 'wss://bapi.guangdianyun.tv/v1/stats/channel/watchTime'
export const MQTT_WS = 'wss://mqttdms.aodianyun.com:8300/mqtt'
export const ORIGIN = 'https://web.guangdianyun.tv'
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
export const HEADERS = { 'User-Agent': UA, Origin: ORIGIN, Referer: `${ORIGIN}/` }

const KEEPALIVE_MS = 25 * 1000       // 两条连接各自最短的失效窗口约 20 秒 / 60 秒，按 MQTT 的保活间隔走
const IDLE_MS = 90 * 1000            // 播放器 3 秒左右拉一次清单；暂停一分半没动静才收
const HANDSHAKE_MS = 6000            // 两条连接各自的建连 + 应答时限
const INFO_TTL_MS = 10 * 60 * 1000   // sub_key 不随会话变，channelInfo 缓存 10 分钟
const FAIL_COOLDOWN_MS = 10 * 1000   // 一台连续建不起会话时，短时间内直接回上次的结论
const MAX_SESSIONS = 40              // 防失控：超出按最久没用的关
const MAX_MANIFEST_BYTES = 256 * 1024

export class GdyError extends Error {
  constructor(message, { offline = false } = {}) {
    super(message)
    this.name = 'GdyError'
    this.offline = offline
  }
}

/** 拼一个 MQTT 3.1.1 CONNECT 包：clean session、keepalive 60 秒、空用户名、password=sub_key。 */
export function mqttConnectPacket(clientId, password) {
  const str = value => {
    const body = Buffer.from(String(value), 'utf8')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(body.length)
    return Buffer.concat([length, body])
  }
  // 协议名 MQTT、级别 4、标志 0xC2（用户名 + 密码 + clean session）、keepalive 60
  const variable = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0xc2, 0x00, 0x3c])
  const payload = Buffer.concat([str(clientId), str(''), str(password)])
  let remaining = variable.length + payload.length
  const lengthBytes = []
  do {
    let byte = remaining % 128
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) byte |= 0x80
    lengthBytes.push(byte)
  } while (remaining > 0)
  return Buffer.concat([Buffer.from([0x10, ...lengthBytes]), variable, payload])
}

export const MQTT_PINGREQ = Buffer.from([0xc0, 0x00])

export function heartbeat(uuid, channel, first, now = Date.now()) {
  return JSON.stringify({
    msg: first ? 'first' : '',
    uuid,
    ua: UA,
    time: Math.floor(now / 1000),
    userId: 0,
    id: channel.pid,
    type: 'tv',
    uin: channel.uin,
    liveNowStatus: 1,
  })
}

async function readJson(url, { fetchImpl, timeoutMs = 10000, headers = HEADERS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal })
    if (!response.ok) throw new GdyError(`广电云接口 HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    if (error instanceof GdyError) throw error
    throw new GdyError(error?.name === 'AbortError' ? `广电云接口超时 ${timeoutMs}ms` : '广电云接口请求失败')
  } finally {
    clearTimeout(timer)
  }
}

/** 官方 channelInfo → { liveStatus, subKey, name, logoUrl }；直播间被删时抛 offline 错误。 */
export async function fetchChannelInfo(channel, options = {}) {
  const url = `${API_BASE}/channelInfo?id=${channel.pid}&uin=${channel.uin}`
  const payload = await readJson(url, { ...options, headers: { ...HEADERS, 'X-Ca-Stage': '', Token: '' } })
  const data = payload?.data
  if (Number(payload?.errorCode) !== 0 || !data || typeof data !== 'object') {
    throw new GdyError(`「${channel.name}」${payload?.errMessage || '官方没有返回频道信息'}`, { offline: true })
  }
  return {
    liveStatus: Number(data.liveStatus),
    subKey: String(data.sub_key || ''),
    name: String(data.name || ''),
    logoUrl: String(data.logoUrl || ''),
  }
}

export async function fetchPlayAddress(channel, uuid, options = {}) {
  const url = `${API_BASE}/getPlayAddress?id=${channel.pid}&uin=${channel.uin}&clientId=${encodeURIComponent(uuid)}`
  const payload = await readJson(url, options)
  const hls = payload?.data?.hlsUrl
  if (Number(payload?.errorCode) !== 0 || typeof hls !== 'string' || !/^https?:\/\//.test(hls)) {
    throw new GdyError(`「${channel.name}」${payload?.errMessage || '官方没有给出播放地址'}`, { offline: true })
  }
  return hls
}

/** 取清单：只认 200 + #EXTM3U；404「stream not found」是台方没在推流。 */
export async function fetchManifest(url, { fetchImpl, timeoutMs = 8000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' })
    const text = await response.text()
    if (text.length > MAX_MANIFEST_BYTES) return { status: response.status, text: '', error: '清单过大' }
    return { status: response.status, text, finalUrl: response.url || url }
  } catch (error) {
    return { status: 0, text: '', error: error?.name === 'AbortError' ? `超时 ${timeoutMs}ms` : '请求失败' }
  } finally {
    clearTimeout(timer)
  }
}

function closeSocket(socket) {
  try { socket?.close() } catch { /* 已经断了 */ }
}

/** 开一条 WebSocket，等它打开并收到第一条回应（心跳回 OK、MQTT 回 CONNACK）。 */
function openSocket(WebSocketImpl, url, { protocols, dispatcher, first, accept, label }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let socket
    const fail = message => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      closeSocket(socket)
      reject(new GdyError(`广电云${label}${message}`))
    }
    const timer = setTimeout(() => fail('连接超时'), HANDSHAKE_MS)
    try {
      socket = new WebSocketImpl(url, { ...(protocols ? { protocols } : {}), ...(dispatcher ? { dispatcher } : {}) })
    } catch {
      fail('连接失败')
      return
    }
    socket.binaryType = 'arraybuffer'
    socket.onerror = () => fail('连接失败')
    socket.onclose = () => fail('连接被关闭')
    socket.onopen = () => {
      try { socket.send(first) } catch { fail('发送失败') }
    }
    socket.onmessage = event => {
      if (settled) return
      const verdict = accept(event.data)
      if (verdict === true) {
        settled = true
        clearTimeout(timer)
        socket.onerror = null
        socket.onclose = null
        socket.onmessage = null
        resolve(socket)
      } else if (typeof verdict === 'string') {
        fail(verdict)
      }
    }
  })
}

function bytesOf(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(0)
}

/** CONNACK：0x20 0x02 <flags> <code>，code 为 0 才算接受 */
export function connackVerdict(data) {
  const bytes = bytesOf(data)
  if (bytes.length < 4 || bytes[0] !== 0x20) return undefined
  return bytes[3] === 0 ? true : `MQTT 拒绝连接（${bytes[3]}）`
}

export function createResolver({
  fetchImpl = proxyAwareFetch,
  WebSocketImpl = UndiciWebSocket,
  dispatcher = () => systemProxyDispatcher(),
  now = () => Date.now(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = timer => clearInterval(timer),
  log = () => {},
} = {}) {
  const sessions = new Map()   // ref → session
  const pending = new Map()    // ref → Promise<session>
  const infos = new Map()      // ref → { info, expires }
  const failures = new Map()   // ref → { until, desc }
  let timer = null             // 全模块一个保活定时器：有会话时开，会话全关了就停

  async function channelInfo(channel) {
    const cached = infos.get(channel.ref)
    if (cached && cached.expires > now()) return cached.info
    const info = await fetchChannelInfo(channel, { fetchImpl })
    infos.set(channel.ref, { info, expires: now() + INFO_TTL_MS })
    return info
  }

  function close(ref) {
    const session = sessions.get(ref)
    if (!session) return
    sessions.delete(ref)
    session.closed = true
    closeSocket(session.stats)
    closeSocket(session.mqtt)
    if (!sessions.size && timer) {
      clearTimer(timer)
      timer = null
    }
  }

  function tick() {
    const at = now()
    for (const [ref, session] of sessions) {
      if (at - session.lastUsed > IDLE_MS) {
        log(`广电云「${session.channel.name}」没人看了，关闭在线会话`)
        close(ref)
        continue
      }
      try {
        session.mqtt.send(MQTT_PINGREQ)
        session.stats.send(heartbeat(session.uuid, session.channel, false, at))
      } catch {
        close(ref)
      }
    }
  }

  async function openSession(channel) {
    const info = await channelInfo(channel)
    if (info.liveStatus !== 1) throw new GdyError(`「${channel.name}」当前未开播`, { offline: true })
    if (!info.subKey) throw new GdyError(`「${channel.name}」官方没有给出会话密钥`)
    const uuid = randomUUID()
    const proxy = dispatcher()
    const [stats, mqtt] = await Promise.allSettled([
      openSocket(WebSocketImpl, STATS_WS, {
        dispatcher: proxy, label: '统计连接', first: heartbeat(uuid, channel, true, now()),
        accept: data => (typeof data === 'string' ? true : undefined),
      }),
      openSocket(WebSocketImpl, MQTT_WS, {
        dispatcher: proxy, label: '消息连接', protocols: ['mqtt'], first: mqttConnectPacket(uuid, info.subKey),
        accept: connackVerdict,
      }),
    ])
    if (stats.status !== 'fulfilled' || mqtt.status !== 'fulfilled') {
      if (stats.status === 'fulfilled') closeSocket(stats.value)
      if (mqtt.status === 'fulfilled') closeSocket(mqtt.value)
      throw (stats.status === 'rejected' ? stats.reason : mqtt.reason)
    }
    let url
    try {
      url = await fetchPlayAddress(channel, uuid, { fetchImpl })
    } catch (error) {
      closeSocket(stats.value)
      closeSocket(mqtt.value)
      throw error
    }
    const session = { channel, uuid, url, stats: stats.value, mqtt: mqtt.value, lastUsed: now(), closed: false }
    const dropped = () => { if (!session.closed && sessions.get(channel.ref) === session) close(channel.ref) }
    session.stats.onclose = dropped
    session.stats.onerror = dropped
    session.mqtt.onclose = dropped
    session.mqtt.onerror = dropped
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (oldest) close(oldest.channel.ref)
    }
    sessions.set(channel.ref, session)
    if (!timer) {
      timer = setTimer(tick, KEEPALIVE_MS)
      timer?.unref?.()
    }
    return session
  }

  async function sessionFor(channel, { fresh = false } = {}) {
    if (fresh) close(channel.ref)
    const existing = sessions.get(channel.ref)
    if (existing && !existing.closed) return existing
    let promise = pending.get(channel.ref)
    if (!promise) {
      promise = openSession(channel).finally(() => pending.delete(channel.ref))
      pending.set(channel.ref, promise)
    }
    return promise
  }

  async function playable(channel, session) {
    session.lastUsed = now()
    const manifest = await fetchManifest(session.url, { fetchImpl })
    if (manifest.status === 200 && manifest.text.trimStart().startsWith('#EXTM3U')) return { manifest }
    return { status: manifest.status, reason: manifest.error || `清单 HTTP ${manifest.status}` }
  }

  async function resolve(ref) {
    try {
      const channel = CHANNEL_BY_REF.get(String(ref || ''))
      if (!channel) return { url: '', desc: '广电云频道引用无效' }
      const failed = failures.get(channel.ref)
      if (failed && failed.until > now()) return { url: '', desc: failed.desc }

      let session = await sessionFor(channel)
      let outcome = await playable(channel, session)
      if (!outcome.manifest && outcome.status !== 404) {
        // 会话失效（断线、被平台踢掉）：清单 403。换一个 clientId 重新上线，只试一次
        log(`广电云「${channel.name}」${outcome.reason}，重新建立在线会话`)
        session = await sessionFor(channel, { fresh: true })
        outcome = await playable(channel, session)
      }
      if (outcome.manifest) {
        failures.delete(channel.ref)
        return {
          url: session.url,
          desc: `广电云「${channel.name}」地址获取成功`,
          relayHls: true,
          manifestText: outcome.manifest.text,
          manifestUrl: outcome.manifest.finalUrl,
          upstreamHeaders: { Referer: HEADERS.Referer, Origin: ORIGIN },
        }
      }
      close(channel.ref)
      // 清单 404 = 平台上没有这路流：台方停推。channelInfo 缓存作废，下次按最新状态判断
      if (outcome.status === 404) infos.delete(channel.ref)
      throw new GdyError(outcome.status === 404
        ? `「${channel.name}」台方当前没有推流`
        : `「${channel.name}」${outcome.reason}`, { offline: outcome.status === 404 })
    } catch (error) {
      const desc = `广电云${error?.message || '播放地址获取失败'}`
      const channel = CHANNEL_BY_REF.get(String(ref || ''))
      if (channel) failures.set(channel.ref, { until: now() + FAIL_COOLDOWN_MS, desc })
      return { url: '', desc }
    }
  }

  /** 断开在线会话并清缓存；给了 match(ref) 就只清匹配的（按省拆的模块只清自己那省） */
  function clear(match = () => true) {
    for (const ref of [...sessions.keys()]) if (match(ref)) close(ref)
    for (const map of [pending, infos, failures]) {
      for (const ref of [...map.keys()]) if (match(ref)) map.delete(ref)
    }
  }

  return { resolve, clear, sessionCount: () => sessions.size, tick }
}

/** 刷新：逐台查 channelInfo，只留 liveStatus=1 的。查不到的台（超时、接口出错）照留，免得一次抖动把频道清空。 */
export async function checkLive(channels = CHANNELS, { fetchImpl = proxyAwareFetch, timeoutMs = 10000, concurrency = 4 } = {}) {
  const results = new Array(channels.length)
  let cursor = 0
  async function worker() {
    while (cursor < channels.length) {
      const index = cursor++
      const channel = channels[index]
      try {
        const info = await fetchChannelInfo(channel, { fetchImpl, timeoutMs })
        results[index] = { channel, state: info.liveStatus === 1 ? 'live' : 'offline' }
      } catch (error) {
        results[index] = { channel, state: error?.offline ? 'gone' : 'unknown', error: error?.message || String(error) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, channels.length) }, worker))
  return results
}
