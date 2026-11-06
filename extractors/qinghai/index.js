/** 青海省台中继清单；格尔木、海东地方台由播放器直连官方 CDN。 */
import { buildChannels, claimsRef, clearCache, resolveChannel } from './api.js'
import { clearLocalCache, fetchLocalChannels } from './local.js'
import epg from './epg.js'

export default {
  id: 'qinghai',
  name: '青海',
  description: '青海卫视、经济生活、都市、安多卫视，以及格尔木新闻综合、海东综合频道，共 6 路。免登录；省台播放时换签、只中继清单，格尔木和海东由播放器直连官方 CDN。',
  capabilities: { cache: 'disk', resolve: true, epg: true, catchup: false },
  catalogVersion: 3,
  outputGroupName: '青海',
  relayProxyCompatible: true,
  defaultRefreshMinutes: 1440,
  refreshConfigurable: false,
  refreshDescription: '自动管理：每天更新格尔木、海东的官方直链；省台播放时取当前签名地址、30 分钟换一次，仅中继省台清单。地方台清单和分片均由播放器直连。',

  configSchema: [],

  async fetch(config = {}, ctx = {}) {
    const local = await fetchLocalChannels(ctx)
    return {
      groups: [{ name: '青海', dataList: [...buildChannels(), ...local.channels] }],
      meta: { skipped: [], warnings: local.warnings },
    }
  },

  // 青海卫视的节目单取自央视网（见 epg.js）；平台节目单接口只有整点占位
  epg,
  claimsRef,
  resolve: resolveChannel,
  clearResolveCache() {
    clearCache()
    clearLocalCache()
  },
}
