/**
 * 单文件版：把 `npm run build` 的产物压成一个 **双击就能在浏览器打开** 的 HTML。
 *
 * 为什么需要它：评审未必愿意 `npm install`，也未必愿意等部署。
 * 一个 HTML 文件，双击、拖进浏览器、发微信都行，不依赖服务器、不依赖网络。
 *
 * 这里做的不是"重新实现一个简化版"，而是**把已经验证过的那个生产包原样内联**：
 * JS 内联进 `<script type="module">`、CSS 内联进 `<style>`，除此之外不改一个字节。
 * 所以单文件版和部署版是同一条代码路径，不存在"单文件版是另一个东西"的问题。
 *
 * 内联的两个坑（都会静默白屏，见 escapeForInlineScript 上方的详细说明）：
 *   1) `</script` 提前闭合脚本元素；
 *   2) `<!--` 把分词器推进 escaped 状态后再也退不出来，脚本元素永远不闭合。
 * 另外 `<script type="module" src="...">` 在 file:// 下会被 CORS 拦掉（file 源是 opaque origin），
 * 必须内联成行内模块脚本——行内模块不触发 fetch，不受这条限制。
 *
 * 另一个必须实测而不是假设的点：**file:// 下 localStorage 到底能不能用**。
 * 任务要求"数据持久化"，而单文件版全靠 file:// 跑，这一条不能靠猜，见下面的断言。
 *
 * 运行：npm run standalone（先 build）。产物：forge-standalone.html
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const DIST = resolve('dist')
const OUT = resolve('forge-standalone.html')
const STAGE = resolve('.tmp/standalone-check')
const PROFILE = resolve('.tmp/edge-profile-single')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

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

/* ------------------------------------------------------------------ */
/* 1. 打包成单文件                                                      */
/* ------------------------------------------------------------------ */

/**
 * 内联脚本躲不开 HTML 的分词器，有两处序列必须改写（**语义等价**，只是换个写法）：
 *
 *   1) `</script` —— 会把脚本元素提前闭合，后面的代码变成一堆文本；
 *      写成 `<\/script`：在字符串/模板里转义等价，在正则里 `\/` 也是合法的 `/`。
 *   2) `<!--` —— 会让分词器进入 "script data escaped" 状态；此后出现的 `<script`
 *      再把它推进 "double escaped" 状态，而只有 `</script` 才能退回来——我们的产物里
 *      恰好只有 `<\/script`（已被第 1 步转义），于是**永远退不出来**，脚本元素一直不闭合，
 *      浏览器把 `</body></html>` 都当成脚本体吃掉，报 "Unexpected token '<'" 与
 *      "Unexpected end of input"。实测就是这么白屏的。
 *      写成 `<\x21--`：`\x21` 就是 `!`，在字符串、模板、正则（含 `u` 模式）里都合法等价。
 *      这里不用 `\!`——`\!` 在带 `u` 标志的正则里是语法错误，`\x21` 没有这个隐患。
 *
 * 触发第 2 条的那一个 `<!--` 来自本仓库自己：enhance.ts 里去掉 HTML 注释用的正则。
 */
function escapeForInlineScript(code: string): { code: string; closers: number; comments: number } {
  let closers = 0
  let comments = 0
  const out = code
    .replace(/<\/script/gi, () => {
      closers += 1
      return '<\\/script'
    })
    .replace(/<!--/g, () => {
      comments += 1
      return '<\\x21--'
    })
  return { code: out, closers, comments }
}

function buildSingleFile(): { bytes: number; jsBytes: number; cssBytes: number; closers: number; comments: number } {
  const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
  const read = (rel: string) => readFileSync(join(DIST, rel), 'utf8')

  const jsRef = indexHtml.match(/<script[^>]*src="\.\/([^"]+)"[^>]*><\/script>/)?.[1]
  const cssRef = indexHtml.match(/<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/)?.[1]
  if (!jsRef || !cssRef) throw new Error('dist/index.html 里找不到 ./assets 的脚本或样式引用')

  const escaped = escapeForInlineScript(read(jsRef))
  const js = escaped.code
  /* CSS 里 `</style` 会提前闭合 style 元素。当前产物是 0 次，所以这里直接报错而不是改写：
     真出现了应该先看清楚它落在什么上下文（CSS 字符串里 `\/` 才有转义含义），别默默改坏。 */
  const cssRaw = read(cssRef)
  if (/<\/style/i.test(cssRaw)) throw new Error('CSS 里出现了 `</style`，需要人工确认内联方式')
  const css = cssRaw

  /* 注意：替换内容必须用**函数**形式给出，不能直接给字符串。
     `replace` 的字符串替换会把 `$&`（匹配到的整段）、`$$`、`` $` `` 当成替换模式，
     而压缩后的 JS 里恰好有 3 个 `$&`——第一版就是这么把 `<script src=...>` 这段标签
     原样插进了 JS 里三次，页面照样能生成、但内容是坏的（属于最坏的一类 bug：静默）。
     函数形式不做任何模式解释，原样写入。 */
  const single = indexHtml
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
    .replace(/<script[^>]*src="\.\/[^"]+"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`)
    /* 内联之后这两个属性没有意义，去掉免得让人以为还有外部请求 */
    .replace(/\s+crossorigin(="[^"]*")?/g, '')
    .replace(
      /<head>/,
      () =>
        '<head>\n    <!-- Forge 单文件版：双击即可在浏览器里打开，不需要服务器、不需要构建、不需要 API Key -->',
    )

  if (!single.includes('<script type="module">')) throw new Error('内联脚本没写进去')
  /* 逐字节校验：内联进去的必须和产物里的完全一致。
     上面那个 $& 事故只要发生一次就会在这里立刻炸出来，而不是等到用户双击发现是坏的。 */
  if (!single.includes(js)) throw new Error('内联的 JS 与产物不一致（被替换模式改写过）')
  if (!single.includes(css)) throw new Error('内联的 CSS 与产物不一致（被替换模式改写过）')

  /* 只查真正的标签引用：内联之后 `single` 里还躺着整个 JS 负载，
     里面本来就有产物模板用的 src="./..." 之类的字符串，按全文正则去查会误判成"还有外链"。 */
  const externalTags = [...single.matchAll(/<(?:script|link)\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /(?:src|href)="\.\//.test(tag))
  if (externalTags.length > 0) throw new Error(`单文件里还残留外部资源引用：${externalTags.join(' ')}`)

  /* 内联脚本一旦被字面量 `</script>` 提前截断，DOM 会从那里断掉、页面白屏——
     数量对不上就说明转义没兜住。
     期望值从 dist/index.html 自己数出来，而不是写死 1：页面里可能还有别的页内脚本
     （比如 head 里预热主题的那一段），写死的话每加一个都得回来改这里，迟早会漏。
     内联是"一个 module 脚本换一个 module 脚本"的 1:1 替换，所以脚本元素个数前后不变。 */
  const expectedClosers = (indexHtml.match(/<script\b/gi) ?? []).length
  const closers = (single.match(/<\/script>/g) ?? []).length
  if (closers !== expectedClosers) {
    throw new Error(`单文件里的 </script> 数量不对：${closers}（应为 ${expectedClosers}）`)
  }

  /* 第二处坑同理由：行内脚本里还剩字面量 `<!--` 的话，分词器会进 escaped 状态且退不出来
     （因为退回来需要的字面量 `</script` 刚被上一步全部转义掉了）。这里显式查一遍。 */
  const scriptBody = single.slice(single.indexOf('<script type="module">'))
  const dangling = (scriptBody.match(/<!--/g) ?? []).length
  if (dangling !== 0) throw new Error(`行内脚本里还剩 ${dangling} 个字面量 <!--，脚本元素不会闭合`)

  writeFileSync(OUT, single, 'utf8')
  mkdirSync(join(DIST, '..'), { recursive: true })
  copyFileSync(OUT, join(DIST, 'forge-standalone.html'))
  return {
    bytes: Buffer.byteLength(single),
    jsBytes: js.length,
    cssBytes: css.length,
    closers: escaped.closers,
    comments: escaped.comments,
  }
}

/* ------------------------------------------------------------------ */
/* 2. 用真浏览器从 file:// 打开它，并且真的走一遍主流程                    */
/* ------------------------------------------------------------------ */

const PROBE = `<script>
window.__err = [];
window.addEventListener('error', function (e) { window.__err.push(String(e.message).slice(0, 120)); });
window.addEventListener('unhandledrejection', function (e) { window.__err.push('reject: ' + String(e.reason).slice(0, 120)); });

(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function line(str) { return (str || '').replace(/\\s+/g, ' ').trim().slice(0, 60); }

  window.addEventListener('load', function () {
    setTimeout(async function () {
      var r = {};
      try {
        r.protocol = location.protocol;
        r.secure = window.isSecureContext;
        r.hasCompression = typeof CompressionStream === 'function';
        try {
          localStorage.setItem('__probe__', '1');
          r.ls = localStorage.getItem('__probe__') === '1';
          localStorage.removeItem('__probe__');
        } catch (e) { r.ls = false; r.lsErr = String(e).slice(0, 80); }

        var root = document.getElementById('root');
        r.rootLen = root ? root.innerHTML.length : 0;
        r.mounted = !!document.querySelector('.shell');
        r.brand = line(document.querySelector('.brand strong') ? document.querySelector('.brand strong').textContent : '');
        var mark = document.querySelector('.brand-mark');
        if (mark) { var ms = getComputedStyle(mark); r.markW = ms.width; r.markBg = ms.backgroundImage; }

        /* 走一遍真实交互：点一个示例 chip → 点「生成」→ 等产物挂进 iframe */
        var chip = document.querySelector('.chip');
        r.chip = line(chip ? chip.textContent : null);
        if (chip) chip.click();
        await sleep(150);
        var ta = document.querySelector('textarea');
        r.draft = line(ta ? ta.value : null);

        var btn = document.querySelector('.composer .btn-primary');
        r.submitLabel = line(btn ? btn.textContent : null);
        r.submitEnabled = !!(btn && !btn.disabled);
        if (btn) btn.click();

        var frame = null;
        for (var i = 0; i < 80; i++) {
          await sleep(250);
          frame = document.querySelector('iframe');
          if (frame && (frame.getAttribute('srcdoc') || '').length > 2000) break;
        }
        var srcdoc = frame ? frame.getAttribute('srcdoc') || '' : '';
        r.srcdocLen = srcdoc.length;
        r.srcdocHasHtml = /<html/i.test(srcdoc);
        r.hash = location.hash.slice(0, 40);
        r.sandbox = frame ? frame.getAttribute('sandbox') || '' : '';
        try {
          r.storedProjects = (localStorage.getItem('forge:projects') || '').length;
        } catch (e) { r.storedProjects = -1; }
        r.errs = window.__err.slice(0, 4);
      } catch (e) {
        r.fatal = String(e).slice(0, 160);
      }
      var box = document.createElement('div');
      box.id = '__single_probe';
      box.style.display = 'none';
      box.textContent = JSON.stringify(r);
      document.body.appendChild(box);
    }, 500);
  });
})();
</script>`

function verify(browser: string): void {
  rmSync(STAGE, { recursive: true, force: true })
  mkdirSync(STAGE, { recursive: true })

  /* 必须插到**最后一个** `</body>`：内联进来的 JS 负载里还躺着 2 个字面量 `</body>`
     （产物模板字符串里的），按第一个匹配插就把探针塞进了脚本内部，
     结果是模块语法错误 + 探针自己那个 `</script>` 提前闭合元素——现场看起来跟
     "分词器把脚本截断了" 一模一样，白白误导了一轮排查。 */
  const out = readFileSync(OUT, 'utf8')
  const tail = out.lastIndexOf('</body>')
  if (tail < 0) throw new Error('单文件里找不到文档自身的 </body>')
  const probed = out.slice(0, tail) + PROBE + '\n' + out.slice(tail)
  const file = join(STAGE, 'forge-standalone.html')
  writeFileSync(file, probed, 'utf8')

  rmSync(PROFILE, { recursive: true, force: true })
  const url = `file:///${file.split(sep).join('/')}`
  /* 故意**不加** `--allow-file-access-from-files`：用户双击打开的时候没有任何命令行开关，
     这一条必须在对等的条件下成立才有意义（单文件版零子资源，本来也不需要那个开关）。
     部署形态验证里加它是因为那边要加载 ./assets 下的外部文件。 */
  const dump = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      `--user-data-dir=${PROFILE}`,
      '--virtual-time-budget=30000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 90_000 },
  )

  const raw = dump.match(/<div id="__single_probe"[^>]*>([\s\S]*?)<\/div>/)?.[1]
  if (!raw) {
    ok('单文件版回传了探针结果', false, `DOM 长度 ${dump.length}`)
    return
  }
  const r = JSON.parse(
    raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  ) as Record<string, unknown>

  ok('探针没报致命错误', !r.fatal, String(r.fatal ?? ''))
  ok('确实是从 file:// 打开的', r.protocol === 'file:', String(r.protocol))
  ok('JS 内联脚本执行了（React 挂载出界面）', r.mounted === true && Number(r.rootLen) > 800, `#root ${r.rootLen}B`)
  ok('CSS 内联样式生效了', r.markW === '32px' && /linear-gradient/.test(String(r.markBg)), `${r.markW}｜${String(r.markBg).slice(0, 40)}`)
  ok('file:// 下 localStorage 可用', r.ls === true, `${r.lsErr ?? ''}`)
  ok('CompressionStream 可用（分享码的前提）', r.hasCompression === true)
  ok('示例 chip 点了会填进需求框', typeof r.draft === 'string' && r.draft.length > 0, String(r.draft ?? ''))
  ok('「生成」按钮可点', r.submitEnabled === true, `按钮文案 ${r.submitLabel}`)
  ok('产物真的挂进了预览 iframe', Number(r.srcdocLen) > 2000 && r.srcdocHasHtml === true, `srcdoc ${r.srcdocLen}B`)
  ok('沙箱属性没丢 allow-scripts', String(r.sandbox).includes('allow-scripts'), String(r.sandbox))
  ok('沙箱里没有 allow-same-origin', !String(r.sandbox).includes('allow-same-origin'))
  ok('生成后真的落盘了（持久化前提）', Number(r.storedProjects) > 100, `forge:projects ${r.storedProjects}B`)
  ok('跑完主流程没有运行时报错', Array.isArray(r.errs) && r.errs.length === 0, JSON.stringify(r.errs ?? []))

  console.log(`  打开地址：${url.replace(/^file:\/\//, '')}`)
  console.log(`  示例 chip：${r.chip}｜需求框：${r.draft}`)
  console.log(`  产物：${r.srcdocLen}B → iframe｜落盘：forge:projects ${r.storedProjects}B｜路由：${r.hash}`)
}

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('⚠️  dist/ 不存在，先跑 npm run build')
    process.exitCode = 1
    return
  }

  const { bytes, jsBytes, cssBytes, closers, comments } = buildSingleFile()
  console.log(`已生成 ${OUT.replace(/\\/g, '/')}`)
  console.log(`  单文件 ${(bytes / 1024).toFixed(1)}KB（内联 JS ${(jsBytes / 1024).toFixed(1)}KB + CSS ${(cssBytes / 1024).toFixed(1)}KB，零外部请求）`)
  console.log(`  分词器转义：<\/script × ${closers}、<\\x21-- × ${comments}（都是语义等价写法，见脚本注释）`)
  ok('单文件确实只有一个文件', existsSync(OUT) && statSync(OUT).size > 200_000)

  const browser = findBrowser()
  if (!browser) {
    console.log('⚠️  本机找不到 Edge/Chrome，跳过 file:// 实测（单文件本身已经生成好了）')
    return
  }
  console.log(`浏览器：${browser}`)
  verify(browser)

  console.log('')
  const total = passed + failures.length
  if (failures.length === 0) {
    console.log(`✅ 单文件版验证通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

main()
