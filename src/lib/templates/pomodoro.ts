import { esc, page, type BuildCtx } from './shared'

const BODY = `
<div class="wrap" style="max-width:560px">
  <div class="card" style="text-align:center">
    <h1 class="h1" style="text-align:left">${'{TITLE}'}</h1>
    <p class="sub" style="text-align:left">专注 25 分钟后休息 5 分钟，用番茄数推进你的任务。</p>

    <div class="row" style="justify-content:center;gap:8px;margin-bottom:18px">
      <button class="ghost on" data-mode="focus">专注 25</button>
      <button class="ghost" data-mode="short">短休 5</button>
      <button class="ghost" data-mode="long">长休 15</button>
    </div>

    <div style="position:relative;width:220px;height:220px;margin:0 auto">
      <svg viewBox="0 0 200 200" width="220" height="220" style="transform:rotate(-90deg)">
        <circle cx="100" cy="100" r="86" fill="none" stroke="var(--panel2)" stroke-width="12"></circle>
        <circle id="ring" cx="100" cy="100" r="86" fill="none" stroke="var(--accent)" stroke-width="12"
                stroke-linecap="round" stroke-dasharray="540.35" stroke-dashoffset="0" style="transition:stroke-dashoffset .3s linear"></circle>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div id="clock" style="font-size:44px;font-weight:700;font-variant-numeric:tabular-nums">25:00</div>
        <div class="muted" id="phase">专注中</div>
      </div>
    </div>

    <div class="row" style="justify-content:center;gap:10px;margin:20px 0 6px">
      <button id="go" style="min-width:120px">开始</button>
      <button class="ghost" id="reset">重置</button>
    </div>
    <p class="muted" style="margin:8px 0 0">今天已完成 <b id="done" style="color:var(--accent)">0</b> 个番茄</p>
  </div>

  <div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;margin:0 0 12px">今日任务</h3>
    <form id="form" class="row" autocomplete="off">
      <input id="input" placeholder="添加一个任务…" maxlength="80" />
      <button type="submit">添加</button>
    </form>
    <ul id="list" style="list-style:none;margin:14px 0 0;padding:0"></ul>
    <p class="muted" id="empty" style="text-align:center;padding:20px 0;display:none">今天还没有任务。</p>
    <p class="muted" id="hint" style="display:none;font-size:12px">以上是示例任务，直接改或删都行。</p>
  </div>
</div>`

const SCRIPT = `
var DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
var LABEL = { focus: '专注中', short: '短休息', long: '长休息' };
var TODAY = new Date().toDateString();

var KEY_TASKS = 'forge-pomodoro-tasks-v1';
var KEY_STAT = 'forge-pomodoro-stat-v1';

var tasks = [];
var firstRun = true;
try { var raw = Store.get(KEY_TASKS); if (raw) { tasks = JSON.parse(raw); firstRun = false; } } catch (e) { }

/* 第一版带几条示例任务，番茄钟一打开就有东西可点；用户自己加一条后就不再出现 */
if (firstRun) {
  tasks = [
    { id: 'seed-1', text: '读一遍需求文档', done: true, poms: 1 },
    { id: 'seed-2', text: '把数据模型画出来', done: false, poms: 0 },
    { id: 'seed-3', text: '补两支单测', done: false, poms: 0 }
  ];
}
var stat = { day: TODAY, done: 0 };
try { var raw2 = Store.get(KEY_STAT); if (raw2) stat = JSON.parse(raw2); } catch (e) { }
if (stat.day !== TODAY) stat = { day: TODAY, done: 0 };

var mode = 'focus', remaining = DUR.focus, running = false, timer = null;
var CIRC = 2 * Math.PI * 86;
var ring = document.getElementById('ring');
var clock = document.getElementById('clock');
var phase = document.getElementById('phase');

/* 用户一动手就不再是"示例"了 */
function save() {
  document.getElementById('hint').style.display = 'none';
  Store.set(KEY_TASKS, JSON.stringify(tasks));
  Store.set(KEY_STAT, JSON.stringify(stat));
}

function paint() {
  var m = Math.floor(remaining / 60), s = remaining % 60;
  clock.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  phase.textContent = LABEL[mode];
  var pct = 1 - remaining / DUR[mode];
  ring.setAttribute('stroke-dashoffset', String(CIRC * pct));
  document.title = (running ? clock.textContent + ' · ' : '') + '番茄钟';
  document.getElementById('done').textContent = String(stat.done);
}

function beep() {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ac = new AC();
    [0, 0.18, 0.36].forEach(function (t) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.type = 'sine';
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.16);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.18);
    });
  } catch (e) { }
}

function finish() {
  stop();
  if (mode === 'focus') { stat.done += 1; save(); }
  beep();
  remaining = DUR[mode];
  paint();
  document.getElementById('go').textContent = '开始';
}

function stop() {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
}

function start() {
  if (running) { stop(); document.getElementById('go').textContent = '继续'; paint(); return; }
  running = true;
  document.getElementById('go').textContent = '暂停';
  timer = setInterval(function () {
    remaining -= 1;
    if (remaining <= 0) { finish(); return; }
    paint();
  }, 1000);
  paint();
}

document.getElementById('go').onclick = start;
document.getElementById('reset').onclick = function () {
  stop(); remaining = DUR[mode]; document.getElementById('go').textContent = '开始'; paint();
};

var modeBtns = document.querySelectorAll('[data-mode]');
for (var i = 0; i < modeBtns.length; i++) {
  (function (btn) {
    btn.onclick = function () {
      stop();
      mode = btn.getAttribute('data-mode');
      remaining = DUR[mode];
      for (var j = 0; j < modeBtns.length; j++) modeBtns[j].className = 'ghost';
      btn.className = 'ghost on';
      document.getElementById('go').textContent = '开始';
      paint();
    };
  })(modeBtns[i]);
}

function renderTasks() {
  var list = document.getElementById('list');
  list.innerHTML = '';
  tasks.forEach(function (t) {
    var li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:var(--panel2)';

    var box = document.createElement('input');
    box.type = 'checkbox'; box.checked = t.done;
    box.style.cssText = 'width:18px;height:18px;accent-color:var(--accent);flex:none;cursor:pointer';
    box.onchange = function () { t.done = box.checked; save(); renderTasks(); };

    var span = document.createElement('span');
    span.textContent = t.text;
    span.style.cssText = 'flex:1;font-size:14px;' + (t.done ? 'text-decoration:line-through;color:var(--muted)' : '');

    var pom = document.createElement('span');
    pom.textContent = '🍅 ' + t.poms;
    pom.className = 'muted';
    pom.style.flex = 'none';

    var plus = document.createElement('button');
    plus.className = 'ghost'; plus.textContent = '+1';
    plus.style.cssText = 'padding:4px 9px;flex:none';
    plus.onclick = function () { t.poms += 1; save(); renderTasks(); };

    var del = document.createElement('button');
    del.className = 'ghost'; del.textContent = '×';
    del.style.cssText = 'padding:4px 10px;flex:none';
    del.onclick = function () { tasks = tasks.filter(function (x) { return x.id !== t.id; }); save(); renderTasks(); };

    li.appendChild(box); li.appendChild(span); li.appendChild(pom); li.appendChild(plus); li.appendChild(del);
    list.appendChild(li);
  });
  document.getElementById('empty').style.display = tasks.length === 0 ? 'block' : 'none';
}

document.getElementById('form').onsubmit = function (e) {
  e.preventDefault();
  var input = document.getElementById('input');
  var text = input.value.trim();
  if (!text) return;
  tasks.unshift({ id: String(Date.now()), text: text, done: false, poms: 0 });
  input.value = '';
  save(); renderTasks();
};

document.getElementById('hint').style.display = firstRun ? 'block' : 'none';
paint();
renderTasks();
`

export function buildPomodoro(ctx: BuildCtx): string {
  return page(ctx, BODY.replace('{TITLE}', esc(ctx.title)), SCRIPT)
}
