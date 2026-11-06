import { buildChannels, claimsRef, resolveChannel } from './api.js'

export default {
  id: 'zhejiang-local',
  name: '浙江地方台',
  description: '东阳新闻综合、衢江综合、江山电视一套；官方趣看托管播放器，播放时重新核对发布及播控状态并取得短效签名，清单与分片由本机转发。',
  capabilities: { cache: 'disk', resolve: true, epg: false, catchup: false },
  catalogVersion: 1,
  outputGroupName: '浙江',
  channelHlsMode: 'proxy',
  defaultRefreshMinutes: 1440,
  refreshConfigurable: false,
  refreshDescription: '自动管理：固定三路目录；每次播放重新核对官方频道与播控，获取新签名，不把签名地址写盘。',
  configSchema: [],
  async fetch() {
    return { groups: [{ name: '浙江', dataList: buildChannels() }], meta: { skipped: [], warnings: [] } }
  },
  claimsRef,
  resolve: resolveChannel,
}
