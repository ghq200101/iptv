/** 百视通 /tv/programs/{id} 提供跨日编排；按北京时间筛选，不把 /tvs 的 latest 单条当全天节目单。 */
import { createApiClient } from './auth.js'
import { CHANNELS, DEFAULT_CHANNEL_IDS, refOf } from './channels.js'

export function parseProgrammes(payload, day) {
  if (!/^\d{8}$/.test(day) || !Array.isArray(payload?.programs)) throw new Error('百视通节目单结构或日期无效')
  const startDay = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T00:00:00+08:00`)
  if (!Number.isFinite(startDay)) throw new Error('百视通节目单日期无效')
  const stopDay = startDay + 86400000
  const byStart = new Map()
  for (const row of payload.programs) {
    const title = String(row?.name || '').trim()
    const from = Number(row.startTime) * 1000, to = Number(row.endTime) * 1000
    if (!title || /^(?:精彩节目|当日回放)$/.test(title) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)
        || from <= 0 || to - from < 60000 || from >= stopDay || to <= startDay) continue
    byStart.set(from, { title, start: Math.max(from, startDay), stop: Math.min(to, stopDay) })
  }
  const rows = [...byStart.values()].sort((a, b) => a.start - b.start)
  return rows.map((row, i) => ({ ...row, stop: Math.min(row.stop, rows[i + 1]?.start ?? stopDay) }))
    .filter(row => row.stop > row.start)
}

export function createProvider({ now = () => Date.now() } = {}) {
  const clients = new WeakMap()
  function state(fetchImpl, timeoutMs) {
    if (!clients.has(fetchImpl)) clients.set(fetchImpl, { api: createApiClient({ fetchImpl, timeoutMs, now }), entries: new Map(), pending: new Map() })
    return clients.get(fetchImpl)
  }
  return {
    id: 'bestv-fj',
    days: 2,
    // 默认七路专业台；手动添加的央视、卫视等沿用项目已有节目单来源。
    channels: () => DEFAULT_CHANNEL_IDS.map(id => ({ ref: refOf(id), key: id, name: CHANNELS.find(c => c.id === id).name })),
    async programmes(key, day, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
      if (!DEFAULT_CHANNEL_IDS.includes(String(key))) return []
      const { api, entries, pending } = state(fetchImpl, timeoutMs)
      if (!(entries.get(key)?.expiresAt > now())) {
        if (!pending.has(key)) {
          const started = now()
          const promise = api.request(`/tv/programs/${key}`).then(payload => {
            if (!Array.isArray(payload?.programs)) throw new Error('百视通节目单没有 programs 列表')
            entries.set(key, { payload, expiresAt: started + 300000 })
          }).finally(() => pending.delete(key))
          pending.set(key, promise)
        }
        await pending.get(key)
      }
      return parseProgrammes(entries.get(key).payload, day)
    },
  }
}
export default createProvider()
