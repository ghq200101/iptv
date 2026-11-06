/** 官方趣看托管频道；频道身份已用公开播放器元数据和实际台标交叉核验。
 * w/detail 的 windowDetail.capture 为空、mainVideo.capture 是节目截图；
 * 东阳新闻网、官方播放器均未提供独立频道标。三路使用内置 logo-pack 台标备份。
 */
export const CHANNELS = Object.freeze([
  Object.freeze({ id: '1681113308206040', ref: 'zhejiang-local-dongyang', name: '东阳新闻综合', rawName: '综合频道' }),
  Object.freeze({ id: '1700720505174325', ref: 'zhejiang-local-qujiang', name: '衢江综合', rawName: '衢江电视台' }),
  Object.freeze({ id: '1623117710666335', ref: 'zhejiang-local-jiangshan', name: '江山电视一套', rawName: '江山电视一套' }),
])
export const CHANNEL_BY_REF = new Map(CHANNELS.map(channel => [channel.ref, channel]))
