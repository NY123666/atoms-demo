/**
 * 演示模式下的"迭代增强"层。
 *
 * 为什么需要它：模板库是确定性的，同一个需求重复生成会得到一模一样的 HTML。
 * 但"改一版"是这个产品最核心的动作，点下去却得到字节级相同的产物，是说不通的。
 *
 * 做法：迭代时不重新套模板，而是在上一版 HTML 上做增量的、真的能跑的功能补丁。
 * 补丁写在通用 DOM 层（不依赖具体模板结构），所以对模型生成的产物同样适用：
 * - 版本徽标与变更记录（保证任何一次迭代都可见地不同）
 * - 搜索/筛选：自动识别页面里的重复列表项并按文本过滤
 * - 导出 JSON：把识别到的列表项序列化下载
 * - 柱状图：从列表项文本里抽出数值画成条形图
 * - 暗色切换：覆写主题变量
 *
 * 累积语义：每一版都保留上一版注入的脚本块，每个功能各带一个 window 级开关，
 * 于是"第 3 版"打开时按顺序执行 1→2→3 的补丁，最终得到叠加后的能力，
 * 且重复迭代同一个需求不会挂上两个一模一样的按钮。
 *
 * 识别不到列表内容时不硬凑，而是在产物里如实说明"列表类功能已跳过"。
 */

/** 样式表的存在标记（不能与运行时标记互为子串，否则会误判为已注入）。 */
const STYLE_MARK = 'id="__forge_enhance_style"'

/** 迭代时轮换强调色，让"换了一版"一眼可见。 */
const REVISION_ACCENTS = ['#6d5cff', '#0ea5a4', '#e0508d', '#f08c00', '#2f9e44', '#3b82f6', '#b197fc']

interface Enhancement {
  id: string
  label: string
  keywords: string[]
  /** 上一版里已经存在同类能力的判断依据 */
  present: RegExp
}

const CATALOG: Enhancement[] = [
  {
    id: 'search',
    label: '搜索筛选框',
    keywords: ['搜索', '搜一下', '查找', '过滤', '筛选', 'search', 'filter', '查询'],
    present: /placeholder\s*=\s*["'][^"']*(搜索|筛选|查找)/i,
  },
  {
    id: 'export',
    label: '导出 JSON',
    keywords: ['导出', '下载', 'export', 'download', 'json', 'csv', '备份'],
    present: /导出\s*JSON|\.json/i,
  },
  {
    id: 'chart',
    label: '数值柱状图',
    keywords: ['柱状图', '图表', '条形图', '统计图', '可视化', '趋势', 'chart', '占比', '比例'],
    present: /柱状图|条形图|占比图|趋势图|barChart|drawChart/,
  },
  {
    id: 'dark',
    label: '暗色主题切换',
    keywords: ['暗色', '深色', '夜间', '黑暗', 'dark', '主题切换', '换肤'],
    present: /切换暗色|__forge-dark|dark-?mode|toggleTheme/i,
  },
]

export interface EnhanceResult {
  html: string
  /** 真的注入了的增强 */
  applied: string[]
  /** 上一版里已经有、这次跳过的 */
  skipped: string[]
  /** 这次迭代没能挂上任何功能（只有版本徽标与主色变化） */
  fallback: boolean
}

/**
 * 界面上「下一步可以加什么」用的措辞。
 * 和 `keywords` 是两件事：keywords 是**理解用户说了什么**，这里是**替用户把话说出来**。
 * 每条都必须能被 `planEnhancements` 命中，否则点了不会生效 —— 冒烟测试把这条钉住了。
 */
const SUGGEST_PROMPTS: Record<string, string> = {
  search: '加一个搜索框，能按关键词过滤列表',
  export: '支持导出成 JSON 文件',
  chart: '把列表里的数值用柱状图统计出来',
  dark: '再加一个暗色主题切换',
}

export interface EnhanceSuggestion {
  id: string
  label: string
  /** 点一下填进输入框的那句话 */
  prompt: string
}

export interface EnhanceOverview {
  /** 这一版已经有的通用能力（用来告诉用户"为什么建议变少了"） */
  have: string[]
  /** 这一版还没有、因此值得推荐的（点了真的能挂上） */
  suggest: EnhanceSuggestion[]
}

/**
 * 读一版产物，算出「已经有什么」和「下一步能加什么」。
 *
 * 和 `applyEnhancements` 走**同一套**判定（`capabilityHaystack` + `injectedFeatures`），
 * 这一点是刻意的：如果这里用"有没有看见这几个字"来判，工具条上那个写着「导出 JSON」的按钮
 * 会让界面以为产物自带导出能力，于是它**建议过了、却永远挂不上**——
 * 那正是这套代码早先踩过的坑，不能换个地方再踩一遍。
 */
export function analyzeEnhancements(html: string | null | undefined): EnhanceOverview {
  const source = html ?? ''
  const hasSource = source.trim().length > 0
  const haystack = hasSource ? capabilityHaystack(source) : ''
  const injected = hasSource ? injectedFeatures(source) : new Set<string>()
  const have: string[] = []
  const suggest: EnhanceSuggestion[] = []
  for (const e of CATALOG) {
    if (injected.has(e.id) || e.present.test(haystack)) {
      have.push(e.label)
      continue
    }
    const prompt = SUGGEST_PROMPTS[e.id]
    if (prompt) suggest.push({ id: e.id, label: e.label, prompt })
  }
  return { have, suggest }
}

const TOOLBAR_CSS = [
  '.__forge_bar{position:sticky;top:0;z-index:2147483000;display:flex;flex-wrap:wrap;gap:8px;align-items:center;',
  'padding:8px 12px;background:rgba(12,14,24,.82);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.12);',
  'font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#e8ebff}',
  '.__forge_badge{background:linear-gradient(135deg,#6d5cff,#e0508d);color:#fff;padding:3px 9px;border-radius:999px;font-weight:700;letter-spacing:.3px}',
  '.__forge_bar button{background:rgba(255,255,255,.10);color:#e8ebff;border:1px solid rgba(255,255,255,.16);border-radius:8px;',
  'padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}',
  '.__forge_bar button:hover{background:rgba(255,255,255,.2)}',
  '.__forge_bar input{width:170px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:8px;',
  'color:#e8ebff;padding:4px 10px;font-size:12px;font-family:inherit;outline:none}',
  '.__forge_bar input::placeholder{color:rgba(232,235,255,.5)}',
  '.__forge_note{color:rgba(232,235,255,.72);font-size:11px}',
  '.__forge_panel{position:fixed;right:14px;bottom:14px;width:min(360px,92vw);max-height:56vh;overflow:auto;z-index:2147483000;',
  'background:rgba(12,14,24,.94);border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:14px;color:#e8ebff;',
  'font:500 12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.45)}',
  '.__forge_panel h4{margin:0 0 10px;font-size:13px}',
  '.__forge_bar_row{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.__forge_bar_row span{width:76px;color:rgba(232,235,255,.7);flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.__forge_bar_fill{height:10px;border-radius:5px;background:linear-gradient(90deg,#6d5cff,#8b5cff);min-width:2px}',
  '.__forge_bar_val{color:rgba(232,235,255,.85);margin-left:auto;flex:none}',
  '.__forge_x{position:absolute;right:10px;top:8px;background:none;border:0;color:rgba(232,235,255,.6);cursor:pointer;font-size:16px}',
  'html.__forge-dark{--bg:#0f1220;--bg2:#0b0e1a;--panel:#171c30;--panel2:#1e2440;--line:#2b3455;--text:#e8ebff;--muted:#9098bd;color-scheme:dark}',
  'html.__forge-dark body{background:linear-gradient(180deg,#0f1220,#0b0e1a)!important;color:#e8ebff!important}',
  'html.__forge-dark .card,html.__forge-dark .panel,html.__forge-dark .item,html.__forge-dark .task{background:#171c30!important;border-color:#2b3455!important}',
  'html.__forge-dark input,html.__forge-dark select,html.__forge-dark textarea{background:#1e2440!important;color:#e8ebff!important;border-color:#2b3455!important}',
  'html.__forge-dark .muted,html.__forge-dark .sub{color:#9098bd!important}',
].join('')

/* ------------------------------------------------------------------ */
/* 注入到产物里的运行时：每次迭代注入一块，块与块之间通过 window 级开关协作 */
/* ------------------------------------------------------------------ */

const RUNTIME = `
(function () {
  function makeHub() {
    var ITEMS = [];
    var bar = null;

    function isForge(el) {
      var n = el;
      while (n && n.classList && n !== document.body) {
        if (String(n.className).indexOf('__forge') >= 0) return true;
        n = n.parentElement;
      }
      return false;
    }

    function textOf(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); }

    /* 找页面里最像"一列数据"的那组元素：同一个父节点下、同标签、成员多、每条文本不长。
       两个坑都在这里挡掉：
       1) 布局容器（比如一排筛选按钮的外层 div）会被当成数据项 —— 用"组内成员占该父节点子元素的比例"筛掉，
          真正的一列数据几乎占满父节点，两三个布局块只占一小部分；
       2) 数据项自己的子元素（li 里的 span）会单独成组、条数还一样多 —— 按父节点深度裁决，外层优先。 */
    function collect() {
      var byKey = {}, best = [], bestScore = 0, bestDepth = 0, i, el, t, k, p, depth, sib, cover, score;
      var all = document.querySelectorAll('li,tr,p,dt,dd,span,label,article,section > *,tbody > *,ul > *,ol > *');
      for (i = 0; i < all.length; i++) {
        el = all[i];
        if (isForge(el)) continue;
        if (el.children.length > 8) continue;
        t = textOf(el);
        if (!t || t.length > 200) continue;
        /* 同一个父节点用一次性的标记属性认领，光靠 tag+class 会把不同 li 里的 span 归成一组 */
        p = el.parentNode;
        if (!p) continue;
        if (!p.__forge_pid) p.__forge_pid = 'p' + i;
        k = p.__forge_pid + '|' + el.tagName;
        (byKey[k] = byKey[k] || []).push(el);
      }
      for (k in byKey) {
        var g = byKey[k];
        if (g.length < 2) continue;
        p = g[0].parentElement;
        sib = p ? p.children.length : g.length;
        cover = sib ? g.length / sib : 1;
        if (cover < 0.5) continue;
        depth = 0;
        for (var n = p; n; n = n.parentElement) depth++;
        score = g.length * 3 + (cover >= 0.9 ? 4 : 0) + (/^(LI|TR|DT|DD|ARTICLE)$/.test(g[0].tagName) ? 2 : 0);
        if (!best.length || score > bestScore || (score === bestScore && depth < bestDepth)) {
          best = g; bestScore = score; bestDepth = depth;
        }
      }
      return best;
    }

    function getBar() {
      if (bar && bar.parentNode) return bar;
      var found = document.querySelector('.__forge_bar');
      if (found) { bar = found; return bar; }
      bar = document.createElement('div');
      bar.className = '__forge_bar';
      var b = document.createElement('span');
      b.className = '__forge_badge';
      bar.appendChild(b);
      if (document.body) document.body.insertBefore(bar, document.body.firstChild);
      return bar;
    }

    return {
      collect: collect,
      textOf: textOf,
      isForge: isForge,
      items: function () { return ITEMS; },
      setItems: function (v) { ITEMS = v; },
      /* list 用于"现在有没有内容"的判断，结果会缓存；
         find 每次重新扫 DOM——产物自己会重渲染列表，缓存下来的节点会变成游离节点。 */
      list: function () { if (!ITEMS.length) ITEMS = collect(); return ITEMS; },
      find: function () { ITEMS = collect(); return ITEMS; },
      bar: getBar,
      badge: function (t) { getBar().querySelector('.__forge_badge').textContent = t; },
      note: function (t) {
        var s = document.createElement('span');
        s.className = '__forge_note';
        s.textContent = t;
        getBar().appendChild(s);
        return s;
      },
      button: function (label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', fn);
        getBar().appendChild(b);
        return b;
      }
    };
  }

  var H = window.__forge_h || (window.__forge_h = makeHub());
  var REV = {REV};
  var PLAN = {FEATURES};

  function installSearch() {
    if (!H.list().length) return false;
    var box = document.createElement('input');
    box.type = 'search';
    box.placeholder = '筛选 / 搜索…';
    var counter = H.note('');
    box.addEventListener('input', function () {
      /* 每次输入都重新取一遍当前列表：产物重渲染后旧节点已经不在了 */
      var items = H.find(), q = box.value.trim().toLowerCase(), shown = 0, i;
      for (i = 0; i < items.length; i++) {
        var hit = !q || H.textOf(items[i]).toLowerCase().indexOf(q) >= 0;
        items[i].style.display = hit ? '' : 'none';
        if (hit) shown++;
      }
      counter.textContent = q ? '匹配 ' + shown + ' / ' + items.length + ' 条' : '';
    });
    H.bar().appendChild(box);
    return true;
  }

  function installExport() {
    if (!H.list().length) return false;
    H.button('导出 JSON', function () {
      var items = H.find(), rows = [], i;
      for (i = 0; i < items.length; i++) {
        if (items[i].style.display === 'none') continue;
        rows.push({ index: i + 1, text: H.textOf(items[i]) });
      }
      var payload = JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, rows: rows }, null, 2);
      var url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = 'data-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    });
    return true;
  }

  /* 数值柱状图：从每条数据里抽第一个数字，凑不出两个数就不硬画 */
  function numbers(items) {
    var out = [], i;
    for (i = 0; i < items.length; i++) {
      var txt = H.textOf(items[i]);
      var m = txt.match(/-?\\d+(?:\\.\\d+)?/);
      if (m) out.push({ label: txt.slice(0, 10), value: Math.abs(parseFloat(m[0])) });
    }
    return out;
  }

  function installChart() {
    if (numbers(H.list()).length < 2) return false;
    H.button('柱状图', function () {
      var old = document.querySelector('.__forge_panel');
      if (old) { old.remove(); return; }
      var series = numbers(H.find());
      if (series.length < 2) { H.note('当前列表里没凑出两个数值，画不了图'); return; }
      var top = series.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
      var max = top[0].value || 1;
      var panel = document.createElement('div');
      panel.className = '__forge_panel';
      var html = '<button class="__forge_x" type="button">×</button><h4>数值分布（共 ' + series.length + ' 条，取前 ' + top.length + '）</h4>';
      for (var j = 0; j < top.length; j++) {
        var pct = Math.max(3, Math.round((top[j].value / max) * 100));
        html += '<div class="__forge_bar_row"><span>' + top[j].label.replace(/[<>&"]/g, '') + '</span>' +
          '<div class="__forge_bar_fill" style="width:' + pct + '%"></div><span class="__forge_bar_val">' + top[j].value + '</span></div>';
      }
      panel.innerHTML = html;
      panel.querySelector('.__forge_x').addEventListener('click', function () { panel.remove(); });
      document.body.appendChild(panel);
    });
    return true;
  }

  function installDark() {
    var btn = H.button('切换暗色', function () {
      var on = document.documentElement.classList.toggle('__forge-dark');
      btn.textContent = on ? '切换亮色' : '切换暗色';
      try { if (typeof Store !== 'undefined') Store.set('__forge_dark', on ? '1' : '0'); } catch (e) { }
    });
    try {
      if (typeof Store !== 'undefined' && Store.get('__forge_dark') === '1') btn.click();
    } catch (e) { }
    return true;
  }

  var INSTALLERS = { search: installSearch, export: installExport, chart: installChart, dark: installDark };
  var LABELS = { search: '搜索筛选', export: '导出 JSON', chart: '柱状图', dark: '暗色切换' };

  function boot() {
    /* REV 是这一版的 0 基下标，对外显示的版本号和主界面保持一致 = 下标 + 1 */
    var VER = REV + 1;
    H.badge('v' + VER + ' 迭代');
    var done = [], i, id, flag;
    for (i = 0; i < PLAN.length; i++) {
      id = PLAN[i];
      flag = '__forge_feat_' + id;
      if (window[flag]) continue;
      window[flag] = 1;
      try {
        if (INSTALLERS[id] && INSTALLERS[id]()) done.push(LABELS[id]);
        else window[flag] = 0;
      } catch (e) { window[flag] = 0; }
    }
    if (done.length) H.note('v' + VER + ' 新增：' + done.join('、'));
    else if (PLAN.length) H.note('v' + VER + '：' + (H.list().length ? '功能已就绪' : '页面里没识别到列表内容，列表类功能已跳过'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
`

/* ------------------------------------------------------------------ */

function injectStyle(html: string, accent: string): string {
  const tag = `<style id="__forge_enhance_style">:root{--accent:${accent}}\n${TOOLBAR_CSS}</style>`
  const head = html.match(/<\/head\s*>/i)
  if (head && head.index !== undefined) {
    return html.slice(0, head.index) + tag + '\n' + html.slice(head.index)
  }
  const body = html.match(/<body[^>]*>/i)
  if (body && body.index !== undefined) {
    const at = body.index + body[0].length
    return html.slice(0, at) + tag + '\n' + html.slice(at)
  }
  return tag + '\n' + html
}

/** 每版运行时块自己的标记，用来判断"这一版"是否已经注入过。 */
function revisionMark(revision: number): string {
  return `/*__forge_runtime_v${revision}__*/`
}

function injectRuntime(html: string, features: string[], revision: number): string {
  const script =
    '<script>' +
    revisionMark(revision) +
    RUNTIME.replace('{REV}', String(revision)).replace('{FEATURES}', JSON.stringify(features)) +
    '</script>'
  const end = html.match(/<\/body\s*>/i)
  if (end && end.index !== undefined) {
    return html.slice(0, end.index) + script + '\n' + html.slice(end.index)
  }
  return html + '\n' + script
}

/** 按需给上一版产物打上增量功能补丁（同名能力已在上一版里存在时不重复添加）。 */
export function planEnhancements(prompt: string): Enhancement[] {
  const lower = prompt.toLowerCase()
  return CATALOG.filter((e) => e.keywords.some((k) => lower.includes(k.toLowerCase())))
}

/**
 * 判断"上一版是不是已经有这个能力"时用的底稿，两处噪声必须先摘掉，
 * 否则"已有能力"的判定会被我们自己的痕迹和源码注释顶掉，功能就再也补不上了：
 * 1) 我们注入的工具条样式与运行时块 —— 按钮文案本身就写着"导出 JSON"，
 *    第二版起每次都命中，导出功能会被永久判为"上一版已有"；
 * 2) 注释 —— 模板源码里的说明性注释（比如"再改一版 → 加搜索/导出/柱状图"）
 *    是写给人看的，不是页面上的能力，但正则分不出来。
 * 摘掉这两类之后剩下的才是"产物真正带着的实现"（比如 ledger 里真的 `a.download = '*.json'`）。
 */
export function capabilityHaystack(html: string): string {
  return html
    .replace(/<script>\s*\/\*__forge_runtime_v\d+__\*\/[\s\S]*?<\/script>/g, '')
    .replace(/<style id="__forge_enhance_style">[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * 上一版里"我们自己注入过"的功能 id：从已存在的运行时块里读回它声明的 PLAN。
 * 这样"上一版已经有搜索框"既认得出来（不重复加、也不虚报"新增"），
 * 又不会被工具条按钮上的文案骗到——文案只是文字，不代表产物自带这个能力。
 */
function injectedFeatures(html: string): Set<string> {
  const ids = new Set<string>()
  for (const block of html.matchAll(/<script>\s*\/\*__forge_runtime_v\d+__\*\/[\s\S]*?<\/script>/g)) {
    const plan = block[0].match(/var PLAN = (\[[^\]]*\])/)
    if (!plan || !plan[1]) continue
    try {
      for (const id of JSON.parse(plan[1]) as string[]) ids.add(id)
    } catch {
      /* 产物被外部改过就当作没识别到，交给下面那套正则兜底 */
    }
  }
  return ids
}

export function applyEnhancements(html: string, prompt: string, revision: number): EnhanceResult {
  const requested = planEnhancements(prompt)
  const applied: string[] = []
  const skipped: string[] = []
  const features: string[] = []
  const haystack = capabilityHaystack(html)
  const injected = injectedFeatures(html)

  for (const e of requested) {
    if (injected.has(e.id) || e.present.test(haystack)) {
      skipped.push(e.label)
      continue
    }
    features.push(e.id)
    applied.push(e.label)
  }

  const accent = REVISION_ACCENTS[revision % REVISION_ACCENTS.length]!

  // 样式表只注入一次，之后每次只更新主色；运行时块按需追加
  let out = html.includes(STYLE_MARK)
    ? html.replace(/(<style id="__forge_enhance_style">:root\{--accent:)[^}]*/, `$1${accent}`)
    : injectStyle(html, accent)

  // 每一版都必须追加自己的运行时块（块之间靠 window 级开关协作）。
  // 判重的依据是"这一版的块在不在里面"，而不是"有没有块"——
  // 否则第二次迭代会以为运行时已经就绪，那一版点名的功能就永远挂不上。
  if (!out.includes(revisionMark(revision))) {
    out = injectRuntime(out, features, revision)
  }

  return { html: out, applied, skipped, fallback: applied.length === 0 }
}

/** 给界面和日志用的一句话总结。 */
export function describeEnhancements(res: EnhanceResult): string {
  const parts: string[] = []
  if (res.applied.length) parts.push(`新增 ${res.applied.join('、')}`)
  if (res.skipped.length) parts.push(`${res.skipped.join('、')} 上一版已有，未重复添加`)
  if (!parts.length) parts.push('未识别到可自动实现的功能，仅更换主色并标注版本')
  return parts.join('；')
}
