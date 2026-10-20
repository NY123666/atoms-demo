/**
 * 部署形态验证：把 `npm run build` 的产物放到**子目录**里，用无头 Chromium 真的打开它。
 *
 * 为什么单独测这一条：开发时一切正常、部署到子路径白屏，是这个项目最可能的翻车方式
 * （资源引用一旦是绝对路径就必然如此，而 GitHub Pages 这类托管天生带子路径）。
 * 离线冒烟测试跑的是源码，测不到打包产物，所以这里必须用真浏览器。
 *
 * 验证三件事：
 *   1) index.html 引用的资源是相对路径，且文件真的在；
 *   2) 子目录下 JS 包真的执行了（React 挂载出界面，不是空白页）；
 *   3) CSS 包真的生效了（关键元素拿到了非默认的 computed style）。
 *
 * 说明：这里走 `file://` 而不是本地 HTTP 服务，因为当前开发沙箱不允许浏览器进程发起
 * 网络连接（起 HTTP 服务后浏览器一次请求都到不了，只会挂到超时）。被测的风险点——
 * 相对路径解析——在 file:// 下同样成立：绝对路径的 /assets/... 会解析到盘符根目录而失败。
 *
 * 运行：npm run smoke:dist
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const DIST = resolve('dist')
const STAGE = resolve('.tmp/deploy-check')
/** 故意多包一层目录：模拟「站点挂在子路径下」 */
const SUB = join(STAGE, 'atoms-demo')
const PROFILE = resolve('.tmp/edge-profile-dist')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/** 塞进产物副本里的探针：把"包到底加载没加载"变成可断言的数字。 */
const PROBE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var r = {};
    try {
      var root = document.getElementById('root');
      r.rootLen = root ? root.innerHTML.length : 0;
      r.brand = document.querySelector('.brand strong') ? document.querySelector('.brand strong').textContent : '';
      /* 用 .brand-mark 的尺寸和纯色底当"CSS 生效"的证据：
         它身上只有样式表里那几条规则能给（32px 圆角方块 + accent 实底）。 */
      var mark = document.querySelector('.brand-mark');
      if (mark) {
        var ms = getComputedStyle(mark);
        r.markW = ms.width;
        r.markRadius = ms.borderRadius;
        r.markFill = ms.backgroundColor;
      }
      r.bodyBg = getComputedStyle(document.body).backgroundImage + '|' + getComputedStyle(document.body).backgroundColor;
      r.sheets = document.styleSheets.length;
      var rules = 0;
      for (var i = 0; i < document.styleSheets.length; i++) { try { rules += document.styleSheets[i].cssRules.length; } catch (e) { } }
      r.rules = rules;
      r.mounted = !!document.querySelector('.shell');
    } catch (e) { r.err = String(e); }
    var box = document.createElement('div');
    box.id = '__deploy_probe';
    box.style.display = 'none';
    box.textContent = JSON.stringify(r);
    document.body.appendChild(box);
  }, 500);
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
    console.log('⚠️  本机找不到 Edge/Chrome，跳过部署形态验证（前面的离线冒烟测试不受影响）')
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
  /* 这一条是"部署到子路径必白屏"的病根，所以先查源码再查运行时 */
  const absolute = [...indexHtml.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1])
  ok('资源引用用的是相对路径', absolute.length === 0, absolute.join(', '))
  const refs = [...indexHtml.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]!)
  ok('index.html 引用了打包产物', refs.length > 0)
  ok('引用的产物文件都在', refs.every((r) => existsSync(join(SUB, r))), refs.join(', '))
  /* 产物必须能离线跑：外链的脚本/样式/字体在弱网或断网环境会直接把页面拖死。
     只认"浏览器会去下载"的形式；包里的 https://api.openai.com 之类是模型接口地址，
     只有用户填了自己的 key 才会被请求，不算依赖。 */
  const bundled = refs
    .filter((r) => /\.(js|css)$/.test(r))
    .map((r) => readFileSync(join(SUB, r), 'utf8'))
    .join('\n')
  const loadable = [
    ...bundled.matchAll(/<(?:script|link)[^>]+(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi),
    ...bundled.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/[^"')\s]+)/gi),
    ...bundled.matchAll(/@font-face[\s\S]{0,400}?url\(\s*["']?(https?:\/\/[^"')\s]+)/gi),
  ].map((m) => m[1]!)
  ok('打包产物没有外链依赖', loadable.length === 0, [...new Set(loadable)].slice(0, 5).join(', '))
  const remoteImports = [...bundled.matchAll(/import\(\s*["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]!)
  ok('没有运行时远程加载的模块', remoteImports.length === 0, remoteImports.join(', '))

  /* 探针只加在副本上，dist 本身保持原样 */
  const probed = indexHtml.replace(/<\/body\s*>/i, PROBE + '\n</body>')
  ok('探针挂上了', probed !== indexHtml)
  writeFileSync(join(SUB, 'index.html'), probed)

  rmSync(PROFILE, { recursive: true, force: true })
  const url = `file:///${join(SUB, 'index.html').split(sep).join('/')}`
  const dump = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      /* file:// 下模块脚本要走文件读取，否则连 index.js 都加载不了 */
      '--allow-file-access-from-files',
      `--user-data-dir=${PROFILE}`,
      '--virtual-time-budget=5000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 45_000 },
  )

  const raw = dump.match(/<div id="__deploy_probe"[^>]*>([\s\S]*?)<\/div>/)?.[1]
  if (!raw) {
    ok('页面回传了探针结果', false, `DOM 长度 ${dump.length}`)
  } else {
    const r = JSON.parse(
      raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    ) as {
      rootLen: number
      brand: string
      markW: string
      markRadius: string
      markFill: string
      bodyBg: string
      sheets: number
      rules: number
      mounted: boolean
      err?: string
    }
    ok('探针没报错', !r.err, r.err)
    ok('JS 包真的执行了（React 挂载出界面）', r.mounted && r.rootLen > 800, `#root 长度 ${r.rootLen}｜mounted=${r.mounted}`)
    ok('界面文案渲染出来了', r.brand.includes('Forge'), r.brand)
    ok(
      'CSS 包真的生效了',
      r.rules > 150 && r.markW === '32px' && /^rgb\(\d/.test(r.markFill),
      `${r.sheets} 张表 / ${r.rules} 条规则｜brand-mark ${r.markW} 圆角 ${r.markRadius} 填充 ${r.markFill}`,
    )
    console.log(`  子路径挂载：${url.replace(/^file:\/\//, '')}`)
    console.log(`  #root ${r.rootLen}B｜样式规则 ${r.rules} 条｜body 背景 ${r.bodyBg.slice(0, 60)}`)
  }

  console.log('')
  const total = passed + failures.length
  if (failures.length === 0) {
    console.log(`✅ 部署形态验证通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

main()
