import { esc, page, type BuildCtx } from './shared'

const BODY = `
<div class="wrap" style="max-width:520px">
  <div class="card">
    <h1 class="h1">${'{TITLE}'}</h1>
    <p class="sub">方向键 / WASD 移动，手机可滑动棋盘或用下方方向键。相同的两块碰在一起就合并，目标 2048。</p>

    <div class="row" style="margin-bottom:14px">
      <div style="flex:1">
        <div class="muted">得分</div>
        <div id="score" style="font-size:26px;font-weight:700">0</div>
      </div>
      <div style="text-align:right">
        <div class="muted">最高分</div>
        <div id="best" style="font-size:26px;font-weight:700;color:var(--accent)">0</div>
      </div>
    </div>

    <div id="board">
      <div id="cells"></div>
      <div id="tiles"></div>
      <div id="over">
        <div>
          <div id="overText" style="font-size:19px;font-weight:700;margin-bottom:4px">游戏结束</div>
          <div id="overSub" class="muted" style="margin-bottom:14px"></div>
          <button id="overBtn">再来一局</button>
        </div>
      </div>
    </div>

    <div id="pad">
      <div></div><button class="ghost" data-dir="up">↑</button><div></div>
      <button class="ghost" data-dir="left">←</button><button class="ghost" data-dir="down">↓</button><button class="ghost" data-dir="right">→</button>
    </div>

    <div style="margin-top:14px">
      <button class="ghost" id="new" style="width:100%">重新开始</button>
    </div>
  </div>
</div>`

/*
 * 棋盘类布局最容易踩的坑，这份实现是照着两条规矩写的，改的时候别破坏：
 *
 * 1) 背景格与数字块共用**同一个坐标系**。
 *    格子边长 1、间隙 0.12，一条边共 4 格 + 5 条间隙 = 4.6 个单位；
 *    两者都只通过 `place()` 定位，`pct()` 是唯一的坐标公式 ——
 *    只要不绕开它，数字块就不可能和背景格错位。
 *
 * 2) 与尺寸有关的量（字号、圆角）必须**等容器量出尺寸之后**再算。
 *    之前那版在容器还是 0 宽时就把格子边长算死了，于是重新打开项目时
 *    数字缩在左上角。这里拆成两半：
 *      - 位置用百分比（无需测量，任何时候都是对的，第一帧就对）；
 *      - 字号/圆角用测出来的 `--cell`（0 宽时先退回默认值，用 rAF 重试 + ResizeObserver 补算）。
 *    这样"预览区尺寸确定后计算布局"和"第一帧就不错位"同时成立。
 */
const SCRIPT = `
var N = 4;
var GAP = 0.12;
var UNIT = N + (N + 1) * GAP;
var CELL_PCT = 100 / UNIT;
var BEST_KEY = 'forge-board2048-best-v1';

var board = document.getElementById('board');
var cellsLayer = document.getElementById('cells');
var tilesLayer = document.getElementById('tiles');
var scoreEl = document.getElementById('score');
var bestEl = document.getElementById('best');
var overEl = document.getElementById('over');

/* 唯一的坐标公式：第 i 行/列的左（上）边，单位是百分比 */
function pct(i) { return ((GAP + i * (1 + GAP)) * 100) / UNIT; }

/* 唯一的定位入口：背景格和数字块都走这里 */
function place(el, r, c) {
  el.style.left = pct(c) + '%';
  el.style.top = pct(r) + '%';
}

board.style.setProperty('--cell-pct', CELL_PCT.toFixed(4) + '%');

for (var br = 0; br < N; br++) {
  for (var bc = 0; bc < N; bc++) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    place(cell, br, bc);
    cellsLayer.appendChild(cell);
  }
}

/* 与尺寸相关的量：量出格子实际边长，字号和圆角都按它算 */
var tried = 0;
function measure() {
  var w = board.clientWidth;
  if (w <= 0) return false;
  board.style.setProperty('--cell', ((w * CELL_PCT) / 100).toFixed(2) + 'px');
  return true;
}
function layout() {
  if (measure()) return;
  /* 容器还没尺寸（重开项目时预览区刚挂载、或面板还隐藏着）：
     位置已经是对的，这里等的只是字号。等不到也不影响能玩。 */
  if (++tried > 240) return;
  requestAnimationFrame(layout);
}
layout();

if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { measure(); }).observe(board);
window.addEventListener('resize', function () { measure(); });

var tiles = [];
var els = {};
var nextId = 1;
var score = 0;
var best = parseInt(Store.get(BEST_KEY) || '0', 10) || 0;
var over = false;
/* 结算遮罩盖着的时候不接受输入，否则会隔着弹层把棋盘推走 */
var paused = false;
var celebrated = false;
bestEl.textContent = String(best);

function emptyCells() {
  var used = {}, out = [], i;
  for (i = 0; i < tiles.length; i++) used[tiles[i].r + ',' + tiles[i].c] = 1;
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) if (!used[r + ',' + c]) out.push([r, c]);
  }
  return out;
}

function spawn() {
  var free = emptyCells();
  if (!free.length) return;
  var p = free[Math.floor(Math.random() * free.length)];
  tiles.push({ id: nextId++, v: Math.random() < 0.9 ? 2 : 4, r: p[0], c: p[1] });
}

function tileAt(r, c) {
  for (var i = 0; i < tiles.length; i++) {
    if (tiles[i].r === r && tiles[i].c === c) return tiles[i];
  }
  return null;
}

/* 每个方向都换算成"从目标端到远端"的一条条线，于是滑动 + 合并只需一遍遍历 */
function lines(dir) {
  var vert = dir === 'up' || dir === 'down';
  var forward = dir === 'up' || dir === 'left';
  var out = [], i, j;
  for (i = 0; i < N; i++) {
    var line = [];
    for (j = 0; j < N; j++) {
      var k = forward ? j : N - 1 - j;
      line.push(vert ? [k, i] : [i, k]);
    }
    out.push(line);
  }
  return out;
}

function move(dir) {
  if (over || paused) return;
  var moved = false, gained = 0, eaten = [], i, j;
  var all = lines(dir);
  for (i = 0; i < all.length; i++) {
    var line = all[i], seq = [];
    for (j = 0; j < line.length; j++) {
      var t = tileAt(line[j][0], line[j][1]);
      if (t) seq.push(t);
    }
    var slot = 0;
    for (j = 0; j < seq.length; j++) {
      var cur = seq[j];
      if (j + 1 < seq.length && seq[j + 1].v === cur.v) {
        var gone = seq[j + 1];
        cur.v = cur.v * 2;
        cur.merged = 1;
        gone.dead = 1;
        eaten.push(gone);
        gained += cur.v;
        j++;
      }
      var dest = line[slot++];
      if (cur.r !== dest[0] || cur.c !== dest[1]) {
        cur.r = dest[0];
        cur.c = dest[1];
        moved = true;
      }
    }
  }
  if (eaten.length) {
    var rest = [];
    for (i = 0; i < tiles.length; i++) if (!tiles[i].dead) rest.push(tiles[i]);
    tiles = rest;
    moved = true;
  }
  if (gained) {
    score += gained;
    moved = true;
  }
  if (!moved) return;
  spawn();
  draw();
  settle();
}

function setFace(el, v) {
  var tier = v <= 4 ? 't1' : v <= 64 ? 't2' : v <= 512 ? 't3' : 't4';
  el.className = 'tile ' + tier;
  el.textContent = String(v);
  el.style.fontSize = 'calc(var(--cell) * ' + (v >= 1024 ? 0.32 : v >= 128 ? 0.38 : 0.44) + ')';
}

function reflash(el) {
  el.classList.remove('pop');
  /* 读一次布局强制重启动画，否则同一块连续合并只有第一次会跳 */
  void el.offsetWidth;
  el.classList.add('pop');
}

function draw() {
  var alive = {}, i;
  for (i = 0; i < tiles.length; i++) {
    var t = tiles[i];
    alive[t.id] = 1;
    var el = els[t.id];
    var fresh = !el;
    if (fresh) {
      el = document.createElement('div');
      el.__v = 0;
      els[t.id] = el;
      tilesLayer.appendChild(el);
    }
    place(el, t.r, t.c);
    if (el.__v !== t.v) {
      el.__v = t.v;
      setFace(el, t.v);
    }
    if (t.merged) {
      t.merged = 0;
      reflash(el);
    } else if (fresh) {
      reflash(el);
    }
  }
  var ids = [];
  for (var id in els) ids.push(id);
  for (var k = 0; k < ids.length; k++) {
    var id = ids[k];
    if (alive[id]) continue;
    var dead = els[id];
    delete els[id];
    dead.classList.add('gone');
    /* 被吃掉的方块留在原地淡出即可 —— 让"合并"看得见，又不用多养一套动画状态 */
    (function (node) {
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200);
    })(dead);
  }
  scoreEl.textContent = String(score);
  if (score > best) {
    best = score;
    bestEl.textContent = String(best);
    Store.set(BEST_KEY, String(best));
  }
}

function grid() {
  var g = [], r, c;
  for (r = 0; r < N; r++) {
    g.push([0, 0, 0, 0]);
    for (c = 0; c < N; c++) {
      var t = tileAt(r, c);
      g[r][c] = t ? t.v : 0;
    }
  }
  return g;
}

function canMove() {
  if (tiles.length < N * N) return true;
  var g = grid();
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) {
      if (c + 1 < N && g[r][c] === g[r][c + 1]) return true;
      if (r + 1 < N && g[r][c] === g[r + 1][c]) return true;
    }
  }
  return false;
}

function showOver(text, sub, label, isOver) {
  document.getElementById('overText').textContent = text;
  document.getElementById('overSub').textContent = sub;
  document.getElementById('overBtn').textContent = label;
  overEl.className = isOver ? 'on dead' : 'on';
  paused = true;
}

function hideOver() {
  overEl.className = '';
  paused = false;
}

function settle() {
  var i, win = false;
  for (i = 0; i < tiles.length; i++) if (tiles[i].v >= 2048) win = true;
  if (win && !celebrated) {
    celebrated = true;
    showOver('达成 2048！', '当前得分 ' + score, '继续玩', false);
    return;
  }
  if (!canMove()) {
    over = true;
    showOver('没有可移动的方向了', '最终得分 ' + score, '再来一局', true);
  }
}

function reset() {
  for (var id in els) {
    if (els[id].parentNode) els[id].parentNode.removeChild(els[id]);
  }
  els = {};
  tiles = [];
  nextId = 1;
  score = 0;
  over = false;
  celebrated = false;
  hideOver();
  spawn();
  spawn();
  draw();
  measure();
}

var KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right'
};

window.addEventListener('keydown', function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  var dir = KEYS[e.key];
  if (!dir) return;
  e.preventDefault();
  move(dir);
});

document.getElementById('pad').onclick = function (e) {
  var b = e.target.closest('[data-dir]');
  if (b) move(b.getAttribute('data-dir'));
};

var sx = 0, sy = 0, touching = false;
board.addEventListener('touchstart', function (e) {
  var t = e.changedTouches[0];
  sx = t.clientX;
  sy = t.clientY;
  touching = true;
}, { passive: true });

board.addEventListener('touchend', function (e) {
  if (!touching) return;
  touching = false;
  var t = e.changedTouches[0];
  var dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  e.preventDefault();
  move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
}, { passive: false });

document.getElementById('overBtn').onclick = function () {
  if (over) reset();
  else hideOver();
};
document.getElementById('new').onclick = reset;

reset();
`

export function buildBoard2048(ctx: BuildCtx): string {
  return page(
    ctx,
    BODY.replace('{TITLE}', esc(ctx.title)),
    SCRIPT,
    [
      /* 21.7391% = 100 / (4 + 5×0.12)，和脚本里的 CELL_PCT 是同一个数；
         这里只做无脚本时的兜底，实际运行时会由脚本写回同一个值。 */
      '#board{--cell-pct:21.7391%;--cell:44px;position:relative;width:100%;max-width:440px;margin:0 auto;',
      'aspect-ratio:1/1;background:var(--panel2);border:1px solid var(--line);border-radius:14px;overflow:hidden}',
      '#cells,#tiles{position:absolute;inset:0}',
      '#tiles{z-index:1}',
      '.cell,.tile{position:absolute;width:var(--cell-pct);height:var(--cell-pct);border-radius:calc(var(--cell) * .13)}',
      '.cell{background:color-mix(in srgb,var(--text) 7%,transparent)}',
      '.tile{display:grid;place-items:center;font-weight:800;background:var(--panel);color:var(--text);',
      'transition:left .12s ease,top .12s ease,background .12s,color .12s;will-change:left,top}',
      '.tile.t1{background:color-mix(in srgb,var(--accent) 14%,var(--panel))}',
      '.tile.t2{background:color-mix(in srgb,var(--accent) 32%,var(--panel))}',
      '.tile.t3{background:color-mix(in srgb,var(--accent) 58%,var(--panel));color:#fff}',
      '.tile.t4{background:var(--accent);color:#fff;box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 45%,transparent)}',
      '.tile.pop{animation:tpop .18s ease}',
      '@keyframes tpop{from{transform:scale(.82)}to{transform:scale(1)}}',
      '.tile.gone{opacity:0;transform:scale(1.06);transition:opacity .16s,transform .16s}',
      '#over{position:absolute;inset:0;z-index:2;display:none;place-items:center;text-align:center;padding:16px;',
      'background:color-mix(in srgb,var(--bg) 84%,transparent);backdrop-filter:blur(3px)}',
      '#over.on{display:grid}',
      '#over.dead #overText{color:var(--accent)}',
      '#pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;max-width:220px;margin-left:auto;margin-right:auto}',
      '@media (max-width:560px){#pad{max-width:100%}}',
    ].join('\n'),
  )
}
