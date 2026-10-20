/**
 * 真浏览器验证：生成执行记录的「刷新后回看」。
 *
 * 离线冒烟只能证明 buildRun/finalizeSteps 这些纯函数和 localStorage 往返是对的，
 * 证明不了"聊天里真的把记录渲染出来了、点开还能跳回那一版"。
 * 这里把打包产物复制到子目录，先往 localStorage 里种下一个带两轮执行记录的项目
 * （模拟"生成一次、修改一次"都已完成并存档），再像用户一样打开项目，
 * 断言两轮记录都能在聊天里展开回看，并对应到各自的代码版本。
 *
 * 运行：npm run smoke:runlog
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const DIST = resolve('dist')
const STAGE = resolve('.tmp/runlog-check')
const SUB = join(STAGE, 'atoms-demo')
const PROFILE = resolve('.tmp/edge-profile-runlog')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/** 第一步：在 app 的模块脚本执行**之前**把项目种进 localStorage（等于"上一轮已经生成并存过档"）。 */
const SEED = `<script>
(function () {
  var t0 = Date.now();
  function st(title, detail, weight, startedAt, finishedAt) {
    return { title: title, detail: detail, weight: weight, status: 'done', startedAt: startedAt, finishedAt: finishedAt };
  }
  function pend(title) { return { title: title, detail: '', weight: 1, status: 'pending' }; }
  function err(title, detail) { return { title: title, detail: detail, weight: 1, status: 'error' }; }

  /* 第一轮：demo 引擎，5 步，全 done */
  var run1 = {
    source: 'demo', status: 'done', prompt: '做一个待办清单，能筛选和统计完成率',
    startedAt: t0 - 60000, finishedAt: t0 - 55000, durationMs: 5000, autoFixed: false,
    steps: [
      st('解析需求', '识别为「清单 / 任务管理」类需求', 0.7, t0 - 60000, t0 - 59500),
      st('生成代码', '产出单文件 HTML，共 22.3 KB', 3, t0 - 59500, t0 - 57000),
      st('静态自检', '自检通过：结构完整、无外部依赖', 0.6, t0 - 57000, t0 - 56500),
      st('装载预览', '已装载到沙箱预览', 0.5, t0 - 56500, t0 - 56000),
      st('总结产物', '已存档 v1', 0.4, t0 - 56000, t0 - 55000),
    ],
  };
  /* 第二轮：llm，6 步，全 done */
  var run2 = {
    source: 'llm', status: 'done', prompt: '加一个搜索框，能按关键词过滤',
    startedAt: t0 - 30000, finishedAt: t0 - 25000, durationMs: 5000, autoFixed: true,
    steps: [
      st('解析需求', '识别为「清单 / 任务管理」类需求', 0.6, t0 - 30000, t0 - 29500),
      st('组装上下文', '载入上一版产物作为基线', 0.6, t0 - 29500, t0 - 29000),
      st('调用模型生成', '耗时 1.2s · 输出 8123 字符', 3, t0 - 29000, t0 - 27000),
      st('抽取产物', '抽取策略：代码块 · 22.4 KB', 0.6, t0 - 27000, t0 - 26600),
      st('静态自检', '自检通过（第 2 次尝试修复成功）', 0.7, t0 - 26600, t0 - 25800),
      st('装载预览', '已装载到沙箱预览', 0.5, t0 - 25800, t0 - 25000),
    ],
  };
  /* 第三轮：失败，没存档 */
  var runBad = {
    source: 'llm', status: 'error', prompt: '做一个看板',
    startedAt: t0 - 20000, finishedAt: t0 - 15000, durationMs: 5000,
    error: '模型这次没有返回可用的 HTML。可以重试一次，或换一个更擅长写代码的模型。',
    steps: [
      st('解析需求', '识别为「数据 / 后台管理」类需求', 0.6, t0 - 20000, t0 - 19500),
      err('调用模型生成', '模型这次没有返回可用的 HTML。'),
      pend('抽取产物'),
      pend('静态自检'),
      pend('装载预览'),
    ],
  };

  var project = {
    id: 'p-runlog-check', name: '执行记录回看测试',
    createdAt: t0 - 60000, updatedAt: t0 - 15000, starred: false, currentVersionId: 'v-2',
    messages: [
      { id: 'm-u1', role: 'user', content: '做一个待办清单，能筛选和统计完成率', createdAt: t0 - 60000 },
      { id: 'm-a1', role: 'assistant', content: '已生成 v1「待办清单」，耗时 5.0s。', createdAt: t0 - 55000, versionId: 'v-1', run: run1 },
      { id: 'm-u2', role: 'user', content: '加一个搜索框，能按关键词过滤', createdAt: t0 - 30000 },
      { id: 'm-a2', role: 'assistant', content: '已生成 v2「待办清单」，耗时 5.0s。', createdAt: t0 - 25000, versionId: 'v-2', run: run2 },
      { id: 'm-ab', role: 'assistant', content: '生成失败：模型这次没有返回可用的 HTML。', createdAt: t0 - 15000, run: runBad },
    ],
    versions: [
      { id: 'v-1', index: 1, label: '待办清单', html: '<!doctype html><html><body>todo</body></html>', prompt: '做一个待办清单，能筛选和统计完成率', createdAt: t0 - 55000, durationMs: 5000, source: 'demo', run: run1 },
      { id: 'v-2', index: 2, label: '待办清单', html: '<!doctype html><html><body>todo+search</body></html>', prompt: '加一个搜索框，能按关键词过滤', createdAt: t0 - 25000, durationMs: 5000, source: 'llm', autoFixed: true, run: run2 },
    ],
  };

  try {
    localStorage.setItem('forge:projects', JSON.stringify({ v: 1, data: [project] }));
    localStorage.setItem('forge:settings', JSON.stringify({ v: 1, data: { activeProviderId: 'demo' } }));
    window.location.hash = '#/p/p-runlog-check';
  } catch (e) { window.__runlog_seed_err = String(e); }
})();
</script>`

/**
 * 第二步：等 app 挂载完，展开记录、点跳转，把结论写回隐藏节点。
 *
 * 关键约束：点击之后**不能立刻**读结果。React 的状态更新不是同步落到 DOM 上的，
 * `btn.click()` 当场读 `.run-record.open` 只会读到「还没展开」。
 * 所以这里把每个动作拆成"点一下 → 让出一轮事件循环 → 再读"，
 * 而不是一口气同步跑完。虚拟时下 setTimeout 是能跑的（探针能收集到数据就是证据），
 * 所以用 setTimeout(…, 60) 让位足够。
 */
const PROBE = `<script>
window.addEventListener('load', function () {
  var r = { seedErr: window.__runlog_seed_err || '' };
  /* 注意 \\s 要写成两个反斜杠：这段是模板字符串，单个 \s 会退化成字母 s，
     把正文里的 s 全吃掉（"5.0s" 变成 "5.0"）。 */
  function text(el) { return (el ? el.textContent || '' : '').replace(/\\s+/g, ' ').trim(); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function finish() {
    var box = document.createElement('div');
    box.id = '__runlog_probe';
    box.style.display = 'none';
    box.textContent = JSON.stringify(r);
    document.body.appendChild(box);
  }

  /* 1) 等记录渲染出来（React 提交是异步的） */
  var tries = 0;
  function waitForRecords() {
    if (document.querySelectorAll('.run-record').length >= 3 || ++tries > 600) { snapshot(); return; }
    setTimeout(waitForRecords, 25);
  }

  /* 2) 读静态信息，然后点开第一轮记录 */
  function snapshot() {
    try {
      r.tries = tries;
      r.records = document.querySelectorAll('.run-record').length;
      r.heads = all('.run-record-head strong').map(text);
      r.statuses = all('.run-record-status').map(text);
      r.metas = all('.run-record-meta').map(text);
      /* 轮数 = 存档的版本数（版本存档列表里每条 tl-item 就是一版） */
      r.versionCount = document.querySelectorAll('.timeline-list .tl-item').length || -1;
      r.chatHasHistory = !!document.querySelector('.chat-scroll');
      var first = document.querySelector('.run-record-head');
      if (first) first.click();
    } catch (e) { r.fatal = String(e); }
    setTimeout(readExpanded, 60);
  }

  /* 3) 展开后读步骤，再点"查看这一版产物" */
  function readExpanded() {
    try {
      var body = document.querySelector('.run-record.open .run-record-body');
      r.expanded = !!body;
      if (body) {
        r.expandedSteps = body.querySelectorAll('.step').length;
        r.expandedTitles = Array.prototype.slice.call(body.querySelectorAll('.step-title'), 0, 2).map(text);
        var jump = body.querySelector('.msg-action');
        r.hasJumpV1 = !!jump;
        if (jump) {
          jump.click();
          setTimeout(readTag, 60);
          return;
        }
      }
    } catch (e) { r.fatal = String(e); }
    setTimeout(openBad, 60);
  }

  function readTag() {
    try {
      var tag = document.querySelector('.work-head .tag');
      r.tagAfterJumpV1 = text(tag);
    } catch (e) { r.fatal = String(e); }
    setTimeout(openBad, 60);
  }

  /* 4) 失败那条：原因文案只在展开后才在 DOM 里，所以也要先点开 */
  function openBad() {
    try {
      var bad = document.querySelector('.run-error');
      r.badRecord = !!bad;
      if (bad) { var head = bad.querySelector('.run-record-head'); if (head) head.click(); }
    } catch (e) { r.fatal = String(e); }
    setTimeout(readBad, 60);
  }

  function readBad() {
    try {
      var bad = document.querySelector('.run-error');
      if (bad) {
        r.badError = text(bad.querySelector('.run-record-error')).slice(0, 40);
        /* 失败这轮没存档，所以不该出现"查看这一版产物" */
        r.badHasJump = !!bad.querySelector('.msg-action');
      }
    } catch (e) { r.fatal = String(e); }
    finish();
  }

  waitForRecords();
});
</script>`

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function findBrowser(): string | null {
  for (const p of CANDIDATES) if (existsSync(p)) return p
  return null
}

function main(): void {
  const browser = findBrowser()
  if (!browser) {
    console.log('⚠️  本机找不到 Edge/Chrome，跳过执行记录回看验证（不影响其它关卡）')
    return
  }
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('⚠️  dist/ 不存在，先跑 npm run build（这里不会替你构建）')
    process.exitCode = 1
    return
  }

  console.log(`浏览器：${browser}`)
  rmSync(STAGE, { recursive: true, force: true })
  mkdirSync(SUB, { recursive: true })
  cpSync(DIST, SUB, { recursive: true })

  const indexHtml = readFileSync(join(SUB, 'index.html'), 'utf8')

  /* 先自查产物是不是新的。dist 陈旧时探针永远找不到 .run-record，
     最后报出来的却是"页面没回传探针结果"，很容易把人带到错的思路上（这个坑真踩过）。
     所以这里直接说清楚：先去 npm run build。 */
  const jsAsset = indexHtml.match(/src="\.?\/?([^"]+\.js)"/)?.[1]
  const bundle = jsAsset ? readFileSync(join(SUB, jsAsset), 'utf8') : ''
  ok(
    'dist 是新的（含执行记录组件）',
    bundle.includes('run-record'),
    jsAsset ? `${jsAsset} 里没有 run-record，先跑一次 npm run build` : 'index.html 里找不到 js 资源',
  )
  /* 种子必须在模块脚本执行前跑，所以插在 <head> 开头 */
  const seeded = indexHtml.replace(/<head>/i, '<head>' + SEED)
  /* 探针要挂在文档**真正**的 </body> 前。不能直接 replace(/<\/body>/i)：
     种子里的 html 字符串（如 '<!doctype html><html><body>todo</body></html>'）也含 </body>，
     那样会把探针插进种子脚本中间，把种子脚本切成两半。
     必须取文档里**最后一个** </body>。 */
  const lastBody = seeded.lastIndexOf('</body>')
  const probed =
    lastBody === -1
      ? seeded + '\n' + PROBE
      : seeded.slice(0, lastBody) + PROBE + '\n' + seeded.slice(lastBody)
  ok('种子探针挂上了', seeded !== indexHtml)
  ok('验证探针挂上了', probed !== seeded)
  writeFileSync(join(SUB, 'index.html'), probed)

  rmSync(PROFILE, { recursive: true, force: true })
  const url = `file:///${join(SUB, 'index.html').split(sep).join('/')}#/p/p-runlog-check`
  const dump = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--allow-file-access-from-files',
      `--user-data-dir=${PROFILE}`,
      '--virtual-time-budget=30000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 45_000 },
  )

  const raw = dump.match(/<div id="__runlog_probe"[^>]*>([\s\S]*?)<\/div>/)?.[1]
  if (process.env.RUNLOG_DEBUG) console.log('RAW PROBE:', raw ?? '(none)', '\nDOM len', dump.length)
  if (!raw) {
    ok('页面回传了探针结果', false, `DOM 长度 ${dump.length}`)
  } else {
    const r = JSON.parse(
      raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
    ) as Record<string, unknown>
    ok('种子写入没报错', r.seedErr === '', String(r.seedErr))
    ok('聊天历史渲染出来了', r.chatHasHistory === true, String(r.chatHasHistory))
    ok('三轮回看记录都在', r.records === 3, `记录数 ${String(r.records)}`)
    ok('每条都标注了状态（已存档/失败）', (r.statuses as string[]).join(',').includes('已存档') && (r.statuses as string[]).includes('失败'), String(r.statuses))
    ok('摘要里带步数与耗时', (r.metas as string[]).join(' ').includes('/5 步') && (r.metas as string[]).join(' ').includes('/6 步'), String(r.metas))
    ok('展开第一轮能回看步骤', r.expanded === true, String(r.expanded))
    ok('第一轮是 5 步', r.expandedSteps === 5, `步数 ${String(r.expandedSteps)}`)
    ok('步骤标题回来了', (r.expandedTitles as string[]).length >= 2, String(r.expandedTitles))
    ok('能跳回对应版本 v1', r.hasJumpV1 === true && r.tagAfterJumpV1 === 'v1', `tag=${String(r.tagAfterJumpV1)}`)
    ok('两轮记录对应两版存档', r.versionCount === 2, `版本数 ${String(r.versionCount)}`)
    ok('失败记录带原因、无跳转按钮', r.badRecord === true && String(r.badError).includes('没有返回可用的 HTML') && r.badHasJump === false, `error=${String(r.badError)} jump=${String(r.badHasJump)}`)
    ok('探针没报错', !r.fatal, String(r.fatal))
    console.log(`  三轮回看：已存档 ×2 / 失败 ×1，v1 展开 5 步，跳转后 tag=${String(r.tagAfterJumpV1)}`)
  }

  console.log('')
  const total = passed + failures.length
  if (failures.length === 0) {
    console.log(`✅ 执行记录回看验证通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

main()
