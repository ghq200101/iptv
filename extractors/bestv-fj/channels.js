/** 2026-10-29：原样本中通过媒体验证且仍在官方 /tvs 目录的 64 路；不自动收录目录外新台。 */
export const CHANNELS = Object.freeze([
  {
    "id": "165",
    "name": "CCTV1"
  },
  {
    "id": "166",
    "name": "CCTV2"
  },
  {
    "id": "167",
    "name": "CCTV4"
  },
  {
    "id": "168",
    "name": "CCTV7"
  },
  {
    "id": "169",
    "name": "CCTV9"
  },
  {
    "id": "170",
    "name": "CCTV10"
  },
  {
    "id": "171",
    "name": "CCTV11"
  },
  {
    "id": "172",
    "name": "CCTV12"
  },
  {
    "id": "173",
    "name": "CCTV新闻"
  },
  {
    "id": "174",
    "name": "CCTV少儿"
  },
  {
    "id": "175",
    "name": "CCTV音乐"
  },
  {
    "id": "176",
    "name": "CCTV17"
  },
  {
    "id": "220",
    "name": "都市剧场"
  },
  {
    "id": "219",
    "name": "多彩文体4K"
  },
  {
    "id": "222",
    "name": "动漫秀场"
  },
  {
    "id": "223",
    "name": "嘉佳卡通"
  },
  {
    "id": "225",
    "name": "乐游"
  },
  {
    "id": "226",
    "name": "法治天地"
  },
  {
    "id": "227",
    "name": "东方财经"
  },
  {
    "id": "229",
    "name": "快乐垂钓"
  },
  {
    "id": "230",
    "name": "生活时尚"
  },
  {
    "id": "154",
    "name": "福建综合"
  },
  {
    "id": "155",
    "name": "东南卫视"
  },
  {
    "id": "157",
    "name": "福建新闻"
  },
  {
    "id": "159",
    "name": "福建文旅·体育"
  },
  {
    "id": "162",
    "name": "福建少儿"
  },
  {
    "id": "163",
    "name": "海峡卫视"
  },
  {
    "id": "164",
    "name": "厦门卫视"
  },
  {
    "id": "180",
    "name": "湖南卫视"
  },
  {
    "id": "181",
    "name": "江苏卫视"
  },
  {
    "id": "182",
    "name": "浙江卫视"
  },
  {
    "id": "183",
    "name": "河北卫视"
  },
  {
    "id": "184",
    "name": "广东卫视"
  },
  {
    "id": "185",
    "name": "山东卫视"
  },
  {
    "id": "186",
    "name": "湖北卫视"
  },
  {
    "id": "187",
    "name": "深圳卫视"
  },
  {
    "id": "188",
    "name": "黑龙江卫视"
  },
  {
    "id": "190",
    "name": "安徽卫视"
  },
  {
    "id": "191",
    "name": "天津卫视"
  },
  {
    "id": "192",
    "name": "四川卫视"
  },
  {
    "id": "193",
    "name": "江西卫视"
  },
  {
    "id": "194",
    "name": "辽宁卫视"
  },
  {
    "id": "195",
    "name": "重庆卫视"
  },
  {
    "id": "196",
    "name": "北京卫视"
  },
  {
    "id": "197",
    "name": "云南卫视"
  },
  {
    "id": "198",
    "name": "河南卫视"
  },
  {
    "id": "200",
    "name": "广西卫视"
  },
  {
    "id": "201",
    "name": "陕西卫视"
  },
  {
    "id": "202",
    "name": "青海卫视"
  },
  {
    "id": "203",
    "name": "宁夏卫视"
  },
  {
    "id": "204",
    "name": "中国教育-1"
  },
  {
    "id": "206",
    "name": "中国教育-2"
  },
  {
    "id": "218",
    "name": "中国教育-4"
  },
  {
    "id": "208",
    "name": "金鹰卡通"
  },
  {
    "id": "209",
    "name": "卡酷少儿"
  },
  {
    "id": "210",
    "name": "吉林卫视"
  },
  {
    "id": "211",
    "name": "山西卫视"
  },
  {
    "id": "212",
    "name": "甘肃卫视"
  },
  {
    "id": "213",
    "name": "内蒙古卫视"
  },
  {
    "id": "214",
    "name": "新疆卫视"
  },
  {
    "id": "215",
    "name": "兵团卫视"
  },
  {
    "id": "216",
    "name": "西藏卫视"
  },
  {
    "id": "217",
    "name": "三沙卫视"
  },
  {
    "id": "199",
    "name": "海南卫视"
  }
].map(Object.freeze))

export const DEFAULT_CHANNEL_IDS = Object.freeze(['219', '220', '222', '225', '226', '227', '230'])
export const GROUP = '百视通'
export const refOf = id => `bestv-fj-${id}`
export function channelForRef(ref) {
  return CHANNELS.find(channel => refOf(channel.id) === String(ref || ''))
}
