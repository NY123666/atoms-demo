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

/**
 * 棋盘类布局的探针：把几何量下来，再把"尺寸会变"的几种情形演一遍。
 * 判断（谁在谁里面、有没有错位、有没有叠在一起）全放到 Node 那边算，
 * 这样失败时能直接报出差了多少像素，而不是只说一句 false。
 *
 * 量位置用的是 offsetLeft/offsetTop/offsetWidth/offsetHeight，不是 getBoundingClientRect：
 * 后者把 CSS 动画的 transform 也算进去，而这套无头跑法（虚拟时间 + --dump-dom）
 * 不会推进动画帧，量到的会是动画第一帧的缩放值，白白报出错位。
 * 另外一个坑：left/top 过渡（transition）在这种跑法下也停在起点不动，
 * 于是"刚滑动完"的方块量出来还在老位置上，跟旁边新到的方块看成重叠。
 * 探针里给产物加一条测试用的 transition:none!important，量的是静止后的布局位置——
 * 过渡只是"多久到"，不影响"到哪"。
 * 另外这套跑法也不会再派发 resize 观察通知，所以"容器变窄后重算"由 resize 事件触发
 * （真实环境里那条路走 ResizeObserver，模板两条都监听）。
 */
const HARNESS_BOARD = `<script>
(function () {
  var s = document.createElement('style');
  s.textContent = '*{transition:none!important}';
  document.head.appendChild(s);
})();
window.__forge_msgs = window.__forge_msgs || [];
window.addEventListener('message', function (e) {
  if (e.data && e.data.__forge) window.__forge_msgs = (window.__forge_msgs || []).concat([String(e.data.__forge)]);
});

window.addEventListener('load', function () {
  var R = { probe: [], phases: {} };

  function rr(el) {
    var r = el.getBoundingClientRect();
    return { l: +r.left.toFixed(2), t: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  }
  /* 布局位置：不含 transform，格子和数字块在同一个坐标系（都以 #board 为 offsetParent） */
  function or(el) {
    return { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  function each(sel, f) {
    var out = [], ns = document.querySelectorAll(sel), i;
    for (i = 0; i < ns.length; i++) out.push(f(ns[i]));
    return out;
  }
  function snap() {
    var board = document.getElementById('board');
    var wrap = document.querySelector('.wrap');
    if (!board || !wrap) return null;
    var cs = getComputedStyle(board);
    return {
      wrap: rr(wrap),
      board: rr(board),
      /* 内容盒尺寸：百分比是拿它当基准的，和带边框的外框宽度差 2px */
      inner: { w: board.clientWidth, h: board.clientHeight },
      cellVar: parseFloat(cs.getPropertyValue('--cell')) || 0,
      cellPct: String(cs.getPropertyValue('--cell-pct')).trim(),
      vw: document.documentElement.clientWidth,
      cells: each('#cells .cell', or),
      tiles: each('#tiles .tile:not(.gone)', function (el) {
        var o = or(el);
        o.v = el.textContent;
        o.fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        return o;
      })
    };
  }
  function press(key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
  }
  function nudge() { window.dispatchEvent(new Event('resize')); }
  function after(ms, fn) { setTimeout(fn, ms); }
  function write() {
    R.probe = window.__forge_msgs || [];
    var box = document.createElement('div');
    box.id = '__forge_test_result';
    box.style.display = 'none';
    box.textContent = JSON.stringify(R);
    document.body.appendChild(box);
  }

  try {
    var board = document.getElementById('board');
    if (!board) throw new Error('产物里没有 #board：模板没匹配上');
    var wrap = document.querySelector('.wrap');

    /* "0 宽首屏"那个用例在 <head> 里塞了一段 #board{display:none}：
       产物的脚本读到的宽度是 0，量不出 --cell。这里把它放出来，
       看数字块是不是照样落在格子里（位置用百分比就不该受影响）。 */
    var hide = document.getElementById('__forge_hide_board');
    var t = 300;
    after(t, function () { if (hide && hide.parentNode) hide.parentNode.removeChild(hide); });
    t += 150;
    after(t, function () { R.phases.t0 = snap(); });           /* 刚显示出来的第一帧 */
    ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].forEach(function (k) {
      t += 180;
      after(t, function () { press(k); });                     /* 键盘真能操作，且对齐不错 */
    });
    t += 260;
    after(t, function () { R.phases.t1 = snap(); });
    t += 40;
    after(t, function () { board.style.setProperty('--cell', '6px'); });
    t += 120;
    after(t, function () { R.phases.t2 = snap(); });           /* 尺寸量错了也不该错位 */
    t += 40;
    after(t, function () { nudge(); });
    t += 200;
    after(t, function () { R.phases.t3 = snap(); });           /* 尺寸相关的量要补算回来 */
    t += 40;
    after(t, function () { if (wrap) wrap.style.maxWidth = '260px'; nudge(); });
    t += 240;
    after(t, function () { R.phases.t4 = snap(); });           /* 预览区变窄 → 整个棋盘跟着重算 */
    after(t + 60, write);
  } catch (e) {
    R.fatal = String(e);
    write();
  }
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

interface Rect {
  l: number
  t: number
  w: number
  h: number
}
interface TileRect extends Rect {
  v: string
  fs: number
}
/** 一次几何快照：棋盘、背景格、数字块的实测矩形，外加棋盘内容盒尺寸与两个自定义属性 */
interface Snap {
  wrap: Rect
  board: Rect
  inner: { w: number; h: number }
  cellVar: number
  cellPct: string
  vw: number
  cells: Rect[]
  tiles: TileRect[]
}
interface BoardResult {
  probe: string[]
  phases: Record<string, Snap | null>
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

/**
 * 把探针挂进产物：默认放在 </body> 前。
 * headExtra 用来往 </head> 前再塞一段（比如"脚本运行的那一刻棋盘宽度是 0"）。 */
function withHarness(html: string, harness = HARNESS, headExtra = ''): string {
  const withHead = headExtra
    ? html.replace(/<\/head\s*>/i, `${headExtra}\n</head>`)
    : html
  const end = withHead.match(/<\/body\s*>/i)
  if (end && end.index !== undefined) return withHead.slice(0, end.index) + harness + '\n' + withHead.slice(end.index)
  return withHead + harness
}

interface CaseOpts {
  /** 视口尺寸，用来验证"同样的产物在窄视口下也摆得对" */
  windowSize?: string
  harness?: string
  /** 插到 </head> 前的额外标记（例：把棋盘先藏起来，模拟"脚本跑的时候容器还是 0 宽"） */
  headExtra?: string
}

function runCase<T = HarnessResult>(browser: string, name: string, html: string, opts: CaseOpts = {}): T {
  const file = resolve(OUT, `${name}.html`)
  writeFileSync(file, withHarness(instrument(html), opts.harness ?? HARNESS, opts.headExtra ?? ''), 'utf8')
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
      ...(opts.windowSize ? [`--window-size=${opts.windowSize}`] : []),
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
  return JSON.parse(json) as T
}

/* ------------------------------ 棋盘几何断言 ------------------------------ */

/** 每个数字块与它最贴近的那个背景格的四个边差多少像素 —— 错位就是这里变大的。 */
function worstOffset(s: Snap): { max: number; detail: string } {
  let max = 0
  let detail = ''
  for (const t of s.tiles) {
    let best = Number.POSITIVE_INFINITY
    for (const c of s.cells) {
      const d = Math.max(Math.abs(t.l - c.l), Math.abs(t.t - c.t), Math.abs(t.w - c.w), Math.abs(t.h - c.h))
      if (d < best) best = d
    }
    if (best > max) {
      max = best
      detail = `${t.v} 差 ${best.toFixed(2)}px`
    }
  }
  return { max, detail }
}

function overlaps(s: Snap): number {
  let n = 0
  for (let i = 0; i < s.tiles.length; i++) {
    for (let j = i + 1; j < s.tiles.length; j++) {
      const a = s.tiles[i]
      const b = s.tiles[j]
      const ox = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l)
      const oy = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t)
      if (ox > 1.5 && oy > 1.5) n++
    }
  }
  return n
}

/**
 * `sized: false` 用在故意把 --cell 写错的那一帧：那两处断言本来就该不成立，
 * 要证明的恰恰是"尺寸相关的量错了，位置也不会错位"。
 */
function checkBoard(label: string, s: Snap | null | undefined, opts: { sized?: boolean } = {}): boolean {
  const sized = opts.sized !== false
  if (!s || !s.board || !Array.isArray(s.cells) || s.cells.length === 0) {
    ok(`${label}：拿到了棋盘几何`, false, JSON.stringify(s ?? null).slice(0, 160))
    return false
  }
  const cell = s.cells[0]
  ok(`${label}：拿到了棋盘几何`, true)
  ok(`${label}：16 个背景格`, s.cells.length === 16, `实际 ${s.cells.length}`)
  ok(
    `${label}：背景格大小一致`,
    s.cells.every((c) => Math.abs(c.w - cell.w) <= 0.5 && Math.abs(c.h - cell.h) <= 0.5),
    `首格 ${cell.w}×${cell.h}`,
  )
  ok(`${label}：棋盘是正方形`, Math.abs(s.board.w - s.board.h) <= 1.5, `${s.board.w}×${s.board.h}`)
  /* 百分比是拿棋盘的内容盒当基准的：外框还带 1px 边框，比错了会差出 0.2 个百分点 */
  const base = s.inner && s.inner.w > 0 ? s.inner.w : s.board.w
  ok(
    `${label}：格子占比与 --cell-pct 一致`,
    Math.abs(cell.w / base - parseFloat(s.cellPct) / 100) <= 0.002,
    `${((cell.w / base) * 100).toFixed(2)}% vs ${s.cellPct}`,
  )
  const off = worstOffset(s)
  ok(`${label}：每个数字块都完整落在某个格子里`, off.max <= 1.5, off.detail || `最大偏差 ${off.max.toFixed(2)}px`)
  const dup = overlaps(s)
  ok(`${label}：数字块没有叠在一起`, dup === 0, `叠了 ${dup} 对`)
  ok(
    `${label}：棋盘在预览区里左右居中`,
    Math.abs(s.board.l - s.wrap.l - (s.wrap.l + s.wrap.w - s.board.l - s.board.w)) <= 2,
    `左 ${(s.board.l - s.wrap.l).toFixed(2)}px / 右 ${(s.wrap.l + s.wrap.w - s.board.l - s.board.w).toFixed(2)}px`,
  )
  ok(`${label}：棋盘没有超出预览区`, s.board.w <= s.wrap.w + 0.5, `${s.board.w} vs ${s.wrap.w}`)
  if (sized) {
    ok(`${label}：--cell 就是实测的格子边长`, Math.abs(s.cellVar - cell.w) <= 1.5, `--cell=${s.cellVar} 实测=${cell.w}`)
    ok(
      `${label}：字号跟着格子尺寸走`,
      s.tiles.every((t) => t.fs > cell.w * 0.25 && t.fs < cell.w * 0.55),
      s.tiles.map((t) => `${t.v}:${t.fs}px`).join(' '),
    )
  }
  return true
}

function posKey(s: Snap): string {
  return s.tiles
    .map((t) => `${t.l},${t.t}`)
    .sort()
    .join('|')
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

  console.log('— 场景 D：棋盘类布局（两层共用坐标系 + 量到尺寸后才算字号）—')
  const boardCase = DEMO_SHOWCASE.find((x) => x.label.includes('2048')) ?? DEMO_SHOWCASE[5]
  if (!boardCase) throw new Error('DEMO_SHOWCASE 结构变了')
  const boardHtml = generateDemo(boardCase.prompt, 0).html

  const d = runCase<BoardResult>(browser, 'board-desktop', boardHtml, {
    harness: HARNESS_BOARD,
    windowSize: '1200,900',
  })
  ok('棋盘用例没有致命错误', !d.fatal, d.fatal)
  ok('探针上报了 ready', (d.probe ?? []).includes('ready'), JSON.stringify(d.probe))
  const t0 = d.phases?.t0
  const t1 = d.phases?.t1
  const t2 = d.phases?.t2
  const t3 = d.phases?.t3
  const t4 = d.phases?.t4
  checkBoard('首帧', t0)
  checkBoard('键盘操作后', t1)
  checkBoard('--cell 被写错时', t2, { sized: false })
  checkBoard('resize 之后', t3)
  checkBoard('预览区收窄后', t4)
  if (t0) console.log(`  首帧：棋盘 ${t0.board.w}px、格子 ${t0.cells[0]?.w}px、--cell ${t0.cellVar}px`)
  if (t0 && t1) {
    ok(
      '键盘真的推动了棋盘',
      posKey(t0) !== posKey(t1) || t0.tiles.length !== t1.tiles.length,
      `${t0.tiles.length} 块 / ${t1.tiles.length} 块`,
    )
  }
  if (t1 && t2) {
    ok('错帧确实把 --cell 写成了 6px', Math.abs(t2.cellVar - 6) < 0.01, String(t2.cellVar))
    /* t1 和 t2 之间只有 --cell 被改坏：同一套方块、同一次操作。位置还是那个位置，就证明定位不依赖测量 */
    ok(
      '位置用百分比：--cell 被写错也照样落在同一个格子里',
      posKey(t1) === posKey(t2) && Math.abs((t2.cells[0]?.w ?? 0) - (t1.cells[0]?.w ?? 0)) <= 1,
      `${posKey(t1).slice(0, 40)} vs ${posKey(t2).slice(0, 40)}｜格子 ${t1.cells[0]?.w} → ${t2.cells[0]?.w}`,
    )
  }
  if (t3) {
    ok(
      'resize 之后 --cell 被补算回来',
      Math.abs(t3.cellVar - (t3.cells[0]?.w ?? 0)) <= 1.5,
      `--cell=${t3.cellVar} 实测=${t3.cells[0]?.w}`,
    )
  }
  if (t0 && t4) {
    ok('预览区变窄 → 棋盘跟着变小', t4.board.w < t0.board.w - 20, `${t0.board.w} → ${t4.board.w}`)
    ok('预览区变窄 → 格子边长重算', t4.cellVar < t0.cellVar - 1, `${t0.cellVar} → ${t4.cellVar}`)
  }

  /*
   * 场景 F：把"脚本跑的那一刻棋盘还是 0 宽"这种情况单独造出来。
   * 用户报的"数字缩在左上角"就是这么来的：容器没尺寸时把格子边长算死。
   * 这里在 <head> 里先给 #board 挂上 display:none，让产物量到 0，
   * 随后探针把它放出来 —— 位置用百分比，所以第一帧就该整整齐齐。
   */
  console.log('— 场景 F：脚本运行时容器还是 0 宽 —')
  const z = runCase<BoardResult>(browser, 'board-zero-width', boardHtml, {
    harness: HARNESS_BOARD,
    windowSize: '1200,900',
    headExtra: '<style id="__forge_hide_board">#board{display:none!important}</style>',
  })
  ok('0 宽用例没有致命错误', !z.fatal, z.fatal)
  const z0 = z.phases?.t0
  const z3 = z.phases?.t3
  checkBoard('0 宽首屏（只看位置，不看尺寸）', z0, { sized: false })
  checkBoard('0 宽首屏 resize 之后', z3)
  if (z0) console.log(`  0 宽首帧：棋盘 ${z0.board.w}px、格子 ${z0.cells[0]?.w}px、--cell ${z0.cellVar}px`)
  if (z0 && z3) {
    ok('0 宽起步的棋盘在量到尺寸后字号跟上来了', Math.abs(z3.cellVar - (z3.cells[0]?.w ?? 0)) <= 1.5, `--cell=${z3.cellVar}`)
  }

  console.log('— 场景 E：同样的棋盘放进手机尺寸的窗口 —')
  const p = runCase<BoardResult>(browser, 'board-phone', boardHtml, {
    harness: HARNESS_BOARD,
    windowSize: '400,900',
  })
  ok('窄视口用例没有致命错误', !p.fatal, p.fatal)
  checkBoard('手机首帧', p.phases?.t0)
  checkBoard('手机收窄后', p.phases?.t4)
  if (t0 && p.phases?.t0) {
    const pt = p.phases.t0
    console.log(`  手机首帧：视口 ${pt.vw}px、棋盘 ${pt.board.w}px、格子 ${pt.cells[0]?.w}px`)
    ok('窗口更窄 → 棋盘更小', pt.board.w < t0.board.w - 20, `${t0.board.w} → ${pt.board.w}`)
    ok('棋盘跟着视口缩到窗口里', pt.board.w <= pt.vw, `${pt.board.w} vs 视口 ${pt.vw}`)
  }
  if (p.phases?.t0 && p.phases?.t4) {
    ok('手机下收窄预览区也会重算', p.phases.t4.cellVar < p.phases.t0.cellVar - 1, `${p.phases.t0.cellVar} → ${p.phases.t4.cellVar}`)
  }

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
