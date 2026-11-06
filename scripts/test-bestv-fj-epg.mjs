#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createProvider, parseProgrammes } from '../extractors/bestv-fj/epg.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/bestv-fj/programs.json', import.meta.url)))
const rows = parseProgrammes(fixture, '20261029')
assert.equal(rows.length, 5)
assert.ok(rows.every(p => p.start >= Date.parse('2026-10-29T00:00:00+08:00') && p.stop > p.start))
assert.equal(rows[0].title, fixture.programs[0].name)
assert.deepEqual(parseProgrammes(fixture, '20260101'), [])
assert.deepEqual(parseProgrammes({ programs: [] }, '20261029'), [])
assert.throws(() => parseProgrammes({}, '20261029'))
assert.throws(() => parseProgrammes(fixture, 'bad'))
assert.deepEqual(parseProgrammes({ programs: [{ name: '精彩节目', startTime: 1793203200, endTime: 1793206800 }, { name: '', startTime: 0, endTime: 0 }] }, '20261029'), [])
assert.equal(parseProgrammes({ programs: [...fixture.programs, ...fixture.programs] }, '20261029').length, 5)
const overnight = parseProgrammes({ programs: [{ name: '跨夜节目', startTime: 1793202900, endTime: 1793203500 }] }, '20261029')
assert.equal(overnight[0].start, 1793203200000)
const overlap = parseProgrammes({ programs: [
  { name: '旧编排', startTime: 1793203200, endTime: 1793206800 },
  { name: '新编排', startTime: 1793203200, endTime: 1793206800 },
  { name: '下一档', startTime: 1793205000, endTime: 1793208600 },
] }, '20261029')
assert.equal(overlap.length, 2)
assert.equal(overlap[0].title, '新编排')
assert.equal(overlap[0].stop, overlap[1].start)
let calls = 0, time = 0
const provider = createProvider({ now: () => time })
const fetchImpl = async url => { calls++; return new Response(JSON.stringify(url.includes('client-id-by-region') ? { clientID: 'test' } : fixture)) }
await Promise.all(['20261029', '20261030'].map(day => provider.programmes('219', day, { fetchImpl })))
assert.equal(calls, 2, '今明两天共享一次官方跨日编排请求')
time = 301000
await provider.programmes('219', '20261029', { fetchImpl })
assert.equal(calls, 3, '节目单缓存到期重取，clientID 仍有效')
assert.equal(provider.channels().length, 7)
assert.equal(provider.days, 2)
assert.deepEqual(await provider.programmes('205', '20261029', { fetchImpl }), [])
const badFetch = async url => new Response(JSON.stringify(url.includes('client-id-by-region') ? { clientID: 'test' } : {}))
await assert.rejects(provider.programmes('219', '20261029', { fetchImpl: badFetch }))
console.log('百视通官方 EPG：真实编排、北京时间、空表、去重、跨夜与跨日请求缓存均通过')
