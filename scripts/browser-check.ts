/**
 * 真浏览器验证：把演示引擎产出的单文件应用写进临时目录，
 * 用本机 Chromium（Edge/Chrome）无头加载，然后断言注入的运行时真的干活了。
 *
 * 离线冒烟测试只能证明"字符串长得对"，证明不了"搜索框真的能过滤、柱状图真的能画"。
 * 这里就是补上这一段：脚本会在页面里模拟输入和点击，把结果写回 DOM 再读出来。
 *
 * 运行：npm run smoke:dom
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEMO_SHOWCASE, generateDemo } from '../src/lib/demoEngine'
import { instrument } from '../src/lib/sandbox'

const OUT = resolve('.tmp/dom')
const PROFILE = resolve('.tmp/edge-profile')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/** 页面里跑的探针：模拟用户操作，把结论写回一个隐藏节点。 */
const HARNESS = `<script>
(function () {
  /* 导出功能用的是 Blob + a.download。无头浏览器里真的触发下载会让进程一直不退出，
     所以这里把点击拦下来，改成直接把 Blob 内容读出来——比"点一下没报错"验证得更实。 */
  var originCreate = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    try { blob.text().then(function (t) { window.__forge_export_payload = t; }); } catch (e) { }
    return originCreate.call(URL, blob);
  };
  HTMLAnchorElement.prototype.click = function () { window.__forge_export_clicked = this.href; };
})();

window.addEventListener('load', function () {
  setTimeout(function () {
    var r = { probe: window.__forge_msgs || [] };
    function isForge(el) {
      var n = el; while (n && n.classList && n !== document.body) {
        if (String(n.className).indexOf('__forge') >= 0) return true; n = n.parentElement;
      } return false;
    }
    function btn(label) {
      var bs = document.querySelectorAll('.__forge_bar button');
      for (var i = 0; i < bs.length; i++) if (bs[i].textContent.indexOf(label) >= 0) return bs[i];
      return null;
    }
    function items() {
      var all = document.querySelectorAll('li,.item,.task,.todo,.entry,tr');
      var out = [];
      for (var i = 0; i < all.length; i++) if (!isForge(all[i])) out.push(all[i]);
      return out;
    }
    try {
      r.hasBar = !!document.querySelector('.__forge_bar');
      var badge = document.querySelector('.__forge_badge');
      r.badge = badge ? badge.textContent : '';
      r.buttons = Array.prototype.map.call(document.querySelectorAll('.__forge_bar button'), function (b) { return b.textContent; });
      r.notes = Array.prototype.map.call(document.querySelectorAll('.__forge_note'), function (b) { return b.textContent; });

      var box = document.querySelector('.__forge_bar input');
      r.hasSearch = !!box;
      if (box) {
        var list = items();
        r.itemCount = list.length;
        r.itemTexts = list.slice(0, 5).map(function (e) { return (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40); });
        box.value = 'zzz-nothing-matches-zzz';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        var hidden = 0;
        for (var i = 0; i < list.length; i++) if (list[i].style.display === 'none') hidden++;
        r.hiddenOnNoMatch = hidden;
        box.value = '';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        var back = 0;
        for (var j = 0; j < list.length; j++) if (list[j].style.display !== 'none') back++;
        r.shownAfterClear = back;
      }

      var chart = btn('柱状图');
      r.hasChartButton = !!chart;
      if (chart) { chart.click(); r.chartPanel = !!document.querySelector('.__forge_panel'); }

      /* 用产物里那份运行时自己的列表识别 + 数值抽取再算一遍：
         探针的 items() 是独立写死的选择器，两边一致才说明"识别到列表"不是测试的错觉。 */
      r.searchInputCount = document.querySelectorAll('.__forge_bar input').length;
      if (window.__forge_h) {
        var hub = window.__forge_h.find();
        r.hubItems = hub.length;
        var nums = [];
        for (var k = 0; k < hub.length; k++) {
          var mm = window.__forge_h.textOf(hub[k]).match(/-?\\d+(?:\\.\\d+)?/);
          nums.push(mm ? mm[0] : null);
        }
        r.hubNumbers = nums;
      }

      var exp = btn('导出 JSON');
      r.hasExportButton = !!exp;
      if (exp) { exp.click(); r.exportClicked = true; }

      var dark = btn('切换暗色') || btn('切换亮色');
      r.hasDarkButton = !!dark;
      if (dark) {
        /* 暗色是个开关：断言"点一下状态翻转"而不是"点完必须是暗的" */
        r.darkBefore = document.documentElement.classList.contains('__forge-dark');
        dark.click();
        r.darkAfter = document.documentElement.classList.contains('__forge-dark');
      }

      try { Store.set('k', 'v'); r.storeWorks = Store.get('k') === 'v'; } catch (e) { r.storeWorks = 'err:' + e; }
    } catch (e) { r.fatal = String(e); }

    /* 等 Blob 读出来再落盘 */
    setTimeout(function () {
      r.exportPayload = window.__forge_export_payload || '';
      var box = document.createElement('div');
      box.id = '__forge_test_result';
      box.style.display = 'none';
      box.textContent = JSON.stringify(r);
      document.body.appendChild(box);
    }, 250);
  }, 700);
});
window.addEventListener('message', function (e) {
  if (e.data && e.data.__forge) window.__forge_msgs = (window.__forge_msgs || []).concat([String(e.data.__forge)]);
});
</script>`

interface HarnessResult {
  probe: string[]
  hasBar?: boolean
  badge?: string
  buttons?: string[]

  notes?: string[]
  hasSearch?: boolean
  searchInputCount?: number
  itemCount?: number
  /** 产物内运行时自己认出来的列表条数与抽出的数字 */
  hubItems?: number
  hubNumbers?: (string | null)[]

  hiddenOnNoMatch?: number
  shownAfterClear?: number
  hasChartButton?: boolean
  chartPanel?: boolean
  hasExportButton?: boolean
  exportClicked?: boolean
  exportPayload?: string
  hasDarkButton?: boolean
  darkBefore?: boolean
  darkAfter?: boolean
  /** 诊断用：真的被当成"列表"的那些节点长什么样 */
  itemTexts?: string[]
  storeWorks?: boolean | string
  fatal?: string
}

let passed = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/* 解析被截获的导出载荷：只关心"是不是合法 JSON、有几行、每行是不是都有内容" */
function parseExport(r: HarnessResult): { ok: boolean; rows: number; blankRows: number } {
  try {
    const data = JSON.parse(r.exportPayload || '') as { rows?: { text?: string }[] }
    const rows = Array.isArray(data.rows) ? data.rows : []
    return { ok: true, rows: rows.length, blankRows: rows.filter((x) => !String(x?.text ?? '').trim()).length }
  } catch {
    return { ok: false, rows: -1, blankRows: -1 }
  }
}

function findBrowser(): string | null {
  for (const p of CANDIDATES) if (existsSync(p)) return p
  return null
}

function withHarness(html: string): string {
  const end = html.match(/<\/body\s*>/i)
  if (end && end.index !== undefined) return html.slice(0, end.index) + HARNESS + '\n' + html.slice(end.index)
  return html + HARNESS
}

function runCase(browser: string, name: string, html: string): HarnessResult {
  const file = resolve(OUT, `${name}.html`)
  writeFileSync(file, withHarness(instrument(html)), 'utf8')
  // 每个用例一个独立 profile：避免和用户自己开的浏览器抢锁，也避免用例之间互相干扰。
  // 每次跑之前清掉：产物自己会往 localStorage 里写状态（比如暗色开关），
  // 留着上一次的档案会让"首屏默认值"随运行次数漂移，测试就不再是同一个起点了。
  const profile = `${PROFILE}-${name}`
  rmSync(profile, { recursive: true, force: true })
  const dump = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=4000',
      '--dump-dom',
      `file:///${file.replace(/\\/g, '/')}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 45_000 },
  )
  const m = dump.match(/<div id="__forge_test_result"[^>]*>([\s\S]*?)<\/div>/)
  if (!m || !m[1]) throw new Error(`页面没有回传结果（${name}），DOM 长度 ${dump.length}`)
  const json = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return JSON.parse(json) as HarnessResult
}

function main(): void {
  const browser = findBrowser()
  if (!browser) {
    console.log('⚠️  本机找不到 Edge/Chrome，跳过浏览器验证（离线冒烟测试不受影响）')
    return
  }
  console.log(`浏览器：${browser}`)
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const todo = DEMO_SHOWCASE[3]
  const snake = DEMO_SHOWCASE[0]
  if (!todo || !snake) throw new Error('DEMO_SHOWCASE 结构变了')

  console.log('— 场景 A：待办清单 + 一次点名多项功能的迭代 —')
  const v1 = generateDemo(todo.prompt, 0)
  const v2 = generateDemo('加一个搜索框，支持导出成 JSON，画个柱状图，再加暗色主题切换', 1, v1.html)
  const a = runCase(browser, 'todo-v2', v2.html)

  ok('页面没有致命错误', !a.fatal, a.fatal)
  ok('迭代工具条已渲染', a.hasBar === true)
  ok('版本徽标显示 v2', a.badge === 'v2 迭代', `实际 ${a.badge}`)
  ok('点名的四个功能都挂上了', (a.buttons ?? []).length >= 3 && a.hasChartButton === true, JSON.stringify(a.buttons))
  ok('同一个功能没有重复挂两次', new Set(a.buttons ?? []).size === (a.buttons ?? []).length, JSON.stringify(a.buttons))
  console.log(`  工具条：${JSON.stringify(a.buttons)}｜被当成列表的节点：${JSON.stringify(a.itemTexts)}`)
  console.log(`  产物内运行时认出的数字：${JSON.stringify(a.hubNumbers)}`)
  ok('注入了搜索框', a.hasSearch === true)
  ok('识别到了列表项', (a.itemCount ?? 0) >= 3, `itemCount=${a.itemCount}`)
  /* 产物里那份运行时用的是通用 DOM 扫描，和探针写死的选择器是两套逻辑，两边对上才算真的认准了 */
  ok('运行时自己认出的列表和独立选择器一致', a.hubItems === a.itemCount, `运行时 ${a.hubItems} / 探针 ${a.itemCount}`)
  ok(
    '能从列表里抽出两个以上数值（柱状图的前提）',
    (a.hubNumbers ?? []).filter(Boolean).length >= 2,
    JSON.stringify(a.hubNumbers),
  )
  ok(
    '搜索能真的过滤掉不匹配的条目',
    (a.hiddenOnNoMatch ?? 0) === a.itemCount,
    `隐藏 ${a.hiddenOnNoMatch} / 共 ${a.itemCount}`,
  )
  ok('清空搜索后条目恢复', a.shownAfterClear === a.itemCount, `恢复 ${a.shownAfterClear} / 共 ${a.itemCount}`)
  ok('表格/清单类产物能画出柱状图', a.chartPanel === true)
  ok('导出按钮可点击且不抛错', a.exportClicked === true)
  /* 拦截 createObjectURL 拿到了真的 Blob 内容，所以能验证导出的是结构化数据而不只是"点了没报错" */
  const payload = parseExport(a)
  ok('导出内容是合法 JSON', payload.ok, (a.exportPayload ?? '').slice(0, 120))
  ok(
    '导出的行数和页面条目数一致',
    payload.rows === (a.itemCount ?? -1),
    `导出 ${payload.rows} 行 / 页面 ${a.itemCount} 条`,
  )
  ok('导出的每一行都有文本', payload.blankRows === 0, `空行 ${payload.blankRows}`)
  ok('暗色切换真的翻转了根节点上的开关', a.darkBefore !== undefined && a.darkAfter !== a.darkBefore, `${a.darkBefore} → ${a.darkAfter}`)
  ok('产物内的存储降级封装可用', a.storeWorks === true, String(a.storeWorks))
  ok('探针上报了 ready', (a.probe ?? []).includes('ready'), JSON.stringify(a.probe))

  console.log('— 场景 B：游戏类产物（没有列表可筛选）+ 未点名功能 —')
  const b1 = generateDemo(snake.prompt, 0)
  const b2 = generateDemo('让它跑得更顺一点', 1, b1.html)
  const b = runCase(browser, 'snake-v2', b2.html)
  ok('页面没有致命错误', !b.fatal, b.fatal)
  ok('工具条仍然渲染', b.hasBar === true)
  ok('没有硬凑搜索/导出按钮', (b.buttons ?? []).length === 0, JSON.stringify(b.buttons))
  ok('没点名功能时不刷屏说明', (b.notes ?? []).length === 0, JSON.stringify(b.notes))
  ok('版本徽标仍在', b.badge === 'v2 迭代', `实际 ${b.badge}`)

  console.log('— 场景 C：连续三次迭代功能应叠加、不重复 —')
  const c1 = generateDemo(todo.prompt, 0)
  const c2 = generateDemo('加一个搜索框过滤列表', 1, c1.html)
  const c3 = generateDemo('支持导出成 JSON 文件', 2, c2.html)
  const c = runCase(browser, 'todo-v3', c3.html)
  ok('页面没有致命错误', !c.fatal, c.fatal)
  ok('徽标是最后一版', c.badge === 'v3 迭代', `实际 ${c.badge}`)
  const labels = (c.buttons ?? []).join(',')
  ok('v2 的搜索框仍在', c.hasSearch === true, labels)
  ok('v3 新增的导出也在', c.hasExportButton === true, labels)
  ok('每版各挂一次，没有重复', c.searchInputCount === 1 && (c.buttons ?? []).filter((x) => x === '导出 JSON').length === 1, `${c.searchInputCount} 个搜索框｜${labels}`)
  ok('v3 的按钮点了真能导出', c.exportClicked === true)
  /* 三个版本各注入一块运行时，打开第 3 版时按顺序回放，所以两条变更记录都应该在 */
  const notes = c.notes ?? []
  ok('v2 和 v3 的变更记录都在', notes.some((n) => n.includes('v2 新增')) && notes.some((n) => n.includes('v3 新增')), JSON.stringify(notes))

  const total = passed + failures.length
  console.log('')
  if (failures.length === 0) {
    console.log(`✅ 浏览器验证通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

main()
