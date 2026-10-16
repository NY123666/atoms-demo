import { esc, page, type BuildCtx } from './shared'

const BODY = `
<div class="wrap" style="max-width:520px">
  <div class="card">
    <h1 class="h1">${'{TITLE}'}</h1>
    <p class="sub">方向键 / WASD 控制，空格暂停。手机可用下方方向键。</p>

    <div class="row" style="margin-bottom:14px">
      <div style="flex:1">
        <div class="muted">当前得分</div>
        <div id="score" style="font-size:26px;font-weight:700">0</div>
      </div>
      <div style="text-align:right">
        <div class="muted">最高分</div>
        <div id="best" style="font-size:26px;font-weight:700;color:var(--accent)">0</div>
      </div>
    </div>

    <div style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--panel2)">
      <canvas id="cv" tabindex="0" style="display:block;width:100%;height:auto;outline:none"></canvas>
      <div id="over" style="position:absolute;inset:0;display:none;place-items:center;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);text-align:center">
        <div>
          <div style="font-size:19px;font-weight:700;color:#fff" id="overText">游戏结束</div>
          <button id="again" style="margin-top:14px">再来一局</button>
        </div>
      </div>
    </div>

    <div class="row" style="margin-top:14px;gap:10px">
      <select id="speed" style="width:auto">
        <option value="160">慢速</option>
        <option value="110" selected>标准</option>
        <option value="75">快速</option>
        <option value="50">狂暴</option>
      </select>
      <button class="ghost" id="pause">暂停</button>
      <div style="flex:1"></div>
      <button class="ghost" id="reset">重新开始</button>
    </div>

    <div id="pad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;max-width:220px;margin-left:auto;margin-right:auto">
      <div></div><button class="ghost" data-dir="up">↑</button><div></div>
      <button class="ghost" data-dir="left">←</button><button class="ghost" data-dir="down">↓</button><button class="ghost" data-dir="right">→</button>
    </div>
  </div>
</div>`

const SCRIPT = `
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); return this; };
}
var CELL = 18, COLS = 20, ROWS = 20;
var cv = document.getElementById('cv');
var ctx = cv.getContext('2d');
var DPR = window.devicePixelRatio || 1;
cv.width = COLS * CELL * DPR;
cv.height = ROWS * CELL * DPR;
cv.style.height = (ROWS * CELL) + 'px';
ctx.scale(DPR, DPR);

var BEST_KEY = 'forge-snake-best-v1';
var score = 0, best = parseInt(Store.get(BEST_KEY) || '0', 10) || 0;
var snake, dir, queue, food, timer = null, running = false, speed = 110;

document.getElementById('best').textContent = best;

function reset() {
  snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  dir = { x: 1, y: 0 };
  queue = [];
  score = 0;
  placeFood();
  document.getElementById('score').textContent = '0';
  document.getElementById('over').style.display = 'none';
  running = true;
  document.getElementById('pause').textContent = '暂停';
  tick();
}

function placeFood() {
  do {
    food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (snake.some(function (s) { return s.x === food.x && s.y === food.y; }));
}

function step() {
  if (queue.length > 0) {
    var nd = queue.shift();
    if (nd.x !== -dir.x || nd.y !== -dir.y) dir = nd;
  }
  var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) return gameOver('撞墙了');
  for (var i = 0; i < snake.length - 1; i++) {
    if (snake[i].x === head.x && snake[i].y === head.y) return gameOver('咬到自己了');
  }

  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score += 10;
    document.getElementById('score').textContent = String(score);
    if (score > best) {
      best = score;
      document.getElementById('best').textContent = String(best);
      Store.set(BEST_KEY, String(best));
    }
    placeFood();
  } else {
    snake.pop();
  }
  draw();
}

function draw() {
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--panel2').trim() || '#111';
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

  ctx.strokeStyle = 'rgba(128,140,190,.10)';
  ctx.lineWidth = 1;
  for (var i = 1; i < COLS; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, ROWS * CELL); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(COLS * CELL, i * CELL); ctx.stroke();
  }

  var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#6d5cff';
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL * 0.32, 0, Math.PI * 2);
  ctx.fill();

  for (var j = snake.length - 1; j >= 0; j--) {
    ctx.fillStyle = j === 0 ? accent : 'rgba(109,92,255,.55)';
    var pad = j === 0 ? 1 : 2;
    ctx.beginPath();
    ctx.roundRect(snake[j].x * CELL + pad, snake[j].y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 4);
    ctx.fill();
  }
}

function tick() {
  if (timer) clearInterval(timer);
  timer = setInterval(function () { if (running) step(); }, speed);
}

function gameOver(reason) {
  running = false;
  if (timer) clearInterval(timer);
  document.getElementById('overText').textContent = reason + ' · 得分 ' + score;
  document.getElementById('over').style.display = 'grid';
}

function turn(x, y) {
  if (queue.length > 2) return;
  queue.push({ x: x, y: y });
}

var KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0]
};

window.addEventListener('keydown', function (e) {
  if (e.key === ' ') { e.preventDefault(); togglePause(); return; }
  var k = KEYS[e.key];
  if (!k) return;
  e.preventDefault();
  if (!running && document.getElementById('over').style.display === 'none') { running = true; tick(); }
  turn(k[0], k[1]);
});

function togglePause() {
  if (document.getElementById('over').style.display === 'grid') return;
  running = !running;
  document.getElementById('pause').textContent = running ? '暂停' : '继续';
  if (running) tick();
}

document.getElementById('pause').onclick = togglePause;
document.getElementById('again').onclick = reset;
document.getElementById('reset').onclick = reset;
document.getElementById('speed').onchange = function (e) { speed = parseInt(e.target.value, 10); tick(); };
document.getElementById('pad').onclick = function (e) {
  var b = e.target.closest('[data-dir]');
  if (!b) return;
  var m = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[b.getAttribute('data-dir')];
  if (m) turn(m[0], m[1]);
};

reset();
cv.focus();
`

export function buildSnake(ctx: BuildCtx): string {
  return page(
    ctx,
    BODY.replace('{TITLE}', esc(ctx.title)),
    SCRIPT,
    'canvas{border-radius:12px}@media (max-width:560px){#pad{max-width:100%!important}}',
  )
}
