// 从新版品牌 PNG 生成标签页、收藏夹与主屏幕图标：node scripts/generate-icons.mjs
// 可用 PUPPETEER_EXECUTABLE_PATH 指定本机 Chrome，不需要新增运行依赖。
import { readFileSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer'

const directory = new URL('../web/icons/', import.meta.url)
const source = readFileSync(new URL('brand-logo.png', directory)).toString('base64')
const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  async function render(size, appearance = 'light') {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: appearance }])
    await page.setContent(`<style>html,body{margin:0;background:transparent}canvas{display:block}</style><canvas width="${size}" height="${size}"></canvas>`)
    await page.evaluate(async ({ source, size }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${source}`
      await image.decode()
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = image.width
      sourceCanvas.height = image.height
      const ctx = sourceCanvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data
      let left = image.width, top = image.height, right = 0, bottom = 0
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] > 16) {
          left = Math.min(left, x); top = Math.min(top, y)
          right = Math.max(right, x); bottom = Math.max(bottom, y)
        }
      }
      const edge = Math.max(right - left + 1, bottom - top + 1)
      const output = document.querySelector('canvas').getContext('2d')
      output.imageSmoothingQuality = 'high'
      output.drawImage(image, (left + right + 1 - edge) / 2, (top + bottom + 1 - edge) / 2, edge, edge, 0, 0, size, size)
    }, { source, size })
    return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true }))
  }

  // ICO 目录内嵌各尺寸的 PNG，避免放大小图造成模糊。
  const sizes = [16, 32, 48, 64]
  const frames = []
  for (const size of sizes) frames.push(await render(size))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16
    header[entry] = header[entry + 1] = sizes[i]
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frames[i].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += frames[i].length
  }
  writeFileSync(new URL('favicon.ico', directory), Buffer.concat([header, ...frames]))
  writeFileSync(new URL('apple-touch-icon.png', directory), await render(180))
  writeFileSync(new URL('icon-512.png', directory), await render(512))
  writeFileSync(new URL('icon-dark-512.png', directory), await render(512, 'dark'))
  console.log('IPTV 图标已生成：ICO (16/32/48/64)、Apple Touch (180)、浅色与深色预览 (512)')
} finally {
  await browser.close()
}
