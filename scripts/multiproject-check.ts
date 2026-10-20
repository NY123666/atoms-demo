/**
 * 真浏览器验证：「多个项目同时制作」。
 *
 * 之前生成状态住在 Workbench 里，切走项目 = 组件卸载 = 卸载清理把 AbortController 一掐，
 * 后台的生成当场死掉，这就是「无法多个项目同时制作」的根因。
 * 现在生成会话搬到组件外（src/lib/runSession.ts），切项目不该再打断生成。
 *
 * 这里直接演用户的路数：在项目 A 里发起生成，刚开跑就切到项目 B、也在 B 里发起生成，
 * 等两边都在后台跑完、落盘，再回 A —— 断言 A 的这轮不但没被切走掐死，还正常存档成了 v1。
 *
 * 运行：npm run smoke:multi
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const DIST = resolve('dist')
const STAGE = resolve('.tmp/multi-check')
const SUB = join(STAGE, 'atoms-demo')
const PROFILE = resolve('.tmp/edge-profile-multi')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/** 第一步：种下两个空项目（谁都没跑过），并让 app 直接开在 A。 */
const SEED = `<script>
(function () {
  var t0 = Date.now();
  function project(id, name) {
    return { id: id, name: name, createdAt: t0, updatedAt: t0, starred: false, currentVersionId: null, messages: [], versions: [] };
  }
  try {
    localStorage.setItem('forge:projects', JSON.stringify({ v: 1, data: [project('p-multi-a', '甲项目'), project('p-multi-b', '乙项目')] }));
    localStorage.setItem('forge:settings', JSON.stringify({ v: 1, data: { activeProviderId: 'demo' } }));
  } catch (e) { window.__multi_seed_err = String(e); }
})();
</script>`

/**
 * 第二步：A 里发起生成 → 刚开跑就切去 B、B 里也发起 → 等两边都在后台跑完落盘 → 回 A 看存档。
 * React 的受控输入要喂原生 setter + input 事件，点击之后也要让出一轮事件循环再读。
 */
const PROBE = `<script>
window.addEventListener('load', function () {
  function text(el) { return (el ? el.textContent || '' : '').replace(/\\s+/g, ' ').trim(); }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  /* 后台生成跑完、store 落盘（250ms 延时写）后，localStorage 里就能看到版本数 */
  function versionsOf(id) {
    try {
      var env = JSON.parse(localStorage.getItem('forge:projects') || '{"v":1,"data":[]}');
      var p = env.data.find(function (x) { return x.id === id; });
      return p ? p.versions.length : -1;
    } catch (e) { return -1; }
  }
  function fill() {
    var ta = document.querySelector('.composer textarea');
    if (!ta) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '做一个待办清单，能筛选和统计完成率');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function clickSubmit() {
    var b = document.querySelector('.composer .btn-primary');
    if (b) b.click();
  }
  async function waitFor(sel, budget) {
    var tries = 0;
    while (tries < budget && !document.querySelector(sel)) { await wait(25); tries++; }
    return !!document.querySelector(sel);
  }
  /* 切项目后 React 要一帧才提交新组件，光等 textarea 可能抓到旧项目的残留 DOM；
     必须等到标题输入框的值变成目标项目名，才算真的挂上了。 */
  async function waitForTitle(name, budget) {
    var tries = 0;
    while (tries < budget) {
      var ti = document.querySelector('.title-input');
      if (ti && ti.value === name) return true;
      await wait(25); tries++;
    }
    return false;
  }

  var r = { seedErr: window.__multi_seed_err || '' };

  async function main() {
    try {
      /* A：等挂出输入框，填需求，点生成，确认真的开跑了 */
      r.aMounted = await waitFor('.composer textarea', 150);
      if (!fill()) throw new Error('A 的输入框没找到');
      await wait(80);
      clickSubmit();
      await wait(150);
      r.aStarted = !!document.querySelector('.steplog') &&
        text(document.querySelector('.steplog-head strong')).indexOf('正在执行') >= 0;

      /* 刚开跑就切去 B（Workbench 卸载，A 的生成从此在后台走），B 里也发起一轮 */
      window.location.hash = '#/p/p-multi-b';
      r.bMounted = await waitForTitle('乙项目', 200);
      if (!fill()) throw new Error('B 的输入框没找到');
      await wait(80);
      clickSubmit();
      await wait(150);
      r.bStarted = !!document.querySelector('.steplog') &&
        text(document.querySelector('.steplog-head strong')).indexOf('正在执行') >= 0;

      /* 两边都在后台跑：等 A、B 各落盘至少一版（此刻 A 不在屏幕上） */
      var poll = 0;
      while (poll < 240 && !(versionsOf('p-multi-a') >= 1 && versionsOf('p-multi-b') >= 1)) { await wait(50); poll++; }
      r.aVersionsBg = versionsOf('p-multi-a');
      r.bVersionsBg = versionsOf('p-multi-b');

      /* 回 A：这轮生成没被切走掐死，执行记录该渲染出来、版本 tag 是 v1 */
      window.location.hash = '#/p/p-multi-a';
      await waitForTitle('甲项目', 200);
      await waitFor('.run-record', 150);
      r.aRunRecords = document.querySelectorAll('.run-record').length;
      r.aStatus = text(document.querySelector('.run-record-status'));
      r.aMeta = text(document.querySelector('.run-record-meta'));
      r.aTag = text(document.querySelector('.work-head .tag'));
      r.aVersionCount = document.querySelectorAll('.timeline-list .tl-item').length;

      /* B 也该各自存好 */
      window.location.hash = '#/p/p-multi-b';
      await waitForTitle('乙项目', 200);
      await waitFor('.run-record', 150);
      r.bRunRecords = document.querySelectorAll('.run-record').length;
      r.bStatus = text(document.querySelector('.run-record-status'));
      r.bTag = text(document.querySelector('.work-head .tag'));
    } catch (e) { r.fatal = String(e); }

    var box = document.createElement('div');
    box.id = '__multi_probe';
    box.style.display = 'none';
    box.textContent = JSON.stringify(r);
    document.body.appendChild(box);
  }
  main();
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
    console.log('⚠️  本机找不到 Edge/Chrome，跳过「多项目同时制作」验证（不影响其它关卡）')
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

  const jsAsset = indexHtml.match(/src="\.?\/?([^"]+\.js)"/)?.[1]
  const bundle = jsAsset ? readFileSync(join(SUB, jsAsset), 'utf8') : ''
  ok(
    'dist 是新的（含后台生成会话）',
    bundle.includes('正在生成'),
    jsAsset ? `${jsAsset} 里没有后台会话代码（runSession.ts 的占位文案没进包），先跑一次 npm run build` : 'index.html 里找不到 js 资源',
  )

  const seeded = indexHtml.replace(/<head>/i, '<head>' + SEED)
  const lastBody = seeded.lastIndexOf('</body>')
  const probed =
    lastBody === -1
      ? seeded + '\n' + PROBE
      : seeded.slice(0, lastBody) + PROBE + '\n' + seeded.slice(lastBody)
  ok('种子探针挂上了', seeded !== indexHtml)
  ok('验证探针挂上了', probed !== seeded)
  writeFileSync(join(SUB, 'index.html'), probed)

  rmSync(PROFILE, { recursive: true, force: true })
  const url = `file:///${join(SUB, 'index.html').split(sep).join('/')}#/p/p-multi-a`
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

  const raw = dump.match(/<div id="__multi_probe"[^>]*>([\s\S]*?)<\/div>/)?.[1]
  if (process.env.MULTI_DEBUG) console.log('RAW PROBE:', raw ?? '(none)', '\nDOM len', dump.length)
  if (!raw) {
    ok('页面回传了探针结果', false, `DOM 长度 ${dump.length}`)
  } else {
    const r = JSON.parse(
      raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
    ) as Record<string, unknown>
    ok('种子写入没报错', r.seedErr === '', String(r.seedErr))
    ok('A 的工作台挂出来了', r.aMounted === true, String(r.aMounted))
    ok('A 里发起后确实在跑', r.aStarted === true, String(r.aStarted))
    ok('切到 B 后 B 的工作台挂出来了', r.bMounted === true, String(r.bMounted))
    ok('B 里发起后确实在跑', r.bStarted === true, String(r.bStarted))
    /* 关键断言：切走 A 时 A 的生成没被掐死，和 B 一起在后台跑完并落盘 */
    ok('A 的生成在后台跑完并存档', Number(r.aVersionsBg) >= 1, `A 后台落盘版本数 ${String(r.aVersionsBg)}`)
    ok('B 的生成也各自存档', Number(r.bVersionsBg) >= 1, `B 后台落盘版本数 ${String(r.bVersionsBg)}`)
    /* 回到 A：能看到这次生成的执行记录，且对应 v1 */
    ok('回 A 能看到执行记录', Number(r.aRunRecords) >= 1, `记录数 ${String(r.aRunRecords)}`)
    ok('A 的记录标注「已存档」', String(r.aStatus).includes('已存档'), String(r.aStatus))
    ok('A 的记录带步数与耗时', String(r.aMeta).includes('/5 步') || String(r.aMeta).includes('/6 步'), String(r.aMeta))
    ok('A 的版本 tag 是 v1', r.aTag === 'v1', `tag=${String(r.aTag)}`)
    ok('A 存了一版', Number(r.aVersionCount) >= 1, `版本数 ${String(r.aVersionCount)}`)
    ok('B 也有执行记录', Number(r.bRunRecords) >= 1, `记录数 ${String(r.bRunRecords)}`)
    ok('B 的记录标注「已存档」', String(r.bStatus).includes('已存档'), String(r.bStatus))
    ok('B 的版本 tag 是 v1', r.bTag === 'v1', `tag=${String(r.bTag)}`)
    ok('探针没报错', !r.fatal, String(r.fatal))
    console.log(
      `  多项目并发：A 后台存 ${String(r.aVersionsBg)} 版 + B 存 ${String(r.bVersionsBg)} 版，回 A 记录=${String(r.aStatus)}（${String(r.aMeta)}）`,
    )
  }

  console.log('')
  const total = passed + failures.length
  if (failures.length === 0) {
    console.log(`✅ 「多个项目同时制作」验证通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

main()
