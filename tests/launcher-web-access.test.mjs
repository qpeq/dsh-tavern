import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveServiceWebUrl } from '../bin/dsh-tavern.mjs'
import { webUrlFromLogChunk } from '../bin/service-lifecycle.mjs'
import { lanWebUrls, resolveBindHost } from '../bin/launcher-environment.mjs'

const execute = promisify(execFile)
const launcher = fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url))

test('仅使用本次启动的链接，验证 token 且不跟随跳转', async () => {
  const old = '旧日志\ndsh web: http://127.0.0.1:3081/?token=old\n'
  const fresh = 'dsh web: http://127.0.0.1:3081/?token=fresh\r\n'
  const calls = []
  const result = await resolveServiceWebUrl({
    port: 3081, log: Buffer.from(old + fresh), record: { logOffset: Buffer.byteLength(old) },
    request: async (url, options) => {
      calls.push(url)
      assert.equal(options.redirect, 'manual')
      return { status: 303 }
    },
  })
  assert.equal(result, 'http://127.0.0.1:3081/?token=fresh')
  assert.deepEqual(calls, [result])
})

test('旧 token、缺失链接和错误来源不冒充有效访问地址；无鉴权旧版仍可用', async () => {
  for (const candidate of ['', 'http://127.0.0.1:3081/?token=expired', 'https://example.com/?token=secret', 'http://127.0.0.1:9999/?token=other']) {
    const calls = []
    assert.equal(await resolveServiceWebUrl({
      port: 3081, log: `dsh web: ${candidate}\n`,
      request: async url => { calls.push(url); return { status: 401 } },
    }), '')
    assert.ok(calls.every(url => new URL(url).origin === 'http://127.0.0.1:3081'))
  }
  assert.equal(await resolveServiceWebUrl({ port: 3081, request: async () => ({ status: 200 }) }), 'http://127.0.0.1:3081/')
  assert.equal(await resolveServiceWebUrl({ port: 3081, request: async () => { throw new Error('offline') } }), '')
  const old = 'dsh web: http://127.0.0.1:3081/?token=old\n'
  const calls = []
  await resolveServiceWebUrl({ port: 3081, record: { logOffset: Buffer.byteLength(old) }, log: old,
    request: async url => { calls.push(url); return { status: 401 } },
  })
  assert.deepEqual(calls, ['http://127.0.0.1:3081/'])
})

test('实际 CLI 的 status、重复 start、open 都使用当前链接；过期链接不打开', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-web-access-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const server = http.createServer((req, res) => {
    const accepted = new URL(req.url, 'http://local').searchParams.get('token') === 'current-test-token'
    res.writeHead(accepted ? 303 : 401, accepted ? { location: '/' } : {})
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/?token=current-test-token`
  const logs = path.join(root, 'logs')
  const profile = path.join(root, 'profiles/tavern')
  const mocks = path.join(root, 'bin')
  await Promise.all([mkdir(logs), mkdir(profile, { recursive: true }), mkdir(mocks)])
  await writeFile(path.join(profile, 'package.json'), '{}')
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]')
  await writeFile(path.join(logs, 'tavern.frontend-bootstrap.json'), '{"version":2}')
  await writeFile(path.join(logs, 'tavern.pid.json'), JSON.stringify({ pid: process.pid, port, logOffset: 0 }))
  await writeFile(path.join(logs, 'tavern.log'), `dsh web: ${url}\n`)
  const opened = path.join(root, 'opened-url')
  await writeFile(path.join(mocks, process.platform === 'darwin' ? 'open' : 'xdg-open'), '#!/bin/sh\nprintf "%s" "$1" > "$TAVERN_TEST_OPENED"\n', { mode: 0o755 })
  const env = { ...process.env, DSH_HOME: root, DSH_TAVERN_CLI_HOME: root, DSH_TAVERN_PORT: String(port), PATH: `${mocks}:${process.env.PATH}`, TAVERN_TEST_OPENED: opened }
  const run = (action, overrides = {}) => execute(process.execPath, [launcher, action], { env: { ...env, ...overrides }, timeout: 10000 })
  for (const action of ['status', 'start', 'open']) {
    const { stdout } = await run(action)
    assert.ok(stdout.includes(url), action)
    assert.match(stdout, /请勿分享/)
  }
  let actual = ''
  for (let i = 0; i < 50 && !actual; i++) {
    try { actual = await readFile(opened, 'utf8') } catch {}
    if (!actual) await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(actual, url)
  await rm(opened)
  const opener = path.join(mocks, process.platform === 'darwin' ? 'open' : 'xdg-open')
  await writeFile(opener, '#!/bin/sh\nexit 7\n', { mode: 0o755 })
  await assert.rejects(run('open'), error => error.code === 1 && /无法自动打开浏览器/.test(error.stderr))
  const bootstrapFile = path.join(logs, 'tavern.frontend-bootstrap.json')
  await rm(bootstrapFile)
  const failedStart = await run('start', { DSH_TAVERN_NO_OPEN: '0' })
  assert.match(failedStart.stderr, /无法自动打开浏览器/)
  await assert.rejects(readFile(bootstrapFile), { code: 'ENOENT' })
  await writeFile(opener, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  await run('start', { DSH_TAVERN_NO_OPEN: '0' })
  assert.ok(JSON.parse(await readFile(bootstrapFile, 'utf8')).version > 0)
  await writeFile(opener, '#!/bin/sh\nsleep 6\n', { mode: 0o755 })
  await assert.rejects(run('open'), error => error.code === 1 && /等待系统响应超时/.test(error.stderr))
  await rm(opener)
  await assert.rejects(run('open', { PATH: mocks }), error => error.code === 1 && /无法自动打开浏览器/.test(error.stderr))
  await writeFile(path.join(logs, 'tavern.log'), `dsh web: http://127.0.0.1:${port}/?token=expired\n`)
  const { stdout } = await run('status')
  assert.match(stdout, /尚未取得有效/)
  assert.ok(!stdout.includes('token=expired'))
  await assert.rejects(run('open'), error => error.code === 1 && error.stdout.includes('尚未取得有效'))
  await assert.rejects(readFile(opened), { code: 'ENOENT' })
})

test('DSH_TAVERN_BIND: loopback by default, any IPv4 address means all interfaces', () => {
  for (const value of [undefined, '', ' ', '127.0.0.1', 'localhost']) assert.equal(resolveBindHost(value), '127.0.0.1')
  for (const value of ['0.0.0.0', '192.168.1.113', ' 10.0.0.2 ']) assert.equal(resolveBindHost(value), '0.0.0.0')
  for (const value of ['example.com', '192.168.1.300', '::', '1.2.3']) assert.throws(() => resolveBindHost(value), /DSH_TAVERN_BIND/)
})

test('the token URL is still found when the runtime appends its LAN URL', () => {
  const log = 'dsh web: http://127.0.0.1:3081/?token=t1 (LAN: http://192.168.1.113:3081/?token=t1)\n'
  assert.equal(webUrlFromLogChunk(log), 'http://127.0.0.1:3081/?token=t1')
})

test('LAN URLs: the named address, or with 0.0.0.0 one per external IPv4 address', () => {
  const interfaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.113' }, { family: 'IPv6', internal: false, address: 'fe80::1' }],
  }
  const url = 'http://127.0.0.1:3081/?token=t1'
  assert.deepEqual(lanWebUrls(url, '0.0.0.0', interfaces), ['http://192.168.1.113:3081/?token=t1'])
  assert.deepEqual(lanWebUrls(url, '127.0.0.1', interfaces), [])
  assert.deepEqual(lanWebUrls(url, undefined, interfaces), [])
  assert.deepEqual(lanWebUrls(url, '192.168.1.113', { ...interfaces, docker0: [{ family: 'IPv4', internal: false, address: '172.18.0.1' }] }),
    ['http://192.168.1.113:3081/?token=t1'])
  assert.deepEqual(lanWebUrls('', '0.0.0.0', interfaces), [])
})
