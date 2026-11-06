/** 5G 云 TV 请求签名与匿名 clientID。规则来自用户提供的 PHP，TLS 校验保持开启。 */
import { createHash, createHmac, randomUUID } from 'node:crypto'

export const API_BASE = 'https://kylinapi.bbtv.cn/5g/v1'
const SALT = '557f1d838112de4fc349b8558781fe17'
const VERSION = '1.2305.0713'
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SDK/1.0.0/coocaa//' }
const MAX_BYTES = 1024 * 1024

export function signedClientQuery(timestamp, deviceId) {
  const param = `deviceid=${deviceId}&market=coocaa&timestamp=${timestamp}&version=${VERSION}`
  return `${param}&signature=${createHmac('md5', SALT).update(param).digest('hex')}`
}
export function signedHeaders(timestamp) {
  return { ...HEADERS, app: 'android', release: '1', channel: 'standard', version: VERSION,
    timestamp: String(timestamp), sign: createHash('md5').update(timestamp + SALT).digest('hex') }
}

/** 不跟随上游重定向，不把带 clientID/签名的 URL 放进异常。 */
export async function requestText(url, { fetchImpl, timeoutMs = 12000, headers = {} }) {
  let response
  try {
    response = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(['AbortError', 'TimeoutError'].includes(error?.name) ? '上游请求超时' : '上游网络请求失败')
  }
  if (!response.ok || response.status >= 300) {
    await response.body?.cancel?.().catch(() => {})
    const error = new Error(`上游 HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  const chunks = []
  let size = 0
  if (Number(response.headers?.get?.('content-length')) > MAX_BYTES) {
    await response.body?.cancel?.().catch(() => {})
    throw new Error('上游响应过大')
  }
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > MAX_BYTES) throw new Error('上游响应过大')
      chunks.push(Buffer.from(chunk))
    }
  } catch (error) {
    throw new Error(error.message === '上游响应过大' ? error.message : '上游响应读取失败')
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

export function createApiClient({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 12000 } = {}) {
  let client, pending, generation = 0
  async function json(url, headers) {
    const text = await requestText(url, { fetchImpl, timeoutMs, headers })
    try { return JSON.parse(text) } catch { throw new Error('上游没有返回 JSON') }
  }
  async function clientID() {
    if (client?.expiresAt > now()) return client.id
    if (!pending) {
      const gen = generation, started = now()
      const promise = json(`${API_BASE}/client-id-by-region?${signedClientQuery(Math.floor(started / 1000), `COOCAA_${randomUUID().toUpperCase()}`)}`, HEADERS)
        .then(data => {
          if (typeof data?.clientID !== 'string' || !data.clientID) throw new Error('上游未提供 clientID')
          if (gen === generation) client = { id: data.clientID, expiresAt: started + 420000 }
          return data.clientID
        }).finally(() => { if (pending === promise) pending = null })
      pending = promise
    }
    return pending
  }
  function clear() { generation++; client = null; pending = null }
  async function request(path) {
    if (!/^\/(?:tvs|tv\/(?:now|programs)\/\d+)$/.test(path)) throw new Error('接口路径不合法')
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = await clientID()
      try {
        return await json(`${API_BASE}${path}?client=${encodeURIComponent(id)}`, signedHeaders(Math.floor(now() / 1000)))
      } catch (error) {
        if (attempt || ![401, 403].includes(error.status)) throw error
        clear()
      }
    }
  }
  return { request, clear }
}
