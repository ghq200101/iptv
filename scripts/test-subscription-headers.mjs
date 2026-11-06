#!/usr/bin/env node
/**
 * 订阅地址响应头回归测试（issue #30 / #201）。
 *
 * 不变量（向 GitHub raw 的 .m3u 看齐，飞牛影视能导入的就是它）：
 * 1. 订阅正文按 text/plain + nosniff 返回（节目单为 text/xml），/interface.m3u 与 /m3u 带同名 inline 文件名；
 * 2. 订阅正文带 Access-Control-Allow-Origin: *，网页端从浏览器里取订阅不会被跨域拦下；
 * 3. 跨域头不放宽访问控制：设了密码时缺密码前缀仍 403，拒绝响应不带跨域头。
 * 经真实 HTTP 入口验证。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PASS = 'subpass'
const DATA_DIR = mkdtempSync(join(tmpdir(), 'iptv-subscription-headers-'))

async function freePort() {
  const probe = http.createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const selected = probe.address().port
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  return selected
}

const PORT = await freePort()

// 项目模块会在 import 时读取这些值，必须先设置。空白模式让 app 启动回调不抓远端源。
process.env.mdataDir = DATA_DIR
process.env.mport = String(PORT)
process.env.mpass = PASS
process.env.mblank = 'true'
process.env.mbuiltInSourcesUrl = ''
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost'

writeFileSync(join(DATA_DIR, 'external-sources.json'), JSON.stringify({ enabled: false, updateOnStartup: false, sources: [] }))
// 空白模式启动的那一轮更新可能还没写盘，先放好最小的订阅与节目单
writeFileSync(join(DATA_DIR, 'interface.txt'), '#EXTM3U\n#EXTINF:-1 tvg-name="测试台" group-title="测试",测试台\nhttp://example.com/1.m3u8\n')
writeFileSync(join(DATA_DIR, 'interfaceTXT.txt'), '测试,#genre#\n测试台,http://example.com/1.m3u8\n')
writeFileSync(join(DATA_DIR, 'playback.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<tv></tv>\n')

function request(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: { Host: `127.0.0.1:${PORT}`, Connection: 'close', ...headers },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitForApp() {
  let lastError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await request('/favicon.ico')
      if (response.status === 200) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw lastError || new Error('app.js 未开始监听')
}

let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✅ ${name}`)
}

const PLAYLISTS = ['/', '/interface.m3u', '/m3u', '/txt', '/interface.txt']
// 网页端取订阅时浏览器会带上来源页
const FROM_WEB = { Origin: 'http://192.168.31.144:5666' }

console.log('订阅地址响应头回归测试')

try {
  await import('../app.js')
  await waitForApp()

  await check('★ 订阅与节目单正文带 Access-Control-Allow-Origin: *（issue #201）', async () => {
    for (const path of [...PLAYLISTS, '/playback.xml']) {
      const response = await request(`/${PASS}${path}`, { headers: FROM_WEB })
      assert.equal(response.status, 200, path)
      assert.equal(response.headers['access-control-allow-origin'], '*', path)
    }
  })

  await check('订阅按 text/plain + nosniff 返回，节目单为 text/xml', async () => {
    for (const path of PLAYLISTS) {
      const response = await request(`/${PASS}${path}`)
      assert.equal(response.headers['content-type'], 'text/plain;charset=UTF-8', path)
      assert.equal(response.headers['x-content-type-options'], 'nosniff', path)
    }
    const epg = await request(`/${PASS}/playback.xml`)
    assert.equal(epg.headers['content-type'], 'text/xml;charset=UTF-8')
  })

  await check('/interface.m3u 与 /m3u 带同名 inline 文件名，内容一致', async () => {
    const alias = await request(`/${PASS}/interface.m3u`)
    const plain = await request(`/${PASS}/m3u`)
    for (const response of [alias, plain]) {
      assert.equal(response.headers['content-disposition'], 'inline; filename="interface.m3u"')
    }
    assert.ok(alias.body.equals(plain.body))
  })

  await check('HEAD 探测同样带跨域头', async () => {
    const head = await request(`/${PASS}/interface.m3u`, { method: 'HEAD', headers: FROM_WEB })
    assert.equal(head.status, 200)
    assert.equal(head.headers['access-control-allow-origin'], '*')
    assert.equal(head.body.length, 0)
  })

  await check('跨域头不放宽访问控制：缺密码前缀仍 403，且不带跨域头', async () => {
    for (const path of ['/interface.m3u', '/m3u', '/txt', '/playback.xml']) {
      const response = await request(path, { headers: FROM_WEB })
      assert.equal(response.status, 403, path)
      assert.equal(response.headers['access-control-allow-origin'], undefined, path)
    }
  })

  console.log(`\n全部通过 (${passed} 项)`)
  rmSync(DATA_DIR, { recursive: true, force: true })
  process.exit(0)
} catch (error) {
  console.error(error)
  rmSync(DATA_DIR, { recursive: true, force: true })
  process.exit(1)
}
