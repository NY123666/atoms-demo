/**
 * 真浏览器验证：本机账号的注册入口、登录、退出，以及"退出再登录还能找回自己的东西"。
 *
 * 冒烟测试能证明建号/验密/分区的逻辑是对的，但证明不了**界面上真的接上了**：
 * 侧栏那个入口点得开、密码输错了会说错在哪、登录成功之后项目列表真的换了人。
 * 这里把打包产物复制到子目录，先用 Node 算好一份 PBKDF2 账号和两个分区
 * （访客 1 个应用、账号 1 个应用），再像用户一样在页面上点。
 *
 * 两个和别的关卡不一样的地方，都是前面踩过坑换来的：
 *
 * 1. **不能用 --virtual-time-budget**。登录要真的跑一次 PBKDF2（12 万次迭代，约 40ms 真实时间），
 *    而虚拟时间不会等真实异步操作 —— 预算一到，页面就被 dump，探针永远停在"还没登录"。
 *    所以这里反过来：起一个本地 HTTP 服务，页面把结论 POST 回来，收到就杀掉浏览器。
 * 2. 点击之后要给 React 一轮时间再读 DOM（下面的 step() 就是干这个的）。
 *
 * 运行：npm run smoke:account
 */

import { spawn } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const DIST = resolve('dist')
const STAGE = resolve('.tmp/account-check')
const SUB = join(STAGE, 'atoms-demo')
const PROFILE = resolve('.tmp/edge-profile-account')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/** 种子账号的密码。页面上的登录要用同一串，所以两边共用一个常量。 */
const PASSWORD = 'check-pass-1'
const USERNAME = 'xiaoming'
const DISPLAY_NAME = '小明'
const ACCOUNT_ID = 'a-check'

/**
 * 用 Node 算一份和浏览器里一模一样的账号记录（同样的盐、同样的迭代次数、同样的 base64）。
 * 这样种下去之后就能用界面真的登录一次 —— 而不是往 localStorage 里塞一个"假登录态"。
 */
function makeAccount(): Record<string, unknown> {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(PASSWORD, salt, 120_000, 32, 'sha256')
  return {
    id: ACCOUNT_ID,
    username: USERNAME,
    displayName: DISPLAY_NAME,
    createdAt: Date.now() - 86_400_000,
    salt: salt.toString('base64'),
    iterations: 120_000,
    hash: hash.toString('base64'),
  }
}

function seedPage(account: Record<string, unknown>): string {
  return `<script>
(function () {
  var t0 = Date.now();
  /* 账号名下的应用：一段聊天 + 两版代码 + 一条执行记录，用来验证登录后这些东西都回得来。 */
  var run = {
    source: 'llm', status: 'done', prompt: '加一个搜索框', autoFixed: false,
    startedAt: t0 - 30000, finishedAt: t0 - 25000, durationMs: 5000,
    steps: [
      { title: '解析需求', detail: '识别为「清单 / 任务管理」类需求', weight: 0.6, status: 'done', startedAt: t0 - 30000, finishedAt: t0 - 29500 },
      { title: '调用模型生成', detail: '耗时 1.2s', weight: 3, status: 'done', startedAt: t0 - 29500, finishedAt: t0 - 27000 },
      { title: '装载预览', detail: '已装载到沙箱预览', weight: 0.5, status: 'done', startedAt: t0 - 27000, finishedAt: t0 - 25000 }
    ]
  };
  var accountProject = {
    id: 'p-account-check', name: '账号里的应用',
    createdAt: t0 - 60000, updatedAt: t0 - 25000, starred: false, currentVersionId: 'v-acct-2',
    messages: [
      { id: 'm-a-u1', role: 'user', content: '做一个待办清单', createdAt: t0 - 60000 },
      { id: 'm-a-a1', role: 'assistant', content: '已生成 v1「待办清单」。', createdAt: t0 - 55000, versionId: 'v-acct-1' },
      { id: 'm-a-u2', role: 'user', content: '加一个搜索框', createdAt: t0 - 30000 },
      { id: 'm-a-a2', role: 'assistant', content: '已生成 v2「待办清单」。', createdAt: t0 - 25000, versionId: 'v-acct-2', run: run }
    ],
    versions: [
      { id: 'v-acct-1', index: 1, label: '待办清单', html: '<!doctype html><html><body><h1>account-v1</h1></body></html>', prompt: '做一个待办清单', createdAt: t0 - 55000, durationMs: 5000, source: 'demo' },
      { id: 'v-acct-2', index: 2, label: '待办清单', html: '<!doctype html><html><body><h1>account-v2</h1></body></html>', prompt: '加一个搜索框', createdAt: t0 - 25000, durationMs: 5000, source: 'llm', run: run }
    ]
  };
  var guestProject = {
    id: 'p-guest-check', name: '访客的应用',
    createdAt: t0 - 10000, updatedAt: t0 - 10000, starred: false, currentVersionId: 'v-g1',
    messages: [{ id: 'm-g-u1', role: 'user', content: '访客随手做的', createdAt: t0 - 10000 }],
    versions: [{ id: 'v-g1', index: 1, label: '访客版', html: '<!doctype html><html><body><h1>guest</h1></body></html>', prompt: '访客随手做的', createdAt: t0 - 10000, durationMs: 1000, source: 'demo' }]
  };

  try {
    localStorage.setItem('forge:accounts', JSON.stringify({ v: 1, data: [${JSON.stringify(account)}] }));
    localStorage.setItem('forge:projects:${ACCOUNT_ID}', JSON.stringify({ v: 1, data: [accountProject] }));
    localStorage.setItem('forge:projects', JSON.stringify({ v: 1, data: [guestProject] }));
    localStorage.setItem('forge:settings', JSON.stringify({ v: 1, data: { activeProviderId: 'demo', theme: 'dark' } }));
  } catch (e) { window.__account_seed_err = String(e); }
})();
</script>`
}

/**
 * 页面侧的探针：像用户一样点，每一步都等 DOM 真的变了再往下走。
 * 结论 POST 回本地那台 HTTP 服务（见文件头的说明）。
 */
const PROBE = `<script>
window.addEventListener('load', function () {
  var PORT = __PORT__;
  var PASSWORD = ${JSON.stringify(PASSWORD)};
  var r = { seedErr: window.__account_seed_err || '' };
  var finished = false;

  /* \\s 要写成两个反斜杠：这段是模板字符串，单个 \\s 会退化成字母 s，把正文里的 s 全吃掉。 */
  function text(el) { return (el ? el.textContent || '' : '').replace(/\\s+/g, ' ').trim(); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function names() { return qa('.side-item-name').map(text); }
  function keys() { return Object.keys(localStorage).sort(); }
  function setInput(el, v) {
    /* React 认的是原生 setter 派发出来的 input 事件，直接改 el.value 它收不到。 */
    var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function byText(sel, label) {
    return qa(sel).filter(function (x) { return text(x).indexOf(label) >= 0; })[0] || null;
  }
  function submit() {
    var form = q('.auth-form');
    if (form && form.requestSubmit) form.requestSubmit();
    else { var b = byText('.auth-form button', '登录') || byText('.auth-form button', '注册'); if (b) b.click(); }
  }

  function finish() {
    if (finished) return;
    finished = true;
    r.finished = true;
    var box = document.createElement('div');
    box.id = '__account_probe';
    box.style.display = 'none';
    box.textContent = JSON.stringify(r);
    document.body.appendChild(box);
    try {
      fetch('http://127.0.0.1:' + PORT + '/probe', { method: 'POST', mode: 'no-cors', body: JSON.stringify(r) });
    } catch (e) { r.postErr = String(e); }
    /* 兜底：POST 万一没走通，Node 那边还会看这个节点 */
    try { document.title = '__account_probe_done'; } catch (e) {}
  }

  /* 每一步都：轮询到条件成立 → 交给 next 读数据/点下一步。超时就直接收尾，别挂死。 */
  function step(label, cond, next) {
    var n = 0;
    function tick() {
      var v = null;
      try { v = cond(); } catch (e) { r.fatal = label + ' — ' + e; return finish(); }
      if (v) {
        try { next(v); } catch (e) { r.fatal = label + ' — ' + e; finish(); }
        return;
      }
      if (++n > 480) { r.timeout = label; return finish(); }
      setTimeout(tick, 25);
    }
    tick();
  }

  window.addEventListener('error', function (e) { r.pageError = String(e.message); });

  /* 1) 开机是访客态：侧栏那个入口写着"访客模式"，列表里是访客的应用 */
  step('首页挂载', function () { return q('.side-account') && q('.side-list') ? true : null; }, function () {
    r.bootLabel = text(q('.side-account strong'));
    r.bootSub = text(q('.side-account em'));
    r.bootItems = names();
    r.sidebarVisible = getComputedStyle(q('.sidebar')).display !== 'none';
    r.topbarHidden = getComputedStyle(q('.topbar')).display === 'none';
    r.keysBefore = keys();

    /* 2) 点开账号入口 */
    q('.side-account').click();
    step('账号对话框打开', function () { return q('.auth-form input[aria-label="用户名"]') ? true : null; }, function () {
      r.dialogTabs = qa('.auth-tabs button').map(text);
      r.hasLoginFields = !!q('.auth-form input[aria-label="密码"]');
      r.noCrypto = !!q('.auth-warn');
      if (r.noCrypto) return finish();

      /* 3) 注册页要真的在：切过去看有没有"再输一次密码"和用户名规则 */
      byText('.auth-tabs button', '注册').click();
      step('注册表单出现', function () { return q('.auth-form input[aria-label="确认密码"]') ? true : null; }, function () {
        r.registerHasConfirm = true;
        r.registerRule = text(q('.auth-form .field-note'));
        r.registerSubmit = text(byText('.auth-form button', '注册') || document.createElement('b'));
        byText('.auth-tabs button', '登录').click();
        step('切回登录表单', function () { return !q('.auth-form input[aria-label="确认密码"]') ? true : null; }, function () {
          /* 4) 密码输错：要说清错在哪，而且不能把人放进去 */
          setInput(q('.auth-form input[aria-label="用户名"]'), '  XiaoMing  ');
          setInput(q('.auth-form input[aria-label="密码"]'), 'not-the-password');
          submit();
          step('错误密码给出提示', function () { return text(q('.auth-error')) ? text(q('.auth-error')) : null; }, function (e) {
            r.wrongError = e;
            r.stillGuestAfterWrong = text(q('.side-account strong'));
            r.dialogStillOpen = !!q('.auth-form');

            /* 5) 对密码：用户名带空格大小写，也该能进去（normalize 真的生效了） */
            setInput(q('.auth-form input[aria-label="密码"]'), PASSWORD);
            submit();
            step('登录成功（对话框收起）', function () { return !q('.modal') ? true : null; }, function () {
              r.afterLoginLabel = text(q('.side-account strong'));
              r.afterLoginSub = text(q('.side-account em'));
              r.afterLoginItems = names();
              r.afterLoginCards = qa('.project-card').length;
              r.guestGoneAfterLogin = r.afterLoginItems.indexOf('访客的应用') < 0;
              r.keysAfterLogin = keys();

              /* 6) 打开账号名下的应用：聊天、两版代码、执行记录都该在 */
              qa('.side-item-main')[0].click();
              step('项目页面打开', function () { return q('.chat-scroll') ? true : null; }, function () {
                r.chatUser = text(q('.msg-user .msg-bubble'));
                r.chatReplies = qa('.msg-assistant .msg-bubble').length;
                r.versionItems = qa('.timeline-list .tl-item').length;
                r.runRecords = qa('.run-record').length;
                r.currentTag = text(q('.work-head .tag'));
                r.projectTitle = q('.title-input') ? q('.title-input').value : '';
                /* 看代码：切到"代码"标签，读产物本身 */
                var codeTab = byText('.work-head .seg button', '代码');
                if (codeTab) codeTab.click();
                step('代码面板出现', function () { return q('.code-block') ? true : null; }, function () {
                  r.codeHasV2 = text(q('.code-block')).indexOf('account-v2') >= 0;

                  /* 7) 退出登录：回到访客态，账号的应用不该再出现在列表里 */
                  q('.side-account').click();
                  step('已登录卡片出现', function () { return q('.auth-me') ? true : null; }, function () {
                    r.meCardLabel = text(q('.auth-me .auth-me-info strong'));
                    var out = byText('.modal button', '退出登录');
                    r.hasLogoutButton = !!out;
                    if (out) out.click();
                    step('退出后回到访客模式', function () {
                      return text(q('.side-account strong')) === '访客模式' && !q('.modal') ? true : null;
                    }, function () {
                      r.afterLogoutLabel = text(q('.side-account strong'));
                      r.afterLogoutItems = names();
                      r.afterLogoutKeys = keys();
                      r.accountProjectGone = r.afterLogoutItems.indexOf('账号里的应用') < 0;

                      /* 8) 再登录一次：项目、聊天、代码还得回来 —— 这就是需求里那句"仍能找到" */
                      q('.side-account').click();
                      step('对话框再次打开', function () { return q('.auth-form input[aria-label="用户名"]') ? true : null; }, function () {
                        setInput(q('.auth-form input[aria-label="用户名"]'), 'xiaoming');
                        setInput(q('.auth-form input[aria-label="密码"]'), PASSWORD);
                        submit();
                        step('再次登录成功', function () { return !q('.modal') ? true : null; }, function () {
                          r.reLoginLabel = text(q('.side-account strong'));
                          r.reLoginItems = names();
                          qa('.side-item-main')[0].click();
                          step('重新打开项目', function () { return q('.chat-scroll') ? true : null; }, function () {
                            r.reChatUser = text(q('.msg-user .msg-bubble'));
                            r.reVersionItems = qa('.timeline-list .tl-item').length;
                            r.reRunRecords = qa('.run-record').length;
                            r.reCurrentTag = text(q('.work-head .tag'));
                            var codeTab2 = byText('.work-head .seg button', '代码');
                            if (codeTab2) codeTab2.click();
                            step('代码面板再次出现', function () { return q('.code-block') ? true : null; }, function () {
                              r.reCodeHasV2 = text(q('.code-block')).indexOf('account-v2') >= 0;
                              r.reKeys = keys();
                              finish();
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
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

/**
 * 打开页面，等它把结论 POST 回来。这里是**故意**不用 --dump-dom 的：
 * 登录要跑一次真实的 PBKDF2，而 --virtual-time-budget 不会等真实异步，dump 出来永远停在登录前。
 * 所以改成事件驱动 —— 收到 POST 就杀掉浏览器，收不到就等它自然退出或超时。
 */
function runBrowser(browser: string, url: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--disable-extensions',
        '--disable-background-networking',
        '--allow-file-access-from-files',
        '--window-size=1366,900',
        '--hide-scrollbars',
        `--user-data-dir=${PROFILE}`,
        url,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )

    let settled = false
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolvePromise(value)
    }

    ;(globalThis as { __accountProbe?: (body: string) => void }).__accountProbe = (body) => done(body)

    const timer = setTimeout(() => done(null), 60_000)
    child.on('exit', () => done(null))
  })
}

async function main(): Promise<void> {
  const browser = findBrowser()
  if (!browser) {
    console.log('⚠️  本机找不到 Edge/Chrome，跳过账号流程验证（不影响其它关卡）')
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

  /* 先自查产物是不是新的：dist 陈旧时页面里根本没有账号入口，
     最后报出来的却是"页面没回传结果"，很容易把人带到错的思路上（这个坑真踩过）。 */
  const jsAsset = indexHtml.match(/src="\.?\/?([^"]+\.js)"/)?.[1]
  const bundle = jsAsset ? readFileSync(join(SUB, jsAsset), 'utf8') : ''
  ok(
    'dist 是新的（含账号组件）',
    bundle.includes('side-account') && bundle.includes('auth-note'),
    jsAsset ? `${jsAsset} 里没有账号相关的类名，先跑一次 npm run build` : 'index.html 里找不到 js 资源',
  )

  /* 本地收结论的服务：页面是 file:// 打开的，没法给我们"返回值"，只能让它 POST 回来。 */
  let received: string | null = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8')
    })
    req.on('end', () => {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
      res.end()
      received = body
      ;(globalThis as { __accountProbe?: (b: string) => void }).__accountProbe?.(body)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port

  const account = makeAccount()
  const seed = seedPage(account)
  const probe = PROBE.replace('__PORT__', String(port))

  /* 种子必须在模块脚本执行前跑，所以插在 <head> 开头 */
  const seeded = indexHtml.replace(/<head>/i, '<head>' + seed)
  /* 探针挂在文档**真正**的 </body> 前：种子里的 html 字符串也含 </body>，
     所以要取最后一个（否则会把种子脚本切成两半）。 */
  const lastBody = seeded.lastIndexOf('</body>')
  const probed = lastBody === -1 ? seeded + '\n' + probe : seeded.slice(0, lastBody) + probe + '\n' + seeded.slice(lastBody)
  ok('种子探针挂上了', seeded !== indexHtml)
  ok('验证探针挂上了', probed !== seeded)
  writeFileSync(join(SUB, 'index.html'), probed)

  rmSync(PROFILE, { recursive: true, force: true })
  const url = `file:///${join(SUB, 'index.html').split(sep).join('/')}#/`
  const payload = await runBrowser(browser, url)
  server.close()

  const raw = payload ?? received
  if (process.env.ACCOUNT_DEBUG) console.log('RAW PROBE:', raw ?? '(none)')
  if (!raw) {
    ok('页面回传了探针结果', false, '浏览器没把结论 POST 回来（看 ACCOUNT_DEBUG=1 的输出）')
  } else {
    const r = JSON.parse(raw) as Record<string, unknown>
    const str = (k: string) => String(r[k] ?? '')
    const list = (k: string) => (Array.isArray(r[k]) ? (r[k] as string[]) : [])

    ok('种子写入没报错', r.seedErr === '', str('seedErr'))
    ok('探针没报错', !r.fatal && !r.pageError, `${str('fatal')} ${str('pageError')}`.trim())

    /* 流程半路卡住时后面的断言拿到的都是一片空白，会刷出二三十条"失败"，
       真正有用的信息（卡在哪一步）反而被淹了。所以这里就停在这里。 */
    if (r.timeout || r.fatal || r.pageError) {
      ok('流程跑完了', false, `卡在「${str('timeout') || str('fatal') || str('pageError')}」`)
    } else if (r.noCrypto) {
      /* file:// 在个别浏览器里不算安全上下文，那就没法验登录（也不该假装验过）。 */
      console.log('⚠️  这个浏览器在 file:// 下没有 crypto.subtle，账号功能按设计被禁用，跳过界面验证')
      console.log('   （想验的话用 npm run preview 起 http://localhost 再打开）')
    } else {
      ok('开机是访客态', r.bootLabel === '访客模式' && /点此登录/.test(String(r.bootSub)), `${str('bootLabel')} / ${str('bootSub')}`)
      ok('访客看到自己的应用', list('bootItems').join(',') === '访客的应用', list('bootItems').join(','))
      ok('访客态用的是老 key（升级不丢数据）', list('keysBefore').includes('forge:projects'), list('keysBefore').join(','))
      ok('宽屏下侧栏在、顶栏不重复显示', r.sidebarVisible === true && r.topbarHidden === true, `sidebar=${str('sidebarVisible')} topbarHidden=${str('topbarHidden')}`)
      ok('点侧栏入口能打开账号对话框', list('dialogTabs').join(',') === '登录,注册', list('dialogTabs').join(','))
      ok('同一个对话框里有用户名和密码框', r.hasLoginFields === true)
      ok('注册页在（有"再输一次密码"）', r.registerHasConfirm === true && str('registerSubmit').includes('注册'))
      ok('注册页写清了用户名规则', str('registerRule').includes('2–24'), str('registerRule'))
      ok('密码输错会说明原因', str('wrongError') === '用户名或密码不对', str('wrongError'))
      ok('密码错的时候不放人进去', r.stillGuestAfterWrong === '访客模式' && r.dialogStillOpen === true, `${str('stillGuestAfterWrong')} / open=${String(r.dialogStillOpen)}`)
      ok('登录成功切到账号（用户名带空格大小写也认）', r.afterLoginLabel === DISPLAY_NAME, str('afterLoginLabel'))
      ok('登录后侧栏文案变成"本机账号"', str('afterLoginSub').includes('本机账号'), str('afterLoginSub'))
      ok('登录后列表换成账号名下的应用', list('afterLoginItems').join(',') === '账号里的应用', list('afterLoginItems').join(','))
      ok('访客的应用不再出现在账号视角里', r.guestGoneAfterLogin === true)
      ok('首页卡片也跟着换了', r.afterLoginCards === 1, `卡片数 ${str('afterLoginCards')}`)
      ok('两个分区各用各的 key', list('keysAfterLogin').includes(`forge:projects:${ACCOUNT_ID}`) && list('keysAfterLogin').includes('forge:projects'), list('keysAfterLogin').join(','))
      ok('登录后能打开自己的项目', r.projectTitle === '账号里的应用', str('projectTitle'))
      ok('聊天记录在', str('chatUser') === '做一个待办清单' && r.chatReplies === 2, `${str('chatUser')} / 回 ${str('chatReplies')}`)
      ok('两版代码存档在', r.versionItems === 2 && r.currentTag === 'v2', `版本 ${str('versionItems')} tag=${str('currentTag')}`)
      ok('执行记录跟着一起存档', r.runRecords === 1, `记录 ${str('runRecords')}`)
      ok('代码面板里是这一版的产物', r.codeHasV2 === true)
      ok('已登录卡片显示当前账号', r.meCardLabel === DISPLAY_NAME && r.hasLogoutButton === true, `${str('meCardLabel')} logout=${String(r.hasLogoutButton)}`)
      ok('退出后回到访客模式', r.afterLogoutLabel === '访客模式', str('afterLogoutLabel'))
      ok('退出后列表换回访客自己的应用', list('afterLogoutItems').join(',') === '访客的应用', list('afterLogoutItems').join(','))
      ok('账号的应用在访客视角下消失', r.accountProjectGone === true)
      ok('退出不动盘上的数据（只是换了个视角）', list('afterLogoutKeys').includes(`forge:projects:${ACCOUNT_ID}`), list('afterLogoutKeys').join(','))
      ok('再登录还是这个账号', r.reLoginLabel === DISPLAY_NAME, str('reLoginLabel'))
      ok('再登录能找回自己的项目', list('reLoginItems').join(',') === '账号里的应用', list('reLoginItems').join(','))
      ok('再登录聊天还在', str('reChatUser') === '做一个待办清单', str('reChatUser'))
      ok('再登录两版代码都在、仍停在 v2', r.reVersionItems === 2 && r.reCurrentTag === 'v2', `版本 ${str('reVersionItems')} tag=${str('reCurrentTag')}`)
      ok('再登录执行记录还在', r.reRunRecords === 1, `记录 ${str('reRunRecords')}`)
      ok('再登录代码就是 v2 那份', r.reCodeHasV2 === true)
      ok('登录态刷新后仍认这个账号（会话写了盘）', list('reKeys').includes('forge:session'), list('reKeys').join(','))

      console.log(
        `  界面流程：访客 → 错密码被拦 → 登录 ${DISPLAY_NAME} → 应用/聊天/${str('versionItems')} 版代码/执行记录都在 → 退出回访客 → 再登录仍在`,
      )
    }
  }

  console.log('')
  const total = passed + failures.length
  if (failures.length === 0) {
    console.log(`✅ 账号流程验证通过：${passed}/${total}`)
    return
  }
  console.log(`❌ ${failures.length}/${total} 项失败：`)
  for (const f of failures) console.log(`   · ${f}`)
  process.exitCode = 1
}

void main()
