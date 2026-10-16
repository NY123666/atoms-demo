import { esc, page, type BuildCtx } from './shared'

const BODY = `
<div class="wrap">
  <div class="card">
    <h1 class="h1">${'{TITLE}'}</h1>
    <p class="sub">数据保存在本地，刷新不丢。</p>

    <form id="form" class="row" autocomplete="off">
      <input id="input" placeholder="要做什么？回车添加…" maxlength="120" />
      <button type="submit">添加</button>
    </form>

    <div class="row" style="margin:16px 0 12px;gap:8px">
      <button class="ghost on" data-filter="all">全部 <span id="c-all">0</span></button>
      <button class="ghost" data-filter="active">未完成 <span id="c-active">0</span></button>
      <button class="ghost" data-filter="done">已完成 <span id="c-done">0</span></button>
      <div style="flex:1"></div>
      <button class="ghost" id="clear">清除已完成</button>
    </div>

    <ul id="list" style="list-style:none;margin:0;padding:0"></ul>
    <p class="muted" id="hint" style="display:none;font-size:12px;margin:4px 0 0">以上是示例数据，直接改或删都行。</p>
    <p class="muted" id="empty" style="text-align:center;padding:28px 0;display:none">还没有任务，先加一条吧。</p>
    <div class="row" style="margin-top:16px">
      <div style="flex:1;height:6px;background:var(--panel2);border-radius:99px;overflow:hidden">
        <div id="bar" style="height:100%;width:0;background:var(--accent);transition:width .25s"></div>
      </div>
      <span class="muted" id="progress">0%</span>
    </div>
  </div>
</div>`

const SCRIPT = `
var KEY = 'forge-todo-v1';
var state = { items: [], filter: 'all' };
var firstRun = true;
try { var raw = Store.get(KEY); if (raw) { state = JSON.parse(raw); firstRun = false; } } catch (e) { }

/* 演示引擎产出的第一版不该是一张白纸：带几条示例数据，
   这样"再改一版 → 加搜索/导出/柱状图"一上手就有内容可操作。
   示例只在从未存过数据时出现，用户自己加一条之后就不再回来。 */
if (firstRun) {
  var SEED = [
    '整理这周的会议纪要 · 25 分钟',
    '回复客户邮件并归档 · 15 分钟',
    '写周报同步给团队 · 45 分钟'
  ];
  state.items = SEED.map(function (text, i) {
    return { id: 'seed-' + i, text: text, done: i === 1 };
  });
}

var list = document.getElementById('list');
var input = document.getElementById('input');
var empty = document.getElementById('empty');
var hint = document.getElementById('hint');
hint.style.display = firstRun ? 'block' : 'none';

/* 用户一动手就不再是"示例"了 */
function save() { hint.style.display = 'none'; Store.set(KEY, JSON.stringify(state)); }

function render() {
  var counts = { all: state.items.length, active: 0, done: 0 };
  for (var i = 0; i < state.items.length; i++) counts[state.items[i].done ? 'done' : 'active']++;
  document.getElementById('c-all').textContent = counts.all;
  document.getElementById('c-active').textContent = counts.active;
  document.getElementById('c-done').textContent = counts.done;

  var pct = counts.all === 0 ? 0 : Math.round((counts.done / counts.all) * 100);
  document.getElementById('bar').style.width = pct + '%';
  document.getElementById('progress').textContent = pct + '%';

  var shown = state.items.filter(function (it) {
    if (state.filter === 'active') return !it.done;
    if (state.filter === 'done') return it.done;
    return true;
  });

  list.innerHTML = '';
  shown.forEach(function (it) {
    var li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:var(--panel2)';

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = it.done;
    box.style.cssText = 'width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex:none';
    box.onchange = function () { it.done = box.checked; save(); render(); };

    var span = document.createElement('span');
    span.textContent = it.text;
    span.style.cssText = 'flex:1;font-size:14px;word-break:break-word;' + (it.done ? 'text-decoration:line-through;color:var(--muted)' : '');

    var del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = '删除';
    del.style.padding = '6px 10px';
    del.onclick = function () {
      state.items = state.items.filter(function (x) { return x.id !== it.id; });
      save(); render();
    };

    li.appendChild(box); li.appendChild(span); li.appendChild(del);
    list.appendChild(li);
  });

  empty.style.display = shown.length === 0 ? 'block' : 'none';
}

document.getElementById('form').onsubmit = function (e) {
  e.preventDefault();
  var text = input.value.trim();
  if (!text) return;
  state.items.unshift({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), text: text, done: false });
  input.value = '';
  save(); render();
};

var filterBtns = document.querySelectorAll('[data-filter]');
for (var i = 0; i < filterBtns.length; i++) {
  (function (btn) {
    btn.onclick = function () {
      state.filter = btn.getAttribute('data-filter');
      for (var j = 0; j < filterBtns.length; j++) filterBtns[j].className = 'ghost';
      btn.className = 'ghost on';
      save(); render();
    };
  })(filterBtns[i]);
}

document.getElementById('clear').onclick = function () {
  state.items = state.items.filter(function (x) { return !x.done; });
  save(); render();
};

render();
`

export function buildTodo(ctx: BuildCtx): string {
  return page(ctx, BODY.replace('{TITLE}', esc(ctx.title)), SCRIPT)
}
