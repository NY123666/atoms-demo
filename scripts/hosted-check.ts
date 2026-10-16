/**
 * 托管代理的集成测试：真起 HTTP 服务、真发请求、真读数据流。
 *
 * 为什么不能只做单元测试：这条链路上"看起来对但其实是错的"的地方特别多，
 * 每一条都只有真跑一遍才暴露得出来：
 *   1) 流式是不是**真的**流式 —— 把上游的 ReadableStream 整个读成字符串再包一层，
 *      功能测试照样通过，但用户会盯着转圈等到模型写完最后一段才看到第一个字；
 *   2) 服务端的 Key 有没有漏出去 —— 漏在响应体里、漏在错误信息里都算漏；
 *   3) 客户端指定的 model / max_tokens 有没有被真的丢掉 —— 这是预算的唯一闸门；
 *   4) 配额是不是真的扣了 —— 尤其是"上游报错那次也要扣"这种边角。
 *
 * 上游也是假的（本地起一个 node http 服务），因为真调 DeepSeek 要花钱、还依赖网络。
 * 假上游会把收到的请求体记下来，好断言"服务端到底发了什么过去"。
 *
 * 运行：npm run smoke:hosted
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import process from 'node:process'
import { startDevServer } from '../server/dev.mjs'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const SECRET = 'sk-hosted-upstream-key-do-not-leak'

interface Seen {
  model?: string
  max_tokens?: number
  stream?: boolean
  authorization?: string
  messages?: unknown
  count: number
}

/** 假上游：记下收到的每一个请求，按提示词里的关键词决定怎么回。 */
function startFakeUpstream(): Promise<{ base: string; seen: Seen; close: () => Promise<void>; server: Server }> {
  const seen: Seen = { count: 0 }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    seen.count += 1
    seen.authorization = req.headers.authorization
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw)
    } catch {
      /* 故意的：解析不了就留空对象，断言那边自然会失败 */
    }
    seen.model = body.model as string
    seen.max_tokens = body.max_tokens as number
    seen.stream = body.stream as boolean
    seen.messages = body.messages

    const lastUser = Array.isArray(body.messages)
      ? String((body.messages as Array<Record<string, unknown>>).at(-1)?.content ?? '')
      : ''
    const sse = (payload: string) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

    if (lastUser.includes('BOOM')) {
      // 上游自己挂了，还把 Key 回显在错误体里 —— 专门用来测"错误路径也不泄漏"
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `boom, key was ${SECRET}` } }))
      return
    }

    if (lastUser.includes('HANG')) {
      // 永不响应，用来测超时
      return
    }

    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      sse({ choices: [{ delta: { content: '<html>' } }] })
      await sleep(300)
      sse({ choices: [{ delta: { content: 'ok</html>' } }] })
      await sleep(200)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'chatcmpl-fake',
        choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { total_tokens: 3 },
      }),
    )
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        base: `http://127.0.0.1:${port}/v1`,
        seen,
        server,
        /* closeAllConnections：测超时那一条会故意留下一个"永不响应"的连接，
           不主动断掉的话 server.close() 会一直等它，整个脚本卡死不打印结果。 */
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.()
            server.close(() => r())
          }),
      })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface ChatBody {
  model?: string
  messages: Array<{ role: string; content: string }>
  stream?: boolean
  max_tokens?: number
}

function post(base: string, body: ChatBody, ip = '9.9.9.9'): Promise<Response> {
  return fetch(`${base}/api/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

function health(base: string, ip = '9.9.9.9'): Promise<Response> {
  return fetch(`${base}/api/health`, { headers: { 'x-forwarded-for': ip } })
}

async function main(): Promise<void> {
  const upstream = await startFakeUpstream()
  const env = {
    UPSTREAM_BASE_URL: upstream.base,
    UPSTREAM_API_KEY: SECRET,
    UPSTREAM_MODEL: 'deepseek-chat',
    HOSTED_DAILY_PER_IP: '3',
    HOSTED_DAILY_GLOBAL: '5',
    HOSTED_MAX_PROMPT_CHARS: '200',
    HOSTED_MAX_TOKENS: '100',
    HOSTED_ALLOWED_ORIGINS: '*',
  }
  const proxy = startDevServer({ port: 0, env, log: () => {} })
  const base = await proxy.listen()

  // ---------- 1. /api/health：前端靠它决定要不要把「托管模型」露出来 ----------
  {
    const res = await health(base)
    const body = (await res.json()) as Record<string, unknown>
    ok('health｜返回 200', res.status === 200, `status=${res.status}`)
    ok('health｜content-type 是 JSON', /application\/json/.test(res.headers.get('content-type') || ''))
    ok('health｜ok=true', body.ok === true)
    ok('health｜ready=true（上游有 Key）', body.ready === true)
    ok('health｜回传服务端模型名', body.model === 'deepseek-chat', String(body.model))
    ok('health｜带跨域头', res.headers.get('access-control-allow-origin') === '*')
    ok('health｜回传每人剩余次数', body.remainingForYou === 3, String(body.remainingForYou))
    ok('health｜如实说明限流不共享', body.sharedLimits === false)
    ok('health｜health 本身不消耗配额', body.usedGlobal === 0, String(body.usedGlobal))
  }

  // ---------- 2. 流式转发：真流式 + 强制模型 + 不透 Key ----------
  {
    const started = Date.now()
    const res = await post(base, {
      model: 'gpt-4o-最贵的那个', // 故意传一个别的模型名，必须被服务端丢掉
      messages: [{ role: 'user', content: '做一个待办应用' }],
      stream: true,
      max_tokens: 999999, // 故意要一个巨大的值，必须被压到 HOSTED_MAX_TOKENS
    })
    const ctype = res.headers.get('content-type') || ''
    let firstDeltaAt = -1
    let text = ''
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (firstDeltaAt < 0 && text.includes('<html>')) firstDeltaAt = Date.now() - started
    }
    const totalMs = Date.now() - started

    ok('流式｜状态 200', res.status === 200, `status=${res.status}`)
    ok('流式｜content-type 保持 SSE', /text\/event-stream/.test(ctype), ctype)
    ok('流式｜内容透传完整', text.includes('<html>') && text.includes('ok</html>') && text.includes('[DONE]'))
    ok('流式｜确实是流式（首块早于上游写完）', firstDeltaAt > 0 && firstDeltaAt < 300, `firstDelta=${firstDeltaAt}ms`)
    ok('流式｜没有把整个响应缓存到最后', totalMs > 450, `total=${totalMs}ms`)
    ok('流式｜响应体里没有上游 Key', !text.includes(SECRET) && !text.includes('sk-hosted'))
    ok('流式｜强制使用服务端模型', upstream.seen.model === 'deepseek-chat', String(upstream.seen.model))
    ok('流式｜max_tokens 被压到上限', upstream.seen.max_tokens === 100, String(upstream.seen.max_tokens))
    ok('流式｜服务端注入了上游 Key', upstream.seen.authorization === `Bearer ${SECRET}`)
    ok('流式｜带上了 messages', Array.isArray(upstream.seen.messages) && upstream.seen.messages.length === 1)
    ok('流式｜响应带跨域头', res.headers.get('access-control-allow-origin') === '*')
  }

  // ---------- 3. 非流式：设置页的「测试连接」走的就是这条 ----------
  {
    const res = await post(base, { messages: [{ role: 'user', content: 'ping' }] })
    const text = await res.text()
    ok('非流式｜状态 200', res.status === 200, `status=${res.status}`)
    ok('非流式｜返回 JSON 而不是 SSE', /application\/json/.test(res.headers.get('content-type') || ''))
    ok('非流式｜内容可解析', text.includes('chatcmpl-fake'))
    ok('非流式｜上游收到的 stream=false', upstream.seen.stream === false, String(upstream.seen.stream))
  }

  // ---------- 4. 参数校验：坏请求在上游之前就被挡住 ----------
  {
    const before = upstream.seen.count
    const cases: Array<[string, ChatBody]> = [
      ['messages 为空', { messages: [] }],
      ['角色非法', { messages: [{ role: 'root', content: 'x' }] }],
      ['content 不是字符串', { messages: [{ role: 'user', content: 123 as unknown as string }] }],
    ]
    for (const [label, body] of cases) {
      const res = await post(base, body)
      const parsed = (await res.json()) as { error?: { message?: string } }
      ok(`校验｜${label} → 400`, res.status === 400, `status=${res.status}`)
      ok(`校验｜${label} → 有中文解释`, Boolean(parsed.error?.message && parsed.error.message.length > 4))
    }
    const bad = await fetch(`${base}/api/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{不是json',
    })
    ok('校验｜坏 JSON → 400', bad.status === 400, `status=${bad.status}`)
    ok('校验｜坏请求没有打到上游', upstream.seen.count === before, `${before} → ${upstream.seen.count}`)

    // 超长提示词：413 且明确告诉用户可以怎么办
    const long = await post(base, { messages: [{ role: 'user', content: 'x'.repeat(500) }] })
    const longBody = (await long.json()) as { error?: { code?: string; message?: string } }
    ok('校验｜超长提示词 → 413', long.status === 413, `status=${long.status}`)
    ok('校验｜超长提示词给出可执行建议', /内置演示引擎|精简/.test(longBody.error?.message || ''))
    ok('校验｜超长提示词没有打到上游', upstream.seen.count === before, `${before} → ${upstream.seen.count}`)
  }

  // ---------- 5. 配额：每 IP 3 次、全局 5 次 ----------
  {
    // 前面 9.9.9.9 已经用掉 2 次（流式 1、非流式 1；校验失败的几次不该扣配额）
    const third = await post(base, { messages: [{ role: 'user', content: '再来一个' }] })
    ok('配额｜第 3 次（刚好在上限内）成功', third.status === 200, `status=${third.status}`)
    await third.text()

    const res = await post(base, { messages: [{ role: 'user', content: '第 4 次' }] })
    const body = (await res.json()) as { error?: { code?: string; message?: string; quota?: Record<string, unknown> } }
    ok('配额｜超出每 IP 上限 → 429', res.status === 429, `status=${res.status}`)
    ok('配额｜错误码是 per_ip_daily_limit', body.error?.code === 'per_ip_daily_limit', String(body.error?.code))
    ok('配额｜告诉用户可以切回内置引擎', /内置演示引擎/.test(body.error?.message || ''))
    ok('配额｜带剩余额度信息', typeof body.error?.quota?.remainingForYou === 'number')

    const afterLimit = upstream.seen.count
    const retry = await post(base, { messages: [{ role: 'user', content: '再来一个' }] })
    ok('配额｜被限流后重试仍然 429', retry.status === 429, `status=${retry.status}`)
    ok('配额｜被限流的请求没有打到上游', upstream.seen.count === afterLimit)
  }
  {
    // 换一个 IP，全局额度还有 2 次（5 - 3）
    const a = await post(base, { messages: [{ role: 'user', content: '别的访客' }], stream: true }, '8.8.8.8')
    ok('配额｜换个 IP 还能用', a.status === 200, `status=${a.status}`)
    await a.text()
    const b = await post(base, { messages: [{ role: 'user', content: '别的访客2' }] }, '8.8.8.8')
    ok('配额｜第 5 次仍然成功', b.status === 200, `status=${b.status}`)

    const c = await post(base, { messages: [{ role: 'user', content: '第 6 次' }] }, '7.7.7.7')
    const cb = (await c.json()) as { error?: { code?: string; message?: string } }
    ok('配额｜全局上限触发 429', c.status === 429, `status=${c.status}`)
    ok('配额｜错误码是 global_daily_limit', cb.error?.code === 'global_daily_limit', String(cb.error?.code))
    ok('配额｜全局用尽时说明是全体额度', /全体访客/.test(cb.error?.message || ''))

    const h = (await (await health(base, '7.7.7.7')).json()) as Record<string, unknown>
    ok('配额｜health 里全局剩余为 0', h.remainingGlobal === 0, String(h.remainingGlobal))
    ok('配额｜health 里已用次数对得上', h.usedGlobal === 5, String(h.usedGlobal))
  }

  // ---------- 6. 跨域预检 ----------
  {
    const res = await fetch(`${base}/api/chat/completions`, {
      method: 'OPTIONS',
      headers: { origin: 'https://example.github.io', 'access-control-request-method': 'POST' },
    })
    ok('预检｜OPTIONS → 204', res.status === 204, `status=${res.status}`)
    ok('预检｜允许 POST', /POST/.test(res.headers.get('access-control-allow-methods') || ''))
    ok('预检｜允许 content-type 头', /content-type/i.test(res.headers.get('access-control-allow-headers') || ''))
    ok('预检｜回 ACAO（file:// 页面发 Origin: null 也能过）', res.headers.get('access-control-allow-origin') === '*')
  }

  // ---------- 7. 路由 ----------
  {
    const res = await fetch(`${base}/api/nope`)
    ok('路由｜未知接口 → 404', res.status === 404, `status=${res.status}`)
    const get = await fetch(`${base}/api/chat/completions`)
    ok('路由｜用 GET 打转发口 → 404（而不是 500）', get.status === 404, `status=${get.status}`)
  }

  await proxy.close()

  // ---------- 8. 上游故障：错误映射 + 错误路径也不泄漏 Key ----------
  {
    /** 假上游在 500 的响应体里**故意回显了 Key**，所以这里能同时验响应体和日志两条路。 */
    const logs: string[] = []
    const p2 = startDevServer({ port: 0, env, log: (...parts: unknown[]) => logs.push(parts.join(' ')) })
    const b2 = await p2.listen()
    const res = await post(b2, { messages: [{ role: 'user', content: 'BOOM' }] })
    const text = await res.text()
    ok('故障｜上游 500 → 502', res.status === 502, `status=${res.status}`)
    ok('故障｜不回显上游原始错误体', !text.includes(SECRET) && !text.includes('boom, key was'))
    ok('故障｜给人话和退路', /稍后重试|内置演示引擎/.test(text))
    ok('故障｜记了日志（不是静默失败）', logs.length > 0, `lines=${logs.length}`)
    ok('故障｜日志里把 Key 抹掉了', logs.some((l) => l.includes('[redacted]')))
    ok('故障｜日志里搜不到 Key 明文', !logs.join('\n').includes(SECRET))
    await p2.close()
  }

  // ---------- 9. 超时：上游挂住时不能让访客干等 ----------
  {
    const p3 = startDevServer({ port: 0, env: { ...env, HOSTED_TIMEOUT_MS: '300' }, log: () => {} })
    const b3 = await p3.listen()
    const t0 = Date.now()
    const res = await post(b3, { messages: [{ role: 'user', content: 'HANG' }] })
    const elapsed = Date.now() - t0
    const body = (await res.json()) as { error?: { code?: string } }
    ok('超时｜上游不回 → 504', res.status === 504, `status=${res.status}`)
    ok('超时｜错误码是 upstream_timeout', body.error?.code === 'upstream_timeout', String(body.error?.code))
    ok('超时｜真的在超时后返回', elapsed > 250 && elapsed < 2000, `elapsed=${elapsed}ms`)
    await p3.close()
  }

  // ---------- 10. 上游没配 Key：必须说清楚，而不是让访客看到 401 ----------
  {
    const p4 = startDevServer({ port: 0, env: { ...env, UPSTREAM_API_KEY: '' }, log: () => {} })
    const b4 = await p4.listen()
    const h = (await (await health(b4)).json()) as Record<string, unknown>
    ok('未配置｜health 里 ready=false', h.ready === false, String(h.ready))
    ok('未配置｜health 本身仍然 ok=true（代理活着）', h.ok === true)
    const res = await post(b4, { messages: [{ role: 'user', content: 'hi' }] })
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    ok('未配置｜转发 → 503', res.status === 503, `status=${res.status}`)
    ok('未配置｜错误码是 upstream_not_configured', body.error?.code === 'upstream_not_configured')
    ok('未配置｜提示去哪配置', /UPSTREAM_API_KEY/.test(body.error?.message || ''))
    await p4.close()
  }

  await upstream.close()

  console.log(`\n托管代理集成测试：${passed} 项通过，${failures.length} 项失败。`)
  if (failures.length) {
    console.log('失败明细：')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('集成测试自身崩了：', err)
  process.exitCode = 1
})
