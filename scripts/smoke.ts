/**
 * 冒烟测试：不开浏览器，直接把生成链路里"不依赖 DOM"的部分跑一遍。
 *
 * 覆盖五件事：
 * 1. 演示引擎（不填 Key 就能用的那条路）对全部示例需求 + 若干边界输入都能产出可运行 HTML；
 * 2. 生成物的静态自检 checkRunnable 真的能拦住坏产物（不能只会说 ok）；
 * 3. extractHtml 能从模型常见的几种回包格式里抠出文档；
 * 4. 分享链接的压缩编解码往返无损；
 * 5. 首页检索/筛选的纯函数判定（和 UI 共用同一份代码，见 lib/projects.ts）。
 *
 * 运行：npm run smoke
 */

import { DEMO_SHOWCASE, generateDemo, describeTarget } from '../src/lib/demoEngine'
import { analyzeEnhancements, applyEnhancements, planEnhancements } from '../src/lib/enhance'
import { checkRunnable, extractHtml, instrument, SANDBOX_ATTRS } from '../src/lib/sandbox'
import { decodeShare, encodeShare } from '../src/lib/share'
import { buildGeneratePrompt, buildIteratePrompt, SYSTEM_PROMPT } from '../src/lib/prompt'
import { DEFAULT_QUERY, currentVersionOf, engineOf, filterProjects, isFiltering } from '../src/lib/projects'
import type { AppVersion, ChatMessage, GenSource, Project, SharePayload } from '../src/types'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/** 生成物不该有任何外部依赖，否则离线沙箱里会白屏。 */
function externalRefs(html: string): string[] {
  const hits: string[] = []
  const re = /(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+/gi
  for (const m of html.match(re) ?? []) hits.push(m)
  return hits
}

function checkDemo(label: string, prompt: string, revision = 0): string {
  const res = generateDemo(prompt, revision)
  const html = res.html

  ok(`${label}｜产出非空`, html.length > 400, `len=${html.length}`)
  ok(`${label}｜是完整文档`, /<!doctype html/i.test(html) && /<\/html>\s*$/i.test(html.trim()))
  ok(`${label}｜带脚本`, /<script[\s>]/i.test(html))
  ok(`${label}｜无外部依赖`, externalRefs(html).length === 0, externalRefs(html).slice(0, 3).join(' , '))

  const check = checkRunnable(html)
  ok(`${label}｜通过静态自检`, check.ok, check.reasons.join('；'))

  const injected = instrument(html)
  ok(`${label}｜探针已注入`, injected.includes('__forge_probe__') && injected.includes('runtime-error'))
  ok(`${label}｜探针在产物脚本之前`, injected.indexOf('__forge_probe__') < injected.indexOf('</head>') + 1)
  ok(`${label}｜探针只注入一次`, injected.split('__forge_probe__').length - 1 === 2)

  ok(`${label}｜标题非空`, res.templateName.trim().length > 0)
  ok(`${label}｜命中说明非空`, res.note.trim().length > 0)
  return html
}

async function main(): Promise<void> {
  console.log('— 1/5 演示引擎：全部内置示例 —')
  const outputs: string[] = []
  for (const item of DEMO_SHOWCASE) {
    outputs.push(checkDemo(item.label, item.prompt))
    console.log(`  ✓ ${item.label} → ${item.prompt}`)
  }
  ok('示例之间产物互不相同', new Set(outputs).size === outputs.length)

  console.log('— 2/5 演示引擎：边界与自由输入 —')
  const edge: Array<[string, string]> = [
    ['空需求', ''],
    ['纯空白', '   \n  '],
    ['表情符号', '🎉🎉🎉'],
    ['英文需求', 'build me a kanban board with drag and drop'],
    ['超长需求', '做一个管理系统。'.repeat(300)],
    ['含 HTML 字符', '<script>alert(1)</script> 做一个搜索页'],
    ['超短需求', '钟'],
    ['混合需求', '我要一个既能记账又能倒计时的页面'],
  ]
  for (const [label, prompt] of edge) {
    checkDemo(label, prompt)
    console.log(`  ✓ ${label}`)
  }

  console.log('— 3/5 迭代链路（必须在上一版基础上真的变样） —')
  const base = DEMO_SHOWCASE[0]
  if (!base) throw new Error('DEMO_SHOWCASE 不能为空')
  const todo = DEMO_SHOWCASE[3]
  if (!todo) throw new Error('DEMO_SHOWCASE 缺少待办清单示例')

  const v1 = generateDemo(todo.prompt, 0)
  const v2 = generateDemo('加一个搜索框，能过滤列表', 1, v1.html)
  const v3 = generateDemo('支持导出成 JSON 文件', 2, v2.html)
  ok('迭代产出与首版不同', v1.html !== v2.html)
  ok('两次迭代产出不同', v2.html !== v3.html)
  ok('迭代版带增强层标记', v2.html.includes('__forge_enhance'))
  ok('点名搜索 → 真的注入了筛选框', v2.html.includes('筛选 / 搜索'))
  ok('点名导出 → 真的注入了导出按钮', v3.html.includes('导出 JSON'))
  ok(
    '上一版已有的能力不重复添加',
    applyEnhancements(v2.html, '再加一个搜索框', 3).skipped.length === 1 &&
      applyEnhancements(v2.html, '再加一个搜索框', 3).applied.length === 0,
  )
  /* 两个真的踩过的坑：判断"上一版有没有这个能力"时，
     ① 我们注入的按钮文案（"导出 JSON"）会被当成产物自带的能力，第二版起永远跳过；
     ② 模板源码里的说明性注释（"再改一版 → 加搜索/导出/柱状图"）同样会被误读。
     所以能力判定只能看"去掉我们自己的痕迹、去掉注释"之后剩下的实现。 */
  const reqAll = '加一个搜索框，支持导出成 JSON，画个柱状图，再加暗色主题切换'
  const a1 = applyEnhancements(v1.html, reqAll, 1)
  ok('四个功能全都补上了（不被注释误判为已有）', a1.applied.length === 4, JSON.stringify(a1.skipped))
  const v2all = generateDemo(reqAll, 1, v1.html).html
  const a2 = applyEnhancements(v2all, '再加个柱状图和搜索框，还要导出和暗色', 2)
  ok('工具条文案不被当成产物自带能力', !a2.applied.includes('导出 JSON'), JSON.stringify(a2.applied))
  ok('上一版注入过的能力不会被重复描述为新增', a2.applied.length === 0 && a2.skipped.length === 4, JSON.stringify(a2.skipped))
  ok('迭代说明写清做了什么', v2.note.includes('新增') && v2.note.includes('上一版'))
  ok('未点名功能的迭代仍有可见变化', v1.html !== generateDemo('随便改改', 1, v1.html).html)
  ok('未点名功能时如实说明', generateDemo('随便改改', 1, v1.html).note.includes('未识别到'))

  /* 界面上的「下一步可以加」：建议必须跟着这一版的实际能力走。
     除了"该不该推荐"，这里还钉住另一件事：**推荐了就一定要真的挂得上** ——
     摆一个点了没反应的按钮，比不推荐更糟。 */
  const ovEmpty = analyzeEnhancements(null)
  ok('还没有产物时：四项都算"还没有"', ovEmpty.have.length === 0 && ovEmpty.suggest.length === 4)
  ok(
    '每条建议的措辞都能被 planEnhancements 认出（点了真的会生效）',
    ovEmpty.suggest.every((s) => planEnhancements(s.prompt).some((e) => e.id === s.id)),
    JSON.stringify(ovEmpty.suggest.map((s) => [s.id, planEnhancements(s.prompt).map((e) => e.id)])),
  )
  const ovFirst = analyzeEnhancements(v1.html)
  ok(
    '首版建议的就是全部四项（模板注释里提到过这些能力，不算数）',
    ovFirst.have.length === 0 && ovFirst.suggest.length === 4,
    JSON.stringify(ovFirst.have),
  )
  const ovSearch = analyzeEnhancements(v2.html)
  ok(
    '已经挂过搜索框之后：不再推荐搜索框',
    !ovSearch.suggest.some((s) => s.id === 'search') && ovSearch.have.includes('搜索筛选框'),
    JSON.stringify(ovSearch),
  )
  /* 这一条是给"被自己的痕迹骗到"那个老坑设的第二道岗：
     v2all 的产物里四个都注入过，工具条按钮上还明晃晃写着「导出 JSON」，
     界面要是靠"看见这几个字"来判，就会建议过了却永远挂不上。 */
  const ovAll = analyzeEnhancements(v2all)
  ok(
    '四项全挂上后一条都不再推荐（不被工具条的按钮文案骗到）',
    ovAll.suggest.length === 0 && ovAll.have.length === 4,
    JSON.stringify(ovAll.suggest.map((s) => s.id)),
  )

  /* 推荐 → 点下去 → 真的长出来：从首版开始一路照建议走，四步之后不该再有可推荐的。
     万一哪天"判定"和"注入"两边不一致（推荐了却挂不上），这个循环就转不完，
     上限本身就是断言。 */
  let cur = v1.html
  let rounds = 0
  const accepted: string[] = []
  const missed: string[] = []
  while (rounds < 8) {
    const next = analyzeEnhancements(cur).suggest[0]
    if (!next) break
    const res = applyEnhancements(cur, next.prompt, rounds + 1)
    if (res.applied.length !== 1) missed.push(`${next.id} → applied=${JSON.stringify(res.applied)} skipped=${JSON.stringify(res.skipped)}`)
    accepted.push(next.id)
    cur = res.html
    rounds += 1
  }
  ok('一路照建议点下去，四步正好补完四项', rounds === 4 && accepted.length === 4, `轮数=${rounds} 顺序=${accepted.join(' → ')}`)
  ok('每一轮建议都真的挂上了（没有点了没反应的按钮）', missed.length === 0, missed.join('；'))
  ok('四项补完之后不再有建议', analyzeEnhancements(cur).suggest.length === 0)
  ok('照建议补完的产物依然可运行', checkRunnable(cur).ok, checkRunnable(cur).reasons.join('；'))

  // 每种模板迭代一次，确认增强后的产物依然过自检
  for (const item of DEMO_SHOWCASE) {
    const first = generateDemo(item.prompt, 0)
    const next = generateDemo('加一个暗色主题切换，再加搜索框和导出，并画个柱状图', 1, first.html)
    ok(`迭代后可运行｜${item.label}`, checkRunnable(next.html).ok, checkRunnable(next.html).reasons.join('；'))
    ok(`迭代后无外部依赖｜${item.label}`, externalRefs(next.html).length === 0)
    ok(`迭代产物基于上一版｜${item.label}`, next.html.length > first.html.length && next.html.includes('__forge_bar'))
    ok(`迭代说明非空｜${item.label}`, next.note.trim().length > 0)
  }

  // 生成的脚本必须是能解析的 JS，否则产物在沙箱里直接白屏
  const scriptsOf = (html: string): string[] =>
    [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? '')
  for (const [label, html] of [
    ['首版', v1.html],
    ['迭代版', v3.html],
    ['注探针后', instrument(v3.html)],
  ] as Array<[string, string]>) {
    const scripts = scriptsOf(html)
    ok(`脚本可解析｜${label}`, scripts.length > 0, '没有找到 script')
    for (const src of scripts) {
      let parsed = true
      let why = ''
      try {
        new Function(src)
      } catch (e) {
        parsed = false
        why = String(e)
      }
      ok(`脚本可解析｜${label}`, parsed, why.slice(0, 120))
    }
    ok(`脚本里没有提前闭合的 </script>`, !/<\/script>/i.test(scripts.join('\n')))
  }

  for (const prompt of [base.prompt, '一个陌生需求的描述', '']) {
    const target = describeTarget(prompt)
    ok(`describeTarget 非空（${prompt.slice(0, 10) || '空'}）`, target.trim().length > 0)
  }

  console.log('— 4/5 extractHtml / checkRunnable 的反例 —')
  const goodDoc = v1.html
  const cases: Array<[string, string, string | null]> = [
    ['裸文档', goodDoc, 'document'],
    ['围栏包裹', '这是你要的代码：\n```html\n' + goodDoc + '\n```\n希望有用！', 'fenced'],
    ['带前言', '好的，我来实现。\n\n' + goodDoc, 'document'],
    ['只有片段', '<div id="x">hi</div><script>console.log(1)</script>', 'fragment'],
    ['纯文本', '抱歉，我无法完成这个请求。', null],
    ['空字符串', '', null],
  ]
  for (const [label, raw, expectStrategy] of cases) {
    const got = extractHtml(raw)
    const strategy = got.html ? got.strategy : null
    ok(`extractHtml｜${label}`, strategy === expectStrategy, `期望 ${expectStrategy}，得到 ${strategy}`)
    if (got.html) ok(`extractHtml｜${label} 产物可运行`, checkRunnable(got.html).ok || label === '只有片段')
  }

  const bad: Array<[string, string]> = [
    ['缺 body', '<html><head></head><script>1</script></html>'],
    ['没有脚本和样式', '<html><body><p>静态页</p></body></html>'],
    ['未闭合', '<html><body><script>1</script>'],
    ['外链脚本', '<html><body><script src="https://cdn.example.com/x.js"></script></body></html>'],
    ['外链样式', '<html><body><link rel="stylesheet" href="https://cdn.example.com/a.css"></body></html>'],
  ]
  for (const [label, html] of bad) {
    ok(`checkRunnable 拦截｜${label}`, !checkRunnable(html).ok)
  }
  ok('checkRunnable 放行好产物', checkRunnable(goodDoc).ok, checkRunnable(goodDoc).reasons.join('；'))
  ok('instrument 保留原产物', instrument(goodDoc).includes('</body>'))
  ok('沙箱属性不含 allow-same-origin', !SANDBOX_ATTRS.includes('same-origin'))
  ok('沙箱允许脚本', SANDBOX_ATTRS.includes('allow-scripts'))

  console.log('— 5/5 分享链接编解码 —')
  const small: SharePayload = { v: 1, name: '小应用', html: '<html><body>hi</body></html>', createdAt: 1, source: 'demo' }
  const big: SharePayload = {
    v: 1,
    name: '大应用',
    html: goodDoc + `<!-- ${'填充内容'.repeat(4000)} -->`,
    createdAt: Date.now(),
    source: 'llm',
    model: 'forge-template-v1',
  }
  for (const [label, payload] of [['小产物', small], ['大产物', big]] as Array<[string, SharePayload]>) {
    const code = await encodeShare(payload)
    const back = await decodeShare(code)
    ok(`分享往返｜${label}`, back !== null)
    ok(`分享往返｜${label} 名称一致`, back?.name === payload.name)
    ok(`分享往返｜${label} HTML 一致`, back?.html === payload.html, `原 ${payload.html.length} / 回 ${back?.html.length}`)
    ok(`分享往返｜${label} 编码无非法字符`, /^[0-9A-Za-z_-]+$/.test(code))
    if (label === '大产物') {
      const ratio = code.length / payload.html.length
      ok('压缩确实起作用（<60%）', ratio < 0.6, `ratio=${ratio.toFixed(3)}`)
      console.log(`  · 大产物 ${payload.html.length}B → 分享码 ${code.length}B（${(ratio * 100).toFixed(1)}%）`)
    }
  }
  ok('坏分享码返回 null', (await decodeShare('1@@@@@@')) === null)
  ok('空分享码返回 null', (await decodeShare('')) === null)
  ok('未知前缀返回 null', (await decodeShare('9abc')) === null)

  console.log('— 附加：提示词组装 —')
  ok('系统提示词要求单文件 HTML', /单文件/.test(SYSTEM_PROMPT) && /html/i.test(SYSTEM_PROMPT))
  const gp = buildGeneratePrompt(base.prompt)
  ok('生成提示词带上需求', gp.includes(base.prompt))
  const ip = buildIteratePrompt('加一个暗色主题', goodDoc)
  ok('迭代提示词带上上一版', ip.includes('暗色主题') && ip.length > goodDoc.length - 200)

  console.log('— 附加：首页检索与筛选 —')
  {
    const T = 1_700_000_000_000
    let seq = 0
    const msg = (role: 'user' | 'assistant', content: string): ChatMessage => ({
      id: `m${(seq += 1)}`,
      role,
      content,
      createdAt: T + seq,
    })
    const ver = (index: number, prompt: string, source: GenSource = 'demo'): AppVersion => ({
      id: `v${index}-${prompt.replace(/\W/g, '').slice(0, 6) || 'x'}`,
      index,
      label: prompt.slice(0, 8),
      html: '<!doctype html><html><body><script>1</script></body></html>',
      prompt,
      createdAt: T + index,
      durationMs: 12,
      source,
      model: source === 'llm' ? 'gpt-x' : undefined,
    })
    const proj = (o: {
      id: string
      name: string
      createdAt: number
      updatedAt: number
      starred?: boolean
      messages: ChatMessage[]
      versions: AppVersion[]
      current?: number
    }): Project => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      starred: o.starred ?? false,
      messages: o.messages,
      versions: o.versions,
      currentVersionId: o.current === undefined ? null : (o.versions[o.current]?.id ?? null),
    })

    // 四份存档覆盖：收藏置顶、说了但没生成的那句话、老版本命中、一个版本都没有。
    const ledger = proj({
      id: 'p1',
      name: '记账本',
      starred: true,
      createdAt: T + 1,
      updatedAt: T + 100,
      messages: [msg('user', '做一个记账本，能按分类汇总'), msg('assistant', '记账本已经生成好了，可以点右侧预览')],
      versions: [ver(1, '做一个记账本，能按分类汇总')],
      current: 0,
    })
    const pomodoro = proj({
      id: 'p2',
      name: '番茄钟',
      createdAt: T + 2,
      updatedAt: T + 90,
      messages: [msg('user', '做一个番茄钟'), msg('assistant', '好了'), msg('user', '顺便加个暗色主题')],
      versions: [ver(1, '做一个番茄钟')],
      current: 0,
    })
    const habit = proj({
      id: 'p3',
      name: 'Habit Tracker',
      createdAt: T + 3,
      updatedAt: T + 80,
      messages: [msg('user', 'Habit tracker with streaks'), msg('user', 'add weekly chart')],
      versions: [ver(1, 'Habit tracker with streaks'), ver(2, 'add weekly chart', 'llm')],
      current: 1,
    })
    const blank = proj({
      id: 'p4',
      name: '空白草稿',
      createdAt: T + 4,
      updatedAt: T + 70,
      messages: [msg('user', '整理一下周报')],
      versions: [],
    })
    const all = [ledger, pomodoro, habit, blank]
    const ids = (q: Partial<typeof DEFAULT_QUERY>) =>
      filterProjects(all, { ...DEFAULT_QUERY, ...q }).map((r) => r.project.id)
    const rowOf = (q: Partial<typeof DEFAULT_QUERY>, id: string) =>
      filterProjects(all, { ...DEFAULT_QUERY, ...q }).find((r) => r.project.id === id)

    ok('空筛选返回全部', ids({}).length === 4)
    ok('默认顺序＝收藏置顶 + 最近更新', ids({}).join() === 'p1,p2,p3,p4', ids({}).join())
    ok('按应用名搜得到', ids({ query: '记账' }).join() === 'p1')
    ok('应用名命中时不再提示"为什么搜到"', rowOf({ query: '记账' }, 'p1')?.hit === null)
    ok('应用名搜索不分大小写', ids({ query: 'hAbIt' }).join() === 'p3')
    ok('按你说过的话搜得到', ids({ query: '番茄钟' }).join() === 'p2')
    ok('命中的就是卡片上正显示的那句时，不提示', rowOf({ query: '番茄钟' }, 'p2')?.hit === null)
    ok(
      '老版本的需求也搜得到，并说清命中在哪一版',
      rowOf({ query: 'streaks' }, 'p3')?.hit?.versionIndex === 1,
      JSON.stringify(rowOf({ query: 'streaks' }, 'p3')?.hit),
    )
    ok('命中提示给的是原话', (rowOf({ query: 'streaks' }, 'p3')?.hit?.text ?? '').includes('streaks'))
    ok(
      '说了但没存档的话：搜得到，但如实说不属于任何版本',
      rowOf({ query: '暗色主题' }, 'p2')?.hit?.versionIndex === null,
    )
    ok('一个版本都没有的应用也能搜到', ids({ query: '周报' }).join() === 'p4')
    ok('助手消息不当搜索底稿', ids({ query: '生成好' }).length === 0, ids({ query: '生成好' }).join())
    ok('搜不到就是空的', ids({ query: '这张表不存在' }).length === 0)
    ok('只看收藏', ids({ starredOnly: true }).join() === 'p1')
    ok('关键词 + 只看收藏 一起用', ids({ query: '记账', starredOnly: true }).join() === 'p1')
    ok('关键词 + 引擎筛选 一起用', ids({ query: '番茄钟', engine: 'model' }).length === 0)

    ok('引擎＝演示', ids({ engine: 'demo' }).join() === 'p1,p2')
    ok('引擎＝真模型', ids({ engine: 'model' }).join() === 'p3')
    ok('引擎＝还没生成', ids({ engine: 'empty' }).join() === 'p4')
    ok('engineOf 跟着当前版走', engineOf(habit) === 'model' && engineOf(ledger) === 'demo' && engineOf(blank) === 'empty')

    ok('当前版＝选中的那一版', currentVersionOf(habit)?.index === 2)
    ok('没选中时退回最后一版', currentVersionOf(ledger)?.index === 1)
    ok('没有版本时是 undefined', currentVersionOf(blank) === undefined)

    ok('排序＝创建时间（新的在前）', ids({ sort: 'created' }).join() === 'p4,p3,p2,p1')
    const byVersions = ids({ sort: 'versions' })
    ok('排序＝版本数（多的在前）', byVersions[0] === 'p3', byVersions.join())
    ok('显式排序时收藏不再插队', byVersions.join() === 'p3,p1,p2,p4', byVersions.join())
    const names = filterProjects(all, { ...DEFAULT_QUERY, sort: 'name' }).map((r) => r.project.name)
    ok(
      '排序＝名称（按本地语言的升序）',
      names.every((n, i) => i === 0 || names[i - 1]!.localeCompare(n, 'zh-CN') <= 0),
      names.join(' > '),
    )
    ok('排序不丢项', names.length === 4 && ids({ sort: 'name' }).length === 4)
    const before = all.map((p) => p.id).join()
    filterProjects(all, { ...DEFAULT_QUERY, sort: 'name', query: '记账' })
    ok('筛选不改动原始数组', all.map((p) => p.id).join() === before)

    ok('没动筛选时不算"正在筛选"', !isFiltering(DEFAULT_QUERY))
    ok('只输入空白不算筛选', !isFiltering({ ...DEFAULT_QUERY, query: '   ' }))
    ok('搜索 / 只看收藏 / 引擎 都算正在筛选', isFiltering({ ...DEFAULT_QUERY, query: 'a' }) && isFiltering({ ...DEFAULT_QUERY, starredOnly: true }) && isFiltering({ ...DEFAULT_QUERY, engine: 'empty' }))
  }

  const total = passed + failures.length
  console.log('')
  if (failures.length === 0) {
    console.log(`✅ 冒烟测试通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

void main()
