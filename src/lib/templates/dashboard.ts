import { esc, page, type BuildCtx } from './shared'

const BODY = `
<div class="wrap" style="max-width:960px">
  <div class="card">
    <div class="row" style="margin-bottom:18px">
      <div style="flex:1">
        <h1 class="h1">${'{TITLE}'}</h1>
        <p class="sub" style="margin:0">通用管理工作台：条目增删改查、状态流转、分类统计，数据存本地。</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">条目总数</div><div id="k-total" style="font-size:22px;font-weight:700">0</div>
      </div>
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">进行中</div><div id="k-doing" style="font-size:22px;font-weight:700;color:var(--accent)">0</div>
      </div>
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">已完成</div><div id="k-done" style="font-size:22px;font-weight:700;color:#33d69f">0</div>
      </div>
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">合计数值</div><div id="k-sum" style="font-size:22px;font-weight:700">0</div>
      </div>
    </div>

    <form id="form" class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:18px" autocomplete="off">
      <input id="name" placeholder="条目名称" style="flex:1;min-width:150px" maxlength="60" required />
      <input id="cat" placeholder="分类" style="width:110px" maxlength="20" />
      <input id="amount" type="number" placeholder="数值" style="width:100px" />
      <select id="status" style="width:110px">
        <option value="todo">待处理</option>
        <option value="doing">进行中</option>
        <option value="done">已完成</option>
      </select>
      <button type="submit">新增</button>
    </form>

    <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input id="q" placeholder="搜索…" style="flex:1;min-width:140px" />
      <button class="ghost on" data-f="all">全部</button>
      <button class="ghost" data-f="todo">待处理</button>
      <button class="ghost" data-f="doing">进行中</button>
      <button class="ghost" data-f="done">已完成</button>
      <button class="ghost" id="export">导出</button>
    </div>

    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="text-align:left;color:var(--muted);font-size:12px">
            <th style="padding:8px 10px;border-bottom:1px solid var(--line)">名称</th>
            <th style="padding:8px 10px;border-bottom:1px solid var(--line)">分类</th>
            <th style="padding:8px 10px;border-bottom:1px solid var(--line);text-align:right">数值</th>
            <th style="padding:8px 10px;border-bottom:1px solid var(--line)">状态</th>
            <th style="padding:8px 10px;border-bottom:1px solid var(--line);width:110px"></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="muted" id="empty" style="text-align:center;padding:24px 0;display:none">没有匹配的条目。</p>
    <p class="muted" id="hint" style="display:none;font-size:12px">以上是示例条目，直接改或删都行。</p>

    <h3 style="font-size:14px;margin:24px 0 10px;color:var(--muted)">分类数值分布</h3>
    <div id="chart"></div>
  </div>
</div>`

const SCRIPT = `
var KEY = 'forge-dashboard-v1';
var STATUS = { todo: '待处理', doing: '进行中', done: '已完成' };
var STATUS_COLOR = { todo: '#8b93b8', doing: 'var(--accent)', done: '#33d69f' };
var items = [];
var firstRun = true;
try { var raw = Store.get(KEY); if (raw) { items = JSON.parse(raw); firstRun = false; } } catch (e) { }

/* 第一版带几条示例条目，方便一打开就看到统计卡和表格是活的；用户自己新增后就不再出现 */
if (firstRun) {
  var T = Date.now();
  items = [
    { id: 'seed-1', name: '活动页视觉稿', cat: '设计', amount: 12, status: 'doing', at: T - 3600000 },
    { id: 'seed-2', name: '接口联调', cat: '研发', amount: 8, status: 'todo', at: T - 7200000 },
    { id: 'seed-3', name: '数据埋点梳理', cat: '数据', amount: 5, status: 'done', at: T - 86400000 },
    { id: 'seed-4', name: '竞品调研', cat: '研究', amount: 6, status: 'todo', at: T - 172800000 }
  ];
}

var filter = 'all', query = '';

/* 用户一动手就不再是"示例"了 */
function save() {
  document.getElementById('hint').style.display = 'none';
  Store.set(KEY, JSON.stringify(items));
}
function money(n) { return String(Math.round(n * 100) / 100); }

function visible() {
  return items.filter(function (it) {
    if (filter !== 'all' && it.status !== filter) return false;
    if (query && (it.name + ' ' + it.cat).toLowerCase().indexOf(query) === -1) return false;
    return true;
  });
}

function render() {
  var total = items.length, doing = 0, done = 0, sum = 0, byCat = {};
  items.forEach(function (it) {
    if (it.status === 'doing') doing++;
    if (it.status === 'done') done++;
    sum += it.amount || 0;
    var c = it.cat || '未分类';
    byCat[c] = (byCat[c] || 0) + (it.amount || 0);
  });
  document.getElementById('k-total').textContent = String(total);
  document.getElementById('k-doing').textContent = String(doing);
  document.getElementById('k-done').textContent = String(done);
  document.getElementById('k-sum').textContent = money(sum);

  var rows = document.getElementById('rows');
  rows.innerHTML = '';
  visible().forEach(function (it) {
    var tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--line)';

    function cell(text, align) {
      var td = document.createElement('td');
      td.textContent = text;
      td.style.padding = '10px';
      if (align) td.style.textAlign = align;
      return td;
    }

    var nameCell = cell(it.name);
    nameCell.style.fontWeight = '600';

    var statusTd = document.createElement('td');
    statusTd.style.padding = '10px';
    var sel = document.createElement('select');
    sel.style.cssText = 'width:auto;padding:5px 8px;font-size:13px;color:' + STATUS_COLOR[it.status];
    Object.keys(STATUS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = STATUS[k];
      if (k === it.status) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { it.status = sel.value; save(); render(); };
    statusTd.appendChild(sel);

    var opTd = document.createElement('td');
    opTd.style.padding = '10px';
    var del = document.createElement('button');
    del.className = 'ghost'; del.textContent = '删除';
    del.style.cssText = 'padding:5px 10px;font-size:13px';
    del.onclick = function () {
      items = items.filter(function (x) { return x.id !== it.id; });
      save(); render();
    };
    opTd.appendChild(del);

    tr.appendChild(nameCell);
    tr.appendChild(cell(it.cat || '—'));
    tr.appendChild(cell(money(it.amount || 0), 'right'));
    tr.appendChild(statusTd);
    tr.appendChild(opTd);
    rows.appendChild(tr);
  });
  document.getElementById('empty').style.display = visible().length === 0 ? 'block' : 'none';

  var chart = document.getElementById('chart');
  chart.innerHTML = '';
  var cats = Object.keys(byCat).filter(function (c) { return byCat[c] > 0; }).sort(function (a, b) { return byCat[b] - byCat[a]; });
  if (cats.length === 0) chart.innerHTML = '<p class="muted" style="margin:0">暂无数据。</p>';
  var max = cats.length ? byCat[cats[0]] : 1;
  cats.forEach(function (c) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
    var label = document.createElement('span');
    label.textContent = c;
    label.style.cssText = 'width:90px;font-size:13px;color:var(--muted);flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var track = document.createElement('div');
    track.style.cssText = 'flex:1;height:8px;background:var(--panel2);border-radius:99px;overflow:hidden';
    var bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:' + Math.round((byCat[c] / max) * 100) + '%;background:var(--accent);border-radius:99px;transition:width .3s';
    track.appendChild(bar);
    var val = document.createElement('span');
    val.textContent = money(byCat[c]);
    val.style.cssText = 'font-size:13px;width:70px;text-align:right;flex:none';
    row.appendChild(label); row.appendChild(track); row.appendChild(val);
    chart.appendChild(row);
  });
}

document.getElementById('form').onsubmit = function (e) {
  e.preventDefault();
  var name = document.getElementById('name').value.trim();
  if (!name) return;
  items.unshift({
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    name: name,
    cat: document.getElementById('cat').value.trim(),
    amount: parseFloat(document.getElementById('amount').value) || 0,
    status: document.getElementById('status').value,
    at: Date.now()
  });
  document.getElementById('name').value = '';
  document.getElementById('amount').value = '';
  save(); render();
};

document.getElementById('q').oninput = function (e) {
  query = e.target.value.trim().toLowerCase();
  render();
};

var fbtns = document.querySelectorAll('[data-f]');
for (var i = 0; i < fbtns.length; i++) {
  (function (btn) {
    btn.onclick = function () {
      filter = btn.getAttribute('data-f');
      for (var j = 0; j < fbtns.length; j++) fbtns[j].className = 'ghost';
      btn.className = 'ghost on';
      render();
    };
  })(fbtns[i]);
}

document.getElementById('export').onclick = function () {
  var blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'data.json';
  a.click();
};

document.getElementById('hint').style.display = firstRun ? 'block' : 'none';
render();
`

export function buildDashboard(ctx: BuildCtx): string {
  return page(ctx, BODY.replace('{TITLE}', esc(ctx.title)), SCRIPT)
}
