import { esc, page, type BuildCtx } from './shared'

const BODY = `
<div class="wrap">
  <div class="card">
    <h1 class="h1">${'{TITLE}'}</h1>
    <p class="sub">记录每一笔收支，自动按分类汇总。数据存在本地。</p>

    <div class="row" style="gap:12px;margin-bottom:18px">
      <div style="flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">收入</div>
        <div id="s-in" style="font-size:20px;font-weight:700;color:#33d69f">¥0</div>
      </div>
      <div style="flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">支出</div>
        <div id="s-out" style="font-size:20px;font-weight:700;color:#ff6b81">¥0</div>
      </div>
      <div style="flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="muted">结余</div>
        <div id="s-net" style="font-size:20px;font-weight:700">¥0</div>
      </div>
    </div>

    <form id="form" class="row" style="gap:8px;flex-wrap:wrap" autocomplete="off">
      <input id="amount" type="number" step="0.01" min="0" placeholder="金额" style="width:110px" required />
      <select id="kind" style="width:96px"><option value="out">支出</option><option value="in">收入</option></select>
      <select id="cat" style="width:120px"></select>
      <input id="note" placeholder="备注（可选）" style="flex:1;min-width:140px" maxlength="60" />
      <button type="submit">记一笔</button>
    </form>

    <h3 style="font-size:14px;margin:24px 0 10px;color:var(--muted)">支出分类占比</h3>
    <div id="chart"></div>

    <div class="row" style="margin:24px 0 10px">
      <h3 style="font-size:14px;margin:0;flex:1">流水</h3>
      <button class="ghost" id="export">导出 JSON</button>
      <button class="ghost" id="wipe">清空</button>
    </div>
    <div id="list"></div>
    <p class="muted" id="empty" style="text-align:center;padding:24px 0;display:none">还没有记录。</p>
    <p class="muted" id="hint" style="display:none;font-size:12px">以上是示例账目，直接删掉或替换成你自己的都行。</p>
  </div>
</div>`

const SCRIPT = `
var KEY = 'forge-ledger-v1';
var CATS = {
  out: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '其他'],
  in: ['工资', '奖金', '理财', '兼职', '其他']
};
var items = [];
var firstRun = true;
try { var raw = Store.get(KEY); if (raw) { items = JSON.parse(raw); firstRun = false; } } catch (e) { }

/* 第一版带几条示例账目，方便一打开就看到汇总和分类图在动；用户自己记一笔后就不再出现 */
if (firstRun) {
  var T = Date.now(), D = 86400000;
  items = [
    { id: 'seed-1', amount: 128, kind: 'out', cat: '餐饮', note: '楼下食堂', at: T - 2 * 3600000 },
    { id: 'seed-2', amount: 36, kind: 'out', cat: '交通', note: '打车去客户现场', at: T - 3600000 * 6 },
    { id: 'seed-3', amount: 1200, kind: 'in', cat: '兼职', note: '外包结款', at: T - D },
    { id: 'seed-4', amount: 268, kind: 'out', cat: '购物', note: '换了个键盘', at: T - D - 3600000 }
  ];
}

var catSel = document.getElementById('cat');
var kindSel = document.getElementById('kind');

function fillCats() {
  var list = CATS[kindSel.value];
  catSel.innerHTML = '';
  for (var i = 0; i < list.length; i++) {
    var o = document.createElement('option');
    o.value = list[i]; o.textContent = list[i];
    catSel.appendChild(o);
  }
}
kindSel.onchange = fillCats;
fillCats();

function money(n) { return '¥' + (Math.round(n * 100) / 100).toFixed(2); }
/* 用户一动手就不再是"示例"了 */
function save() {
  document.getElementById('hint').style.display = 'none';
  Store.set(KEY, JSON.stringify(items));
}

function render() {
  var sumIn = 0, sumOut = 0, byCat = {};
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.kind === 'in') sumIn += it.amount;
    else {
      sumOut += it.amount;
      byCat[it.cat] = (byCat[it.cat] || 0) + it.amount;
    }
  }
  document.getElementById('s-in').textContent = money(sumIn);
  document.getElementById('s-out').textContent = money(sumOut);
  var net = sumIn - sumOut;
  var netEl = document.getElementById('s-net');
  netEl.textContent = money(net);
  netEl.style.color = net >= 0 ? '#33d69f' : '#ff6b81';

  var chart = document.getElementById('chart');
  chart.innerHTML = '';
  var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
  if (cats.length === 0) {
    chart.innerHTML = '<p class="muted" style="margin:0">暂无支出数据。</p>';
  }
  var max = cats.length ? byCat[cats[0]] : 1;
  cats.forEach(function (c) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
    var name = document.createElement('span');
    name.textContent = c;
    name.style.cssText = 'width:60px;font-size:13px;color:var(--muted);flex:none';
    var track = document.createElement('div');
    track.style.cssText = 'flex:1;height:8px;background:var(--panel2);border-radius:99px;overflow:hidden';
    var bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:' + Math.round((byCat[c] / max) * 100) + '%;background:var(--accent);border-radius:99px;transition:width .3s';
    track.appendChild(bar);
    var val = document.createElement('span');
    val.textContent = money(byCat[c]);
    val.style.cssText = 'font-size:13px;width:80px;text-align:right;flex:none';
    row.appendChild(name); row.appendChild(track); row.appendChild(val);
    chart.appendChild(row);
  });

  var list = document.getElementById('list');
  list.innerHTML = '';
  var sorted = items.slice().sort(function (a, b) { return b.at - a.at; }).slice(0, 60);
  sorted.forEach(function (it) {
    var el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:var(--panel2)';

    var badge = document.createElement('span');
    badge.textContent = it.cat;
    badge.style.cssText = 'font-size:12px;padding:3px 8px;border-radius:99px;flex:none;background:color-mix(in srgb,var(--accent) 18%,transparent)';

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';
    var t = document.createElement('div');
    t.textContent = it.note || it.cat;
    t.style.cssText = 'font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var d = document.createElement('div');
    d.className = 'muted';
    d.textContent = new Date(it.at).toLocaleString('zh-CN');
    body.appendChild(t); body.appendChild(d);

    var amt = document.createElement('span');
    amt.textContent = (it.kind === 'in' ? '+' : '-') + money(it.amount);
    amt.style.cssText = 'font-weight:700;flex:none;color:' + (it.kind === 'in' ? '#33d69f' : '#ff6b81');

    var del = document.createElement('button');
    del.className = 'ghost'; del.textContent = '×';
    del.style.cssText = 'padding:4px 10px;flex:none';
    del.onclick = function () {
      items = items.filter(function (x) { return x.id !== it.id; });
      save(); render();
    };

    el.appendChild(badge); el.appendChild(body); el.appendChild(amt); el.appendChild(del);
    list.appendChild(el);
  });
  document.getElementById('empty').style.display = items.length === 0 ? 'block' : 'none';
}

document.getElementById('form').onsubmit = function (e) {
  e.preventDefault();
  var amount = parseFloat(document.getElementById('amount').value);
  if (!amount || amount <= 0) return;
  items.push({
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    amount: amount,
    kind: kindSel.value,
    cat: catSel.value,
    note: document.getElementById('note').value.trim(),
    at: Date.now()
  });
  document.getElementById('amount').value = '';
  document.getElementById('note').value = '';
  save(); render();
};

document.getElementById('wipe').onclick = function () {
  if (!confirm('确定清空全部记录？')) return;
  items = []; save(); render();
};

document.getElementById('export').onclick = function () {
  var blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ledger.json';
  a.click();
};

document.getElementById('hint').style.display = firstRun ? 'block' : 'none';
render();
`

export function buildLedger(ctx: BuildCtx): string {
  return page(ctx, BODY.replace('{TITLE}', esc(ctx.title)), SCRIPT, '.card{padding:24px}')
}
