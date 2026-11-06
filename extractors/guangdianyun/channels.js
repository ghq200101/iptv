/**
 * 广电云（杭州广电云，web.guangdianyun.tv）托管的市县电视台直播。
 *
 * 频道号来自 TG 群友提供的 PHP 表，2026-10-24 逐台用官方 channelInfo / getPlayAddress 核对、
 * 拉分片并截帧看过画面。pid 是直播间 id，uin 是电视台在平台上的租户号。
 *
 * - 当时在播 73 台、停推（官方 liveStatus=0，清单 stream not found）22 台都收进目录：
 *   每轮刷新只输出 liveStatus=1 的，停推的台恢复推流后下一轮自动出现。
 * - 没收：「直播黄石」(3071) 是城市监控式慢直播；「无线淮安」(803) 只放版权占位图，
 *   淮安综合用 2778；绵竹 1933 与 3686 同一台，留 1080P 的 3686；南县融媒体中心
 *   租户(1632)下的 CCTV1、湖南卫视两间是活动直播间（标题已改成别的发布会），
 *   「中华美食」(3782) 是网络台，肥东「新闻测试」(3780)、宁安「网络直播」(2475) 是活动/测试间；
 *   另有 10 台官方回「直播间不存在 / 用户不存在」，已删除。
 * - 乐清两路在原 PHP 里名字互换了，按画面角标改正：170 是综合频道、171 是新闻频道。
 * - 台标：官方 channelInfo 只有 14 台带 logoUrl，逐张打开看过，温岭那张是二维码不用，
 *   其余 13 张写死在这里（官方 OSS，地址稳定）。别的台官方没有，留空，由内置台标库兜底。
 *
 * 2026-10-24 又按官方 channelInfo 把直播间号 1～4100 扫了一遍（只凭 id 就能查，不校验租户号）：
 * 在推流、模块外的 168 个逐个截帧，新增 30 个电视台频道（另收同租户停推的新乡公共）和 97 路慢直播。
 * 漳州一套与福建模块的「漳州新闻综合」是同一台，按同名收作备份；石狮 SSTV 晋江石狮模块已有，不收。
 * 不收的还有各台备线、转播央视、测试间、宣传片轮播与广播电台。停推的老房间看不出现状，没收。
 *
 * 台名：官方只写「新闻综合频道」这类通用名的补上市县名、去掉结尾的「频道」，官方原名记在 rawName。
 */

const OSS = 'https://static-pro.guangdianyun.tv'

const rows = [
  // 北京
  { pid: 3341, uin: 3698, province: '北京', name: '昌平综合', rawName: '昌平综合频道' },
  // 黑龙江
  { pid: 2281, uin: 1463, province: '黑龙江', name: '大庆新闻综合', rawName: '大庆广播电视台新闻综合频道' },
  { pid: 2283, uin: 1463, province: '黑龙江', name: '大庆教育', rawName: '大庆广播电视台教育频道' },
  // 辽宁
  { pid: 1066, uin: 1332, province: '辽宁', name: '金普新闻综合', rawName: '新闻综合频道' },
  { pid: 2598, uin: 1332, province: '辽宁', name: '金普生活服务', rawName: '生活服务频道' },
  // 河北
  { pid: 732, uin: 1724, province: '河北', name: '冀州综合', rawName: '冀州1',
    logo: `${OSS}/1724/program/20180929/0408cf99e5433bdee09b3b2b488ef944.png` },
  { pid: 3654, uin: 1425, province: '河北', name: '武强综合', rawName: '武强县融媒体中心综合频道' },
  // 山西
  { pid: 2125, uin: 2556, province: '山西', name: '侯马电视台', rawName: '侯马台' },
  { pid: 1203, uin: 2653, province: '山西', name: '曲沃新闻综合', rawName: '曲沃电视台新闻综合频道' },
  { pid: 2652, uin: 2268, province: '山西', name: '吕梁新闻综合', rawName: '吕梁新闻综合频道' },
  { pid: 2653, uin: 2268, province: '山西', name: '吕梁影视生活', rawName: '吕梁影视生活频道' },
  { pid: 3406, uin: 1779, province: '山西', name: '交城电视台', rawName: '交城广播电视台' },
  { pid: 3407, uin: 1723, province: '山西', name: '潞州融媒', rawName: '潞州融媒' },
  { pid: 2511, uin: 3580, province: '山西', name: '芮城综合', rawName: '芮城综合频道' },
  // 山东：输出到「山东-淄博」「山东-菏泽」，与山东市县模块的地市分组放在一起（那边的淄博、菏泽组只有区县台，不撞名）
  { pid: 2308, uin: 3185, province: '山东', city: '淄博', name: '淄博新闻综合', rawName: '新闻综合频道' },
  { pid: 3492, uin: 4042, province: '山东', city: '菏泽', name: '菏泽一套', rawName: '菏泽一套' },
  { pid: 3493, uin: 4042, province: '山东', city: '菏泽', name: '菏泽二套', rawName: '菏泽二套' },
  // 安徽
  { pid: 1588, uin: 2465, province: '安徽', name: '宁国新闻综合', rawName: '新闻综合频道' },
  { pid: 3390, uin: 4180, province: '安徽', name: '宿松新闻综合', rawName: '新闻综合' },
  { pid: 3350, uin: 4104, province: '安徽', name: '桐城综合', rawName: '桐城电视信号' },
  { pid: 2851, uin: 2577, province: '安徽', name: '阜阳新闻综合', rawName: '阜阳新闻综合频道（今日阜阳）' },
  { pid: 2853, uin: 2577, province: '安徽', name: '阜阳生活', rawName: '阜阳生活频道（今日阜阳）' },
  // 河南
  { pid: 142, uin: 1081, province: '河南', name: '南阳新闻综合', rawName: '新闻综合（南阳一套）',
    logo: `${OSS}/1081/program/20180320/c70d5bd94bb01ecc07345c583f700e2c.png` },
  { pid: 295, uin: 1081, province: '河南', name: '南阳公共', rawName: '公共频道（南阳二套）',
    logo: `${OSS}/1081/program/20180321/bfb51f12cfa243d54c728b59b0c22f42.jpg` },
  { pid: 296, uin: 1081, province: '河南', name: '南阳科教', rawName: '科教频道（南阳三套）',
    logo: `${OSS}/1081/program/20180321/3371bf1380ed27407efb1248fe938f0c.jpg` },
  { pid: 3662, uin: 3616, province: '河南', name: '濮阳新闻综合', rawName: '电视直播丨濮阳新闻综合频道' },
  { pid: 3017, uin: 3616, province: '河南', name: '濮阳公共', rawName: '电视直播丨濮阳公共频道' },
  { pid: 340, uin: 1465, province: '河南', name: '鹤壁新闻综合', rawName: '鹤壁新闻综合频道',
    logo: `${OSS}/1465/program/20180423/199c10ec582aa12cd022b7104bd49fdd.jpg` },
  // 湖北
  { pid: 3061, uin: 1500, province: '湖北', name: '襄阳综合', rawName: '襄阳综合频道' },
  { pid: 2675, uin: 1500, province: '湖北', name: '襄阳经济生活', rawName: '襄阳经济生活频道' },
  { pid: 304, uin: 1487, province: '湖北', name: '随州综合', rawName: '随州综合频道',
    logo: `${OSS}/1487/program/20180320/0cd92962c37ae5bc328b40a406fa9a30.png` },
  { pid: 305, uin: 1487, province: '湖北', name: '随州农村', rawName: '随州农村频道',
    logo: `${OSS}/1487/program/20180320/c9ae814c3dd33df07215c60dc162a3a3.png` },
  { pid: 509, uin: 1832, province: '湖北', name: '仙桃综合', rawName: '综合频道' },
  { pid: 1982, uin: 3165, province: '湖北', name: '蔡甸新闻综合', rawName: '蔡甸新闻综合频道' },
  { pid: 2904, uin: 3951, province: '湖北', name: '新洲综合', rawName: '综合频道' },
  { pid: 3031, uin: 3065, province: '湖北', name: '黄石新闻综合', rawName: '新闻综合频道' },
  { pid: 3032, uin: 3065, province: '湖北', name: '黄石都市', rawName: '都市频道' },
  { pid: 3623, uin: 3065, province: '湖北', name: '黄石公共', rawName: '公共频道' },
  { pid: 1811, uin: 3179, province: '湖北', name: '恩施文旅', rawName: '恩施文旅频道' },
  { pid: 3522, uin: 3179, province: '湖北', name: '巴东综合', rawName: '巴东综合频道' },
  { pid: 3567, uin: 3179, province: '湖北', name: '咸丰综合', rawName: '咸丰综合频道' },
  { pid: 3612, uin: 1936, province: '湖北', name: '荆门新闻综合', rawName: '荆门新闻' },
  // 湖南
  { pid: 346, uin: 1648, province: '湖南', name: '长沙新闻综合', rawName: '长沙新闻综合频道' },
  { pid: 348, uin: 1648, province: '湖南', name: '长沙政法', rawName: '长沙政法频道' },
  { pid: 1788, uin: 3275, province: '湖南', name: '浏阳电视台', rawName: '浏阳电视台' },
  { pid: 1699, uin: 2193, province: '湖南', name: '岳阳新闻综合', rawName: '岳阳新闻频道' },
  { pid: 1701, uin: 2193, province: '湖南', name: '岳阳文旅都市', rawName: '岳阳文旅都市频道' },
  { pid: 2053, uin: 1366, province: '湖南', name: '株洲新闻综合', rawName: '电视新闻综合频道' },
  { pid: 1724, uin: 1632, province: '湖南', name: '南县新闻', rawName: '南县新闻频道' },
  { pid: 3088, uin: 4100, province: '湖南', name: '宜章新闻综合', rawName: '宜章新闻综合频道' },
  // 江西
  { pid: 2574, uin: 3313, province: '江西', name: '鹰潭新闻综合', rawName: '电视新闻综合频道' },
  // 江苏
  { pid: 2778, uin: 1610, province: '江苏', name: '淮安综合', rawName: '综合频道' },
  { pid: 3177, uin: 1812, province: '江苏', name: '新沂综合', rawName: '新沂融媒-综合频道' },
  // 浙江
  { pid: 1181, uin: 1482, province: '浙江', name: '富阳新闻综合', rawName: '富阳电视台新闻综合频道' },
  { pid: 2513, uin: 3767, province: '浙江', name: '临平新闻', rawName: '临平新闻直播' },
  { pid: 187, uin: 1176, province: '浙江', name: '建德综合', rawName: '建德电视台综合频道',
    logo: `${OSS}/1176/program/20171220/4e5c424ebc401c6b3cc23f5b112d15de.jpg` },
  { pid: 170, uin: 1356, province: '浙江', name: '乐清综合', rawName: 'YQTV-1' },
  { pid: 171, uin: 1356, province: '浙江', name: '乐清新闻', rawName: 'YQTV' },
  { pid: 1335, uin: 2768, province: '浙江', name: '永嘉新闻综合', rawName: '永嘉电视台新闻综合频道' },
  { pid: 911, uin: 1639, province: '浙江', name: '温岭新闻综合', rawName: '温岭广播电视台新闻综合频道 正在直播' },
  { pid: 1287, uin: 1639, province: '浙江', name: '温岭民生休闲', rawName: '温岭广播电视台民生休闲频道 正在直播' },
  { pid: 1603, uin: 2515, province: '浙江', name: '仙居新闻综合', rawName: '仙居新闻综合' },
  { pid: 1361, uin: 2840, province: '浙江', name: '新昌新闻', rawName: '新闻频道' },
  { pid: 1362, uin: 2840, province: '浙江', name: '新昌生活', rawName: '生活频道' },
  { pid: 1423, uin: 1329, province: '浙江', name: '宁海新闻综合', rawName: '宁海新闻综合频道' },
  { pid: 3152, uin: 3512, province: '浙江', name: '奉化新闻综合', rawName: '新闻综合频道' },
  { pid: 1499, uin: 1253, province: '浙江', name: '安吉新闻综合', rawName: '新闻综合频道' },
  { pid: 3711, uin: 4099, province: '浙江', name: '金华新闻综合', rawName: '新闻综合频道直播（勿删）' },
  { pid: 1796, uin: 3071, province: '浙江', name: '义乌新闻', rawName: '新闻频道' },
  { pid: 2133, uin: 3071, province: '浙江', name: '义乌商贸', rawName: '商贸频道' },
  { pid: 3090, uin: 3071, province: '浙江', name: '义乌文艺', rawName: '文艺频道' },
  { pid: 1511, uin: 1043, province: '浙江', name: '桐乡新闻综合', rawName: '桐乡新闻综合频道' },
  // 福建
  { pid: 699, uin: 1945, province: '福建', name: '福清综合', rawName: '福清电视台综合频道',
    logo: `${OSS}/1945/program/20190107/c8d5b6c037b52d4b0f7a6d903ea967b5.png` },
  { pid: 2068, uin: 2656, province: '福建', name: '闽侯综合', rawName: '闽侯电视台综合频道' },
  { pid: 907, uin: 1118, province: '福建', name: '平潭新闻综合', rawName: '平潭新闻综合',
    logo: `${OSS}/1118/program/20181222/8096d6afba6530dcc6bdb248abed4d53.jpeg` },
  { pid: 908, uin: 1118, province: '福建', name: '平潭旅游文化', rawName: '平潭旅游文化',
    logo: `${OSS}/1118/program/20181222/1bdace79bf9b193d5462b76d351b2911.jpeg` },
  { pid: 2597, uin: 3454, province: '福建', name: '永安综合', rawName: '永安综合' },
  { pid: 425, uin: 1567, province: '福建', name: '沙县综合', rawName: '沙县综合' },
  { pid: 765, uin: 2055, province: '福建', name: '尤溪综合', rawName: '尤溪综合频道' },
  { pid: 2333, uin: 3708, province: '福建', name: '泉港一套', rawName: '泉港一套' },
  { pid: 1792, uin: 2311, province: '福建', name: '永春综合', rawName: '永春频道直播' },
  { pid: 3102, uin: 4113, province: '福建', name: '集美综合', rawName: '集美综合频道' },
  // 广东
  { pid: 643, uin: 1629, province: '广东', name: '信宜综合', rawName: '信宜综合',
    logo: `${OSS}/1629/program/20190102/97774048f4467a1736149e6220e0af78.jpeg` },
  // 广西
  { pid: 1902, uin: 3370, province: '广西', name: '柳州新闻综合', rawName: '柳州新闻综合频道' },
  { pid: 1808, uin: 3370, province: '广西', name: '柳州科教', rawName: '柳州科教频道' },
  { pid: 3289, uin: 4042, province: '广西', name: '玉林新闻综合', rawName: 'ylzh' },
  // 贵州
  { pid: 3043, uin: 4088, province: '贵州', name: '印江电视台', rawName: '印江电视台直播' },
  // 四川
  { pid: 1670, uin: 1822, province: '四川', name: '南江电视台', rawName: '电视直播' },
  { pid: 3686, uin: 3277, province: '四川', name: '绵竹电视台', rawName: '绵竹电视直播信号-备线' },
  { pid: 391, uin: 1743, province: '四川', name: '射洪综合', rawName: '射洪综合',
    logo: `${OSS}/1743/program/20180516/ce4811feb929758b2d46329fc6d59d56.png` },
  // 新疆
  { pid: 2229, uin: 3643, province: '新疆', name: '阿克苏汉语综合', rawName: '汉语综合频道' },
  { pid: 2233, uin: 3643, province: '新疆', name: '阿克苏维语综合', rawName: '维吾尔语综合频道' },
  { pid: 2234, uin: 3643, province: '新疆', name: '阿克苏党员教育', rawName: '党员远程教育频道' },
  { pid: 3377, uin: 4239, province: '新疆', name: '布尔津哈萨克语', rawName: '布尔津县哈萨克语频道' },
  // 海南
  { pid: 1330, uin: 1669, province: '海南', name: '儋州电视台', rawName: '儋州台' },
  // —— 2026-10-24 扫描直播间号 1～4100 后新增：在推流、截帧确认是电视台（新乡公共停推，同租户一并收）——
  { pid: 64, uin: 1114, province: '湖北', name: '孝感新闻', rawName: '孝感新闻频道' },
  { pid: 3683, uin: 1114, province: '湖北', name: '孝感生活', rawName: '孝感生活频道' },
  { pid: 2199, uin: 2013, province: '湖北', name: '监利综合', rawName: '综合频道' },
  { pid: 3724, uin: 3179, province: '湖北', name: '恩施综合', rawName: '恩施综合频道' },
  { pid: 3831, uin: 1887, province: '湖北', name: '阳新综合', rawName: '阳新综合频道' },
  { pid: 3947, uin: 4736, province: '湖北', name: '房县综合', rawName: '房县综合频道' },
  { pid: 3820, uin: 3659, province: '湖北', name: '郧阳电视台', rawName: '郧阳电视' },
  { pid: 1185, uin: 1324, province: '浙江', name: '兰溪新闻综合', rawName: '兰溪新闻综合频道' },
  { pid: 2747, uin: 3568, province: '浙江', name: '临安电视台', rawName: '临安电视台' },
  { pid: 3566, uin: 1163, province: '浙江', name: '桐庐综合', rawName: '桐庐电视台综合频道' },
  { pid: 3697, uin: 1346, province: '浙江', name: '慈溪新闻综合', rawName: '电视直播丨慈溪新闻综合频道' },
  { pid: 4051, uin: 1358, province: '浙江', name: '永康新闻综合', rawName: '新闻综合频道' },
  { pid: 4050, uin: 1358, province: '浙江', name: '永康华溪', rawName: '华溪频道' },
  { pid: 1343, uin: 2502, province: '湖南', name: '道县综合', rawName: '道县综合频道' },
  { pid: 2134, uin: 1366, province: '湖南', name: '株洲公共', rawName: '电视公共频道' },
  { pid: 3830, uin: 1648, province: '湖南', name: '长沙文旅', rawName: '长沙文旅频道' },
  { pid: 3991, uin: 4802, province: '湖南', name: '湘西综合', rawName: '湘西综合' },
  { pid: 3990, uin: 4802, province: '湖南', name: '湘西文化旅游', rawName: '文化旅游' },
  { pid: 356, uin: 1648, province: '湖南', name: '长沙移动电视', rawName: '长沙移动电视' },
  { pid: 2803, uin: 3350, province: '福建', name: '漳浦综合', rawName: '漳浦综合频道' },
  { pid: 3952, uin: 4744, province: '福建', name: '霞浦新闻', rawName: '霞浦新闻' },
  { pid: 175, uin: 1116, province: '福建', name: '漳州新闻综合', rawName: '漳视一套在线直播' },
  { pid: 2201, uin: 2593, province: '安徽', name: '蚌埠新闻', rawName: '蚌埠新闻传媒中心——新闻频道' },
  { pid: 3216, uin: 1469, province: '安徽', name: '阜南新闻综合', rawName: '阜南新闻综合频道' },
  { pid: 3886, uin: 1610, province: '江苏', name: '淮安公共', rawName: '公共频道' },
  { pid: 3706, uin: 4436, province: '河南', name: '新乡新闻综合', rawName: '新乡新闻综合' },
  { pid: 3708, uin: 4436, province: '河南', name: '新乡公共', rawName: '新乡公共频道' },
  { pid: 3817, uin: 2562, province: '河北', name: '饶阳综合', rawName: '饶阳融媒综合频道' },
  { pid: 1434, uin: 1132, province: '广东', name: '开平综合', rawName: '开平综合频道' },
  { pid: 4007, uin: 4814, province: '贵州', name: '贵阳新闻综合', rawName: '贵阳新闻综合频道' },
  { pid: 3366, uin: 4239, province: '新疆', name: '布尔津汉语', rawName: '布尔津汉语频道' },
  // —— 慢直播：各地融媒体中心的固定机位（路口、广场、景区、江河），统一放「慢直播」分组 ——
  { pid: 1356, uin: 2768, province: '浙江', group: '慢直播', name: '永嘉风光轮播', rawName: 'OBS轮播画面' },
  { pid: 1616, uin: 3177, province: '福建', group: '慢直播', name: '福鼎太姥大道环岛路段', rawName: '太姥大道环岛路段' },
  { pid: 1889, uin: 1717, province: '福建', group: '慢直播', name: '安溪实验小学路口', rawName: 'APP监控实验小学路口' },
  { pid: 1934, uin: 1717, province: '福建', group: '慢直播', name: '安溪政府路口', rawName: 'APP监控政府路口' },
  { pid: 1935, uin: 1717, province: '福建', group: '慢直播', name: '安溪南门大桥', rawName: 'APP监控南门大桥' },
  { pid: 1937, uin: 1717, province: '福建', group: '慢直播', name: '安溪北石高速路口', rawName: 'APP监控北石高速路口' },
  { pid: 2006, uin: 3165, province: '湖北', group: '慢直播', name: '蔡甸广场', rawName: '慢直播丨蔡甸广场' },
  { pid: 2007, uin: 3165, province: '湖北', group: '慢直播', name: '蔡甸后官湖湿地公园', rawName: '慢直播丨后官湖湿地公园' },
  { pid: 2008, uin: 3165, province: '湖北', group: '慢直播', name: '蔡甸高速出入口', rawName: '慢直播丨蔡甸高速出入口' },
  { pid: 2109, uin: 3277, province: '四川', group: '慢直播', name: '绵竹回澜大道路口', rawName: '画境绵竹' },
  { pid: 2336, uin: 1364, province: '安徽', group: '慢直播', name: '砀山和美乡村直播间', rawName: '砀山县和美乡村直播间' },
  { pid: 2429, uin: 2311, province: '福建', group: '慢直播', name: '永春十里桃源', rawName: '永春县融媒体中心•慢直播•十里桃源' },
  { pid: 2506, uin: 3177, province: '福建', group: '慢直播', name: '福鼎桐江溪畔', rawName: '桐江溪畔' },
  { pid: 2566, uin: 2193, province: '湖南', group: '慢直播', name: '岳阳洞庭南路', rawName: '洞庭南路慢直播' },
  { pid: 2716, uin: 1356, province: '浙江', group: '慢直播', name: '乐清清远路', rawName: '清远路' },
  { pid: 2718, uin: 1356, province: '浙江', group: '慢直播', name: '乐清红绿灯路口', rawName: '乐清日报社红绿灯' },
  { pid: 2737, uin: 1356, province: '浙江', group: '慢直播', name: '乐清南虹广场', rawName: '乐清南虹广场' },
  { pid: 2848, uin: 2311, province: '福建', group: '慢直播', name: '永春全景', rawName: '永春县融媒体中心•慢直播•云看永春' },
  { pid: 2971, uin: 3659, province: '湖北', group: '慢直播', name: '郧阳二桥', rawName: '二桥慢直播' },
  { pid: 3107, uin: 2055, province: '福建', group: '慢直播', name: '尤溪紫阳公园', rawName: '慢直播：紫阳公园' },
  { pid: 3175, uin: 3065, province: '湖北', group: '慢直播', name: '黄石团城山人民广场', rawName: '慢直播-团城山人民广场' },
  { pid: 3181, uin: 1812, province: '江苏', group: '慢直播', name: '新沂新悦广场', rawName: '新悦广场' },
  { pid: 3249, uin: 1206, province: '江苏', group: '慢直播', name: '徐州湖东路入口', rawName: '湖东路入口慢直播（盒子）' },
  { pid: 3250, uin: 1206, province: '江苏', group: '慢直播', name: '徐州云龙湖荷花池', rawName: '云龙湖荷花池慢直播（盒子）' },
  { pid: 3303, uin: 1812, province: '江苏', group: '慢直播', name: '新沂戴斯酒店', rawName: '戴斯酒店' },
  { pid: 3336, uin: 1487, province: '湖北', group: '慢直播', name: '随州一湖两岸', rawName: '随州一湖两岸' },
  { pid: 3339, uin: 1043, province: '浙江', group: '慢直播', name: '桐乡濮院古镇', rawName: '濮院古镇' },
  { pid: 3345, uin: 1043, province: '浙江', group: '慢直播', name: '桐乡信号塔', rawName: '信号塔' },
  { pid: 3346, uin: 1043, province: '浙江', group: '慢直播', name: '桐乡凤凰湖', rawName: '凤凰湖' },
  { pid: 3360, uin: 1043, province: '浙江', group: '慢直播', name: '桐乡乌镇白莲塔', rawName: '乌镇白莲塔' },
  { pid: 3382, uin: 3744, province: '河南', group: '慢直播', name: '许昌科技广场', rawName: '科技广场' },
  { pid: 3383, uin: 3744, province: '河南', group: '慢直播', name: '许昌春秋码头', rawName: '春秋码头' },
  { pid: 3391, uin: 3744, province: '河南', group: '慢直播', name: '许昌曹魏古城', rawName: '曹魏古城' },
  { pid: 3405, uin: 3744, province: '河南', group: '慢直播', name: '许昌云鼎广场', rawName: '云鼎广场' },
  { pid: 3433, uin: 3744, province: '河南', group: '慢直播', name: '许昌金汇广场', rawName: '金汇广场' },
  { pid: 3434, uin: 1487, province: '湖北', group: '慢直播', name: '广水东岳广场', rawName: '广水东岳广场' },
  { pid: 3435, uin: 1487, province: '湖北', group: '慢直播', name: '广水魁星楼', rawName: '广水魁星楼' },
  { pid: 3455, uin: 4101, province: '河北', group: '慢直播', name: '张家口inzone商场', rawName: 'inzone' },
  { pid: 3477, uin: 2311, province: '福建', group: '慢直播', name: '永春五里古街', rawName: '永春县融媒体中心•慢直播•五里古街' },
  { pid: 3512, uin: 3512, province: '浙江', group: '慢直播', name: '奉化林家万亩桃园东', rawName: '林家万亩桃园东' },
  { pid: 3513, uin: 3512, province: '浙江', group: '慢直播', name: '奉化林家桃花南', rawName: '林家桃花南' },
  { pid: 3581, uin: 1163, province: '浙江', group: '慢直播', name: '桐庐富春未来城', rawName: '慢直播丨富春未来城' },
  { pid: 3582, uin: 1163, province: '浙江', group: '慢直播', name: '桐庐富春江一桥', rawName: '慢直播丨富春江一桥' },
  { pid: 3583, uin: 1163, province: '浙江', group: '慢直播', name: '桐庐春江两岸', rawName: '慢直播丨春江两岸' },
  { pid: 3584, uin: 1163, province: '浙江', group: '慢直播', name: '桐庐迎春南路', rawName: '慢直播丨迎春南路' },
  { pid: 3588, uin: 3350, province: '福建', group: '慢直播', name: '漳浦绥安鹿溪点', rawName: '慢直播绥安鹿溪点' },
  { pid: 3589, uin: 3350, province: '福建', group: '慢直播', name: '漳浦大峰山', rawName: '慢直播大峰山' },
  { pid: 3591, uin: 3350, province: '福建', group: '慢直播', name: '漳浦深土', rawName: '慢直播深土' },
  { pid: 3592, uin: 3350, province: '福建', group: '慢直播', name: '漳浦官浔', rawName: '慢直播官浔' },
  { pid: 3609, uin: 3796, province: '新疆', group: '慢直播', name: '阿克苏原七中', rawName: '阿克苏市慢直播摄像头03 - 原七中（三期）' },
  { pid: 3617, uin: 4087, province: '湖北', group: '慢直播', name: '鄂州城市俯瞰', rawName: '鄂州视点' },
  { pid: 3639, uin: 3796, province: '新疆', group: '慢直播', name: '阿克苏广场', rawName: '阿克苏市慢直播摄像头05  - 广场' },
  { pid: 3670, uin: 1812, province: '江苏', group: '慢直播', name: '新沂体育中心', rawName: '体育中心' },
  { pid: 3672, uin: 1425, province: '河北', group: '慢直播', name: '武强音乐公园', rawName: '音乐公园慢直播' },
  { pid: 3710, uin: 1629, province: '广东', group: '慢直播', name: '信宜风光', rawName: '大美信宜！' },
  { pid: 3714, uin: 1425, province: '河北', group: '慢直播', name: '武强音乐小镇', rawName: '音乐小镇慢直播' },
  { pid: 3815, uin: 2193, province: '湖南', group: '慢直播', name: '岳阳洞庭南路二', rawName: '洞庭南路慢直播2' },
  { pid: 3819, uin: 2756, province: '广东', group: '慢直播', name: '珠海金湾', rawName: '金湾慢直播' },
  { pid: 3844, uin: 1545, province: '江苏', group: '慢直播', name: '如皋龙游河风景区', rawName: '如皋龙游河风景区' },
  { pid: 3845, uin: 1545, province: '江苏', group: '慢直播', name: '如皋奥体中心', rawName: '如皋市奥体中心' },
  { pid: 3853, uin: 3744, province: '河南', group: '慢直播', name: '许昌灞陵桥景区运粮河', rawName: '灞陵桥景区运粮河' },
  { pid: 3858, uin: 1545, province: '江苏', group: '慢直播', name: '如皋标龙', rawName: '标龙' },
  { pid: 3859, uin: 1545, province: '江苏', group: '慢直播', name: '如皋火车站', rawName: '火车站' },
  { pid: 3860, uin: 1545, province: '江苏', group: '慢直播', name: '如皋钟楼', rawName: '钟楼' },
  { pid: 3861, uin: 1545, province: '江苏', group: '慢直播', name: '如皋月星家居', rawName: '月星家居' },
  { pid: 3865, uin: 1545, province: '江苏', group: '慢直播', name: '如皋奥体中心特写', rawName: '奥体细节像机' },
  { pid: 3869, uin: 3744, province: '河南', group: '慢直播', name: '许昌灞陵桥红石影壁', rawName: '灞陵桥红石影壁' },
  { pid: 3870, uin: 3744, province: '河南', group: '慢直播', name: '许昌灞凌桥入门处内西', rawName: '灞凌桥入门处内西' },
  { pid: 3872, uin: 3744, province: '河南', group: '慢直播', name: '许昌关羽桥', rawName: '关羽桥' },
  { pid: 3874, uin: 3744, province: '河南', group: '慢直播', name: '许昌春秋楼问安亭', rawName: '春秋楼问安亭' },
  { pid: 3875, uin: 3744, province: '河南', group: '慢直播', name: '许昌春秋楼', rawName: '春秋楼' },
  { pid: 3887, uin: 3744, province: '河南', group: '慢直播', name: '许昌七一路时代广场', rawName: '七一路时代广场' },
  { pid: 3889, uin: 3744, province: '河南', group: '慢直播', name: '许昌胖东来天使城', rawName: '胖东来天使城' },
  { pid: 3890, uin: 1487, province: '湖北', group: '慢直播', name: '随州文化公园', rawName: '文化公园' },
  { pid: 3892, uin: 3744, province: '河南', group: '慢直播', name: '许昌西站', rawName: '许昌西站' },
  { pid: 3900, uin: 3744, province: '河南', group: '慢直播', name: '许昌春水桥', rawName: '春水桥' },
  { pid: 3903, uin: 3744, province: '河南', group: '慢直播', name: '许昌莲花湾', rawName: '莲花湾' },
  { pid: 3906, uin: 3744, province: '河南', group: '慢直播', name: '许昌南关桥西', rawName: '南关桥西' },
  { pid: 3907, uin: 3744, province: '河南', group: '慢直播', name: '许昌中立交', rawName: '中立交' },
  { pid: 3909, uin: 3744, province: '河南', group: '慢直播', name: '许昌京港澳高速许昌站', rawName: '京港澳高速许昌站' },
  { pid: 3911, uin: 3744, province: '河南', group: '慢直播', name: '许昌西湖公园', rawName: '西湖公园' },
  { pid: 3913, uin: 3744, province: '河南', group: '慢直播', name: '许昌望仙桥', rawName: '望仙桥' },
  { pid: 3942, uin: 3566, province: '江苏', group: '慢直播', name: '连云港云海观日', rawName: '云海观日' },
  { pid: 3960, uin: 4736, province: '湖北', group: '慢直播', name: '房县慢直播', rawName: '慢直播-主' },
  { pid: 3966, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩河滨广场', rawName: '河滨广场' },
  { pid: 3968, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩风雨桥', rawName: '风雨桥' },
  { pid: 3969, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩城市阳台', rawName: '城市阳台' },
  { pid: 3972, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩寨遇广场', rawName: '寨遇广场' },
  { pid: 3988, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩七姊妹山', rawName: '七姊妹山' },
  { pid: 4002, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩贡秀', rawName: '贡秀' },
  { pid: 4021, uin: 3796, province: '新疆', group: '慢直播', name: '阿克苏城市全景', rawName: '实时直播 丨 云赏阿克苏市' },
  { pid: 4022, uin: 1130, province: '湖北', group: '慢直播', name: '江夏中央大公园', rawName: '中央大公园' },
  { pid: 4024, uin: 2756, province: '广东', group: '慢直播', name: '珠海金湾二', rawName: '金湾慢直播-1' },
  { pid: 4031, uin: 4398, province: '福建', group: '慢直播', name: '武夷山', rawName: '武夷山' },
  { pid: 4034, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩大桥', rawName: '大桥' },
  { pid: 4035, uin: 4096, province: '湖北', group: '慢直播', name: '宣恩狮子关', rawName: '狮子关' },
  { pid: 4041, uin: 3566, province: '江苏', group: '慢直播', name: '连云港大沙湾', rawName: '大沙湾' },
]

export const CHANNELS = Object.freeze(rows.map(row => Object.freeze({
  ...row,
  // 慢直播统一一个分组；电视台按省归组，标了 city 的放「省-市」分组（目前只有山东）
  group: row.group || (row.city ? `${row.province}-${row.city}` : row.province),
  key: `${row.pid}-${row.uin}`,
  ref: `gdy-${row.pid}-${row.uin}`,
})))

export const CHANNEL_BY_REF = new Map(CHANNELS.map(row => [row.ref, row]))
export const CHANNEL_BY_KEY = new Map(CHANNELS.map(row => [row.key, row]))

/** 按省拆模块用的 id 后缀（guangdianyun-<拼音>）；顺序即频道表里省份第一次出现的顺序，也是后台模块顺序 */
export const PROVINCE_IDS = Object.freeze({
  北京: 'beijing', 黑龙江: 'heilongjiang', 辽宁: 'liaoning', 河北: 'hebei', 山西: 'shanxi',
  山东: 'shandong', 安徽: 'anhui', 河南: 'henan', 湖北: 'hubei', 湖南: 'hunan',
  江西: 'jiangxi', 江苏: 'jiangsu', 浙江: 'zhejiang', 福建: 'fujian', 广东: 'guangdong',
  广西: 'guangxi', 贵州: 'guizhou', 四川: 'sichuan', 新疆: 'xinjiang', 海南: 'hainan',
})

/** 输出时分组的先后：电视台的省份按频道表里第一次出现的顺序，「慢直播」放最后 */
export const SLOW_GROUP = '慢直播'
export const GROUPS = [...new Set(CHANNELS.filter(row => row.group !== SLOW_GROUP).map(row => row.group)), SLOW_GROUP]
