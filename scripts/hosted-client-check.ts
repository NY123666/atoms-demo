/**
 * 托管模式**前端侧**的测试：地址归一化、候选顺序、探测判定，以及"要不要自动换引擎"。
 *
 * 为什么这些也值得单独测：
 *   1) 探测的假阳性是这块最容易犯的错 —— 静态站对未知路径会回一张 200 的 HTML 兜底页，
 *      只看状态码就会把"代理不存在"判成"代理可用"，访客点下去才发现每次生成都失败；
 *   2) 自动换引擎是这个应用里唯一**替访客做决定**的地方，判断错了就是"我明明选了 A，它自己跳到 B"；
 *   3) 单文件版是 `file://` 打开的，那里绝对不能发出任何网络请求 —— 双击打开的东西不该有失败请求；
 *   4) 1~3 全都在假 fetch 上跑，所以第 4 节专门把**真的代理**起起来（真 HTTP、真 SSE），
 *      让真的流水线（runLlmGeneration）走一遍托管模式 —— 前端这条缝是"两边各自测过"覆盖不到的。
 *
 * 运行：npm run smoke:hosted-client
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import process from 'node:process'
import { startDevServer } from '../server/dev.mjs'
import {
  HOSTED_PROBE_TIMEOUT_MS,
  decideHostedSwitch,
  getHostedStatus,
  hostedCandidates,
  hostedEnvBase,
  hostedOfferable,
  hostedUsable,
  normalizeHostedBase,
  probeHosted,
  refreshHosted,
  type HostedStatus,
} from '../src/lib/hosted'
import { llmSteps, runLlmGeneration } from '../src/lib/llmPipeline'
import { HOSTED_PROVIDER_ID } from '../src/lib/providers'
import { checkRunnable } from '../src/lib/sandbox'
import type { GenStepState, Settings } from '../src/types'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/* --------------------------- 假的 fetch --------------------------- */

interface Call {
  url: string
  init?: RequestInit
}

/** 每个候选点会被请求一次；handler 决定第 n 次返回什么。 */
function stubFetch(handler: (call: Call, index: number) => Response | Promise<Response>): {
  fetchImpl: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), init }
    calls.push(call)
    return handler(call, calls.length - 1)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function jsonResponse(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
}

const READY_BODY = {
  ok: true,
  hosted: true,
  ready: true,
  model: 'deepseek-chat',
  dailyPerIp: 20,
  dailyGlobal: 200,
  usedGlobal: 5,
  remainingGlobal: 195,
  remainingForYou: 18,
  sharedLimits: false,
}

/* --------------------------- 1. 地址归一化 --------------------------- */

function checkNormalize(): void {
  ok('归一化｜去掉结尾斜杠', normalizeHostedBase('https://a.example.com/') === 'https://a.example.com')
  ok('归一化｜粘贴 /api 也能用', normalizeHostedBase('https://a.example.com/api') === 'https://a.example.com')
  ok(
    '归一化｜粘贴完整的 /api/health 也能用',
    normalizeHostedBase('https://a.example.com/api/health') === 'https://a.example.com',
  )
  ok('归一化｜空串还是空串', normalizeHostedBase('   ') === '')
  ok('归一化｜顺手吃掉粘贴带进来的空白', normalizeHostedBase(' https://a.example.com/api/ ') === 'https://a.example.com')
  ok('归一化｜带子路径的站点不被削掉', normalizeHostedBase('https://a.example.com/forge/') === 'https://a.example.com/forge')

  const order = hostedCandidates({
    override: 'https://mine.example.com/',
    envBase: 'https://env.example.com',
    origin: 'https://site.example.com',
    protocol: 'https:',
  })
  // 注意第三个：同源候选最终也是"站点根"，`/api` 由 chatBase 负责拼 —— 归一层统一把它们削成同一个形状。
  ok(
    '候选｜顺序是 手填 > 构建期 > 同源',
    order.join('|') === 'https://mine.example.com|https://env.example.com|https://site.example.com',
    order.join('|'),
  )

  const dup = hostedCandidates({
    override: 'https://same.example.com',
    envBase: 'https://same.example.com/',
    origin: 'https://same.example.com',
    protocol: 'https:',
  })
  ok('候选｜同一地址只探一次（归一化后去重）', dup.length === 1, `len=${dup.length}`)

  const fileUrl = hostedCandidates({ origin: 'null', protocol: 'file:' })
  ok('候选｜file:// 单文件版没有任何候选', fileUrl.length === 0, JSON.stringify(fileUrl))

  const noOrigin = hostedCandidates({ protocol: 'https:' })
  ok('候选｜拿不到 origin 时不拼同源地址', noOrigin.length === 0)
}

/* ---------------------------- 2. 探测判定 ---------------------------- */

function state(found: HostedStatus): string {
  return `${found.state}｜${found.message}`
}

async function checkProbe(): Promise<void> {
  // 2.1 假阳性守卫：静态站返回 200 的 HTML 兜底页
  {
    const { fetchImpl } = stubFetch(() => new Response('<!doctype html><title>404</title>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const found = await probeHosted({ origin: 'https://site.example.com', protocol: 'https:', fetchImpl })
    ok('探测｜200 的 HTML 兜底页不算代理可用', found.state === 'offline', state(found))
    ok('探测｜上面这种情况 chatBase 为空，不会发出对话请求', found.chatBase === '')
  }

  // 2.2 正常可用
  {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(READY_BODY))
    const found = await probeHosted({ origin: 'https://site.example.com', protocol: 'https:', fetchImpl })
    ok('探测｜ready=true → ready', found.state === 'ready', state(found))
    ok('探测｜chatBase 拼成 /api（形状与 OpenAI 一致）', found.chatBase === 'https://site.example.com/api', found.chatBase)
    ok('探测｜带上服务端模型名', found.model === 'deepseek-chat', String(found.model))
    ok('探测｜带上剩余额度', found.remainingForYou === 18 && found.dailyGlobal === 200)
    ok('探测｜health 请求不带缓存', calls[0]?.init?.cache === 'no-store', String(calls[0]?.init?.cache))
    ok('探测｜health 请求带 accept: application/json', String((calls[0]?.init?.headers as Record<string, string>)?.accept) === 'application/json')
    ok('探测｜ready 之后 hostedUsable 为真', hostedUsable(found))
    ok('探测｜ready 时界面应当列出这个引擎', hostedOfferable(found))
  }

  // 2.3 代理在但站长没配上游 Key
  {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ...READY_BODY, ready: false, model: undefined }))
    const found = await probeHosted({ origin: 'https://site.example.com', protocol: 'https:', fetchImpl })
    ok('探测｜ready=false → unconfigured（不是 offline）', found.state === 'unconfigured', state(found))
    ok('探测｜unconfigured 时不可用', !hostedUsable(found))
    ok('探测｜unconfigured 仍然列出（否则站长看不到自己部署的代理）', hostedOfferable(found))
    ok('探测｜提示指向 UPSTREAM_API_KEY', /UPSTREAM_API_KEY/.test(found.message), found.message)
  }

  // 2.4 额度用完：本人额度与全站额度是两种不同的提示
  {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ...READY_BODY, remainingForYou: 0 }))
    const perIp = await probeHosted({ origin: 'https://a.example.com', protocol: 'https:', fetchImpl })
    ok('探测｜本人额度为 0 → exhausted', perIp.state === 'exhausted', state(perIp))
    ok('探测｜本人额度的文案说的是"你"', /你今天的免费额度用完了/.test(perIp.message), perIp.message)
    ok('探测｜exhausted 时不可用', !hostedUsable(perIp))
    ok('探测｜exhausted 仍然列出（好告诉访客为什么不能用）', hostedOfferable(perIp))

    const { fetchImpl: f2 } = stubFetch(() => jsonResponse({ ...READY_BODY, remainingGlobal: 0 }))
    const global = await probeHosted({ origin: 'https://a.example.com', protocol: 'https:', fetchImpl: f2 })
    ok('探测｜全站额度为 0 → exhausted', global.state === 'exhausted', state(global))
    ok('探测｜全站额度的文案说的是"全体访客"', /全体访客/.test(global.message), global.message)
  }

  // 2.5 第一个候选坏、第二个好 —— 必须继续往下试
  {
    const { fetchImpl, calls } = stubFetch((call) =>
      call.url.startsWith('https://dead.example.com')
        ? jsonResponse({}, 500)
        : jsonResponse(READY_BODY),
    )
    const found = await probeHosted({
      override: 'https://dead.example.com',
      origin: 'https://site.example.com',
      protocol: 'https:',
      fetchImpl,
    })
    ok('探测｜第一个候选 500 会继续试下一个', found.state === 'ready', state(found))
    ok('探测｜最终用的是第二个候选', found.base === 'https://site.example.com', found.base)
    ok('探测｜确实发了两次', calls.length === 2, `len=${calls.length}`)
  }

  // 2.6 第一个候选"活着但用不了"，第二个可用 —— 可用优先，降级结论不该遮蔽它
  {
    const { fetchImpl } = stubFetch((call) =>
      call.url.startsWith('https://bad.example.com')
        ? jsonResponse({ ...READY_BODY, ready: false })
        : jsonResponse(READY_BODY),
    )
    const found = await probeHosted({
      override: 'https://bad.example.com',
      origin: 'https://ok.example.com',
      protocol: 'https:',
      fetchImpl,
    })
    ok('探测｜降级候选不遮蔽后面可用的候选', found.state === 'ready', state(found))
    ok('探测｜用的是那个可用的', found.base === 'https://ok.example.com', found.base)
  }

  // 2.7 全都不通
  {
    const { fetchImpl } = stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    const found = await probeHosted({ origin: 'https://site.example.com', protocol: 'https:', fetchImpl })
    ok('探测｜连不上 → offline（不抛异常）', found.state === 'offline', state(found))
    ok('探测｜offline 时界面不列出这个引擎', !hostedOfferable(found))
  }

  // 2.8 没有候选：单文件版绝不能发请求
  {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(READY_BODY))
    const found = await probeHosted({ origin: 'null', protocol: 'file:', fetchImpl })
    ok('探测｜file:// 判为 offline', found.state === 'offline', state(found))
    ok('探测｜file:// 下一个请求都不发', calls.length === 0, `len=${calls.length}`)
    ok('探测｜file:// 的说明提到单文件版', /单文件版/.test(found.message), found.message)
  }

  // 2.9 超时：挂住的代理不能把首屏拖死
  {
    const { fetchImpl } = stubFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          /*
           * 这里必须真的把 abort 信号接上 —— 否则这个用例测的是"fetch 永远不返回"，
           * 而它想覆盖的是"探到超时就放弃"。真实的 fetch 在 signal 触发时会 reject，
           * 假 fetch 也得照做，不然测试会一直挂着（这也是个提醒：假实现偷懒会掩盖被测代码的问题）。
           */
          const signal = call.init?.signal
          signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )
    const started = Date.now()
    const found = await probeHosted({
      origin: 'https://hang.example.com',
      protocol: 'https:',
      timeoutMs: 40,
      fetchImpl,
    })
    const elapsed = Date.now() - started
    ok('探测｜挂住的候选会被超时放弃', found.state === 'offline', state(found))
    ok('探测｜超时确实按 timeoutMs 生效', elapsed < 2000, `elapsed=${elapsed}ms`)
    ok('探测｜默认超时是给首屏留的余量（≤ 4s）', HOSTED_PROBE_TIMEOUT_MS <= 4000, String(HOSTED_PROBE_TIMEOUT_MS))
  }
}

/* ------------------------- 3. 自动换引擎的策略 ------------------------- */

function status(state_: HostedStatus['state'], model = 'deepseek-chat'): HostedStatus {
  return {
    state: state_,
    base: state_ === 'offline' ? '' : 'https://site.example.com',
    chatBase: state_ === 'ready' ? 'https://site.example.com/api' : '',
    model,
    message: `${state_} 的说明`,
    checkedAt: 0,
  }
}

function checkDecision(): void {
  const fresh = { activeProviderId: 'demo', providerChosen: false }
  const chosen = { activeProviderId: 'demo', providerChosen: true }
  const onHosted = { activeProviderId: 'hosted', providerChosen: true }
  const onOwnKey = { activeProviderId: 'deepseek', providerChosen: true }

  const adopt = decideHostedSwitch(status('ready'), fresh)
  ok('策略｜演示引擎 + 没选过 + 代理可用 → 自动启用', adopt.kind === 'adopt' && adopt.providerId === 'hosted', adopt.kind)
  ok('策略｜启用时的文案提到不需要 API Key', /不需要 API Key/.test(adopt.message || ''), adopt.message || '')
  ok('策略｜启用时的文案带上了服务端模型名', /deepseek-chat/.test(adopt.message || ''), adopt.message || '')

  ok(
    '策略｜访客自己选过就不再自动切（providerChosen 是红线）',
    decideHostedSwitch(status('ready'), chosen).kind === 'none',
  )
  ok(
    '策略｜代理不可用时也不自动切（本来就在演示引擎上）',
    decideHostedSwitch(status('offline'), fresh).kind === 'none',
  )
  ok(
    '策略｜不会把自带 Key 的用户拽走',
    decideHostedSwitch(status('ready'), onOwnKey).kind === 'none',
  )

  const back = decideHostedSwitch(status('exhausted'), onHosted)
  ok('策略｜托管不可用而当前正是托管 → 退回演示引擎', back.kind === 'fallback' && back.providerId === 'demo', back.kind)
  ok('策略｜退回时把原因一起说了', /exhausted 的说明/.test(back.message || ''), back.message || '')

  const backOffline = decideHostedSwitch(status('offline'), onHosted)
  ok('策略｜代理整个没了也退回演示引擎', backOffline.kind === 'fallback', backOffline.kind)
  ok(
    '策略｜退回不看 providerChosen（它是修错，不是偏好）',
    decideHostedSwitch(status('exhausted'), { activeProviderId: 'hosted', providerChosen: false }).kind === 'fallback',
  )
  ok('策略｜托管正常就不动', decideHostedSwitch(status('ready'), onHosted).kind === 'none')

  ok('环境变量｜node 里读不到构建期变量时返回空串', hostedEnvBase() === '', JSON.stringify(hostedEnvBase()))
}

/* ------------- 4. 端到端：前端流水线 × 真代理（真 HTTP、真 SSE） ------------- */

const UPSTREAM_SECRET = 'sk-e2e-upstream-key-do-not-leak'

/** 假的上游模型服务：只认流式，收到什么记什么。 */
function startFakeModel(): Promise<{
  origin: string
  seen: { authorization?: string; body: Record<string, unknown> }[]
  close: () => Promise<void>
}> {
  const seen: { authorization?: string; body: Record<string, unknown> }[] = []

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)

    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    } catch {
      /* 解析不了就留空对象，断言那边自然会失败 */
    }
    seen.push({ authorization: req.headers.authorization, body })

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' })
    /*
     * 故意切成小块、块与块之间让出事件循环：这样前端那条 SSE 解析链路真的走了"增量"分支，
     * 而不是一次性拿到整段文本 —— 一次拿到的话，这个用例就测不出"边收边渲染"坏掉了。
     */
    for (let i = 0; i < REPLY.length; i += 48) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY.slice(i, i + 48) } }] })}\n\n`)
      await new Promise((r) => setTimeout(r, 1))
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { total_tokens: 123 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        origin: `http://127.0.0.1:${port}`,
        seen,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}

/** 模型"写"出来的单文件产物：故意写成 markdown 代码块 + 前后废话，好把抽取那一环也走通。 */
const APP_HTML = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head><meta charset="utf-8"><title>托管模式端到端</title>',
  '<style>body{margin:0;font:14px system-ui}</style></head>',
  '<body><div id="app"></div>',
  '<script>document.getElementById("app").textContent="ok";</script>',
  '</body>',
  '</html>',
].join('\n')

const REPLY = `好的，这是一个可以直接运行的版本：\n\n\`\`\`html\n${APP_HTML}\n\`\`\`\n\n需要我加个筛选吗？`

const hostedSettings: Settings = {
  activeProviderId: HOSTED_PROVIDER_ID,
  providers: {}, // 托管模式下这里本来就是空的：访客没填过任何 Key
  theme: 'dark',
  autoFix: true,
  streamDemo: false,
  hostedBase: '',
  providerChosen: true,
}

/** 跑一遍真的流水线（和 generate.ts 里的编排同样地把步骤状态接起来）。 */
async function runPipeline(prompt: string): Promise<{
  ver: Awaited<ReturnType<typeof runLlmGeneration>>
  steps: GenStepState[]
  deltas: string[]
}> {
  const steps: GenStepState[] = llmSteps(prompt, false, false).map((d) => ({ ...d, status: 'pending' }))
  const deltas: string[] = []
  const ver = await runLlmGeneration({
    prompt,
    previousHtml: null,
    settings: hostedSettings,
    steps,
    startedAt: Date.now(),
    publish: () => {},
    start: (i) => {
      steps[i]!.status = 'running'
    },
    finish: (i, detail) => {
      steps[i]!.status = 'done'
      if (detail) steps[i]!.detail = detail
    },
    fail: (i, detail) => {
      steps[i]!.status = 'error'
      steps[i]!.detail = detail
    },
    onDelta: (_c, full) => deltas.push(full),
    signal: new AbortController().signal,
  })
  return { ver, steps, deltas }
}

async function checkEndToEnd(): Promise<void> {
  const upstream = await startFakeModel()
  const proxy = startDevServer({
    port: 0,
    env: {
      UPSTREAM_BASE_URL: upstream.origin,
      UPSTREAM_API_KEY: UPSTREAM_SECRET,
      UPSTREAM_MODEL: 'deepseek-chat',
      HOSTED_DAILY_PER_IP: '20',
      HOSTED_DAILY_GLOBAL: '200',
    },
    log: () => {},
  })
  const proxyBase = await proxy.listen()

  /*
   * 装一个"记录并转发"的 fetch，用来断言**浏览器这一侧到底发了什么**。
   * 只记打到 /api/ 的（也就是前端发给代理的）—— 代理再发往上游的那一跳也走 globalThis.fetch，
   * 把它一起记进来会让"客户端发了什么"变得含糊。
   */
  const realFetch = globalThis.fetch
  const clientCalls: Call[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/')) clientCalls.push({ url: String(input), init })
    return realFetch(input, init)
  }) as typeof fetch

  try {
    // 4.1 开机探测：前端的探测逻辑对着真代理跑
    const found = await refreshHosted({ override: proxyBase })
    ok('端到端｜对着真代理探到 ready', found.state === 'ready', `${found.state}｜${found.message}`)
    ok('端到端｜chatBase 指向代理的 /api', found.chatBase === `${proxyBase}/api`, found.chatBase)
    ok('端到端｜模型名是服务端给的（前端没填过）', found.model === 'deepseek-chat', String(found.model))
    ok('端到端｜探测结果落进了模块状态', getHostedStatus().state === 'ready', getHostedStatus().state)
    ok(
      '端到端｜探测走的是 GET /api/health',
      clientCalls.some((c) => c.url === `${proxyBase}/api/health`),
      clientCalls.map((c) => c.url).join(' '),
    )

    // 4.2 真探测结果直接喂给自动换引擎策略 —— 这是两块代码的接缝，各自测过不等于接得上
    ok(
      '端到端｜真探测结果能让策略判定为"自动启用托管"',
      decideHostedSwitch(found, { activeProviderId: 'demo', providerChosen: false }).kind === 'adopt',
    )
    ok(
      '端到端｜自带 Key 的访客不会被真探测结果拽走',
      decideHostedSwitch(found, { activeProviderId: 'deepseek', providerChosen: true }).kind === 'none',
    )

    // 4.3 托管模式跑完整条流水线
    const { ver, steps, deltas } = await runPipeline('做一个待办清单')
    ok('端到端｜托管模式生成成功', ver.source === 'llm' && ver.html.length > 100, `source=${ver.source}`)
    ok('端到端｜产物记的是 hosted 引擎', ver.providerId === HOSTED_PROVIDER_ID, String(ver.providerId))
    ok('端到端｜产物记的模型名来自服务端', ver.model === 'deepseek-chat', String(ver.model))
    ok('端到端｜从代码块里抠出了完整文档', ver.html.includes('<div id="app">') && ver.html.includes('</html>'))
    ok('端到端｜产物里没有 markdown 残留', !ver.html.includes('```') && !ver.html.includes('需要我加个筛选吗'))
    ok('端到端｜产物通过静态自检', checkRunnable(ver.html).ok, checkRunnable(ver.html).reasons.join('；'))
    ok('端到端｜token 用量穿过代理透传过来', ver.tokens === 123, String(ver.tokens))
    ok('端到端｜真的是边收边渲染（增量回调多次）', deltas.length >= 5, `n=${deltas.length}`)
    ok('端到端｜步骤文案写的是托管模型 + 服务端模型名', /托管模型.*deepseek-chat/.test(steps[1]!.detail ?? ''), steps[1]!.detail ?? '')
    ok('端到端｜步骤全部走到 done', steps.every((s) => s.status === 'done'), steps.map((s) => s.status).join(','))
    ok('端到端｜产物说明里如实标了托管与一次通过', /托管模型/.test(ver.note ?? '') && /一次通过自检/.test(ver.note ?? ''), ver.note)

    // 4.4 浏览器这一侧到底发了什么 —— 这是"零配置"能不能安全成立的核心
    const call = clientCalls.find((c) => c.url === `${proxyBase}/api/chat/completions`)
    ok('端到端｜流水线打的是代理的 /api/chat/completions', Boolean(call), clientCalls.map((c) => c.url).join(' '))
    const sent = (call?.init?.headers ?? {}) as Record<string, string>
    ok(
      '端到端｜访客请求里完全没有 Authorization 头（浏览器不持有 Key）',
      !Object.keys(sent).some((k) => k.toLowerCase() === 'authorization'),
      Object.keys(sent).join(','),
    )
    ok('端到端｜访客请求体里也搜不到任何 Key', !String(call?.init?.body ?? '').includes('sk-'))
    // 上面两条只有在"记到的确实是这次流水线的那一发"时才算数，所以顺手验一下身份
    ok('端到端｜记到的确实是这次流水线的请求（body 里有原始需求）', String(call?.init?.body ?? '').includes('待办清单'))

    // 4.5 上游那一侧看到的必须是"服务端注入的东西"
    ok('端到端｜上游只收到一次对话请求', upstream.seen.length === 1, `n=${upstream.seen.length}`)
    ok(
      '端到端｜上游拿到的是服务端环境变量里的 Key',
      upstream.seen[0]?.authorization === `Bearer ${UPSTREAM_SECRET}`,
      String(upstream.seen[0]?.authorization).replace(UPSTREAM_SECRET, '[key]'),
    )
    ok('端到端｜上游收到的模型是服务端强制的那个', upstream.seen[0]?.body.model === 'deepseek-chat')
    ok('端到端｜上游收到 stream=true', upstream.seen[0]?.body.stream === true)
    ok(
      '端到端｜system + user 两条消息原样透传',
      Array.isArray(upstream.seen[0]?.body.messages) &&
        (upstream.seen[0]?.body.messages as { role: string }[]).map((m) => m.role).join(',') === 'system,user',
      JSON.stringify(upstream.seen[0]?.body.messages),
    )

    // 4.6 额度用完这条路：不该再白打一次上游，也不该把 429 原样丢给访客
    {
      const p2 = startDevServer({
        port: 0,
        env: { UPSTREAM_BASE_URL: upstream.origin, UPSTREAM_API_KEY: UPSTREAM_SECRET, HOSTED_DAILY_PER_IP: '1' },
        log: () => {},
      })
      const b2 = await p2.listen()
      try {
        const first = await fetch(`${b2}/api/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: '先用掉今天这一次' }], stream: true }),
        })
        ok('端到端｜配额内第一次请求正常', first.status === 200, `status=${first.status}`)
        await first.text()

        const after = await refreshHosted({ override: b2 })
        ok('端到端｜额度用完后重新探测 → exhausted', after.state === 'exhausted', `${after.state}｜${after.message}`)
        ok('端到端｜提示里带上了"每天几次"这个具体数字', /每天 1 次/.test(after.message), after.message)
        ok('端到端｜exhausted 仍然列出（好告诉访客为什么不能用）', hostedOfferable(after))
        ok('端到端｜exhausted 时判为不可用', !hostedUsable(after))

        const upstreamBefore = upstream.seen.length
        const err = await runPipeline('再来一个').then(
          () => null,
          (e: Error) => e,
        )
        ok('端到端｜额度用完时流水线直接给人话，而不是原始 429', Boolean(err) && !/429/.test(err!.message), err?.message)
        ok('端到端｜这句话点明了"额度用完了"', /额度用完了/.test(err?.message ?? ''), err?.message)
        ok('端到端｜这句话给了退路（设置 / 演示引擎）', /模型设置|演示引擎/.test(err?.message ?? ''), err?.message)
        ok('端到端｜额度用完没有再白打一次上游', upstream.seen.length === upstreamBefore, `n=${upstream.seen.length - upstreamBefore}`)
      } finally {
        await p2.close()
      }
    }
  } finally {
    globalThis.fetch = realFetch
    await proxy.close()
    await upstream.close()
  }
}

/* -------------------------------- 入口 -------------------------------- */

async function main(): Promise<void> {
  checkNormalize()
  await checkProbe()
  checkDecision()
  await checkEndToEnd()

  console.log(`\n托管模式前端测试：${passed} 项通过，${failures.length} 项失败。`)
  if (failures.length) {
    console.log('失败明细：')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('前端侧托管测试自身崩了：', err)
  process.exitCode = 1
})
