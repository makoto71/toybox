// すみながし — アプリ本体 (入力・UI・音・保存)
import { createFluid } from './fluid.js';

const canvas = document.getElementById('water');
const fluid = createFluid(canvas);

// ---------- いろ ----------

const INKS = {
  sumi: { r: 0.10, g: 0.10, b: 0.12, a: 0.92 },
  ai: { r: 0.13, g: 0.23, b: 0.42, a: 0.90 },
  shu: { r: 0.78, g: 0.24, b: 0.16, a: 0.90 },
  kogane: { r: 0.80, g: 0.58, b: 0.12, a: 0.90 },
  matsu: { r: 0.16, g: 0.38, b: 0.25, a: 0.90 },
  fuji: { r: 0.45, g: 0.34, b: 0.61, a: 0.90 },
  mizu: { r: 0, g: 0, b: 0, a: 0 }
};
const CLEAR = INKS.mizu;

let currentInk = 'sumi';
let currentTool = 'fude'; // 'fude' | 'kushi'
let soundOn = true;
let paused = false;

// ---------- しずく / ひっかき のパラメータ ----------

const DROP_RMAX = 0.085; // しずくの最大半径 (縦方向UV単位)
const DROP_GROW_TAU = 900; // ms
const PHASE_MS = 620; // 長押しで すみ⇄みず が切り替わる周期
const RAKE_FORCE = 5800;
const RAKE_RADIUS = 0.0009; // 広すぎると模様が塊ごと潰れてぐちゃっとする
const RAKE_MAX_SPEED = 900; // 速いフリックでジェット (=双子渦の素) ができないよう上限
const COMB_TINES = 5;
const COMB_SPACING = 0.055;
const COMB_RADIUS = 0.00035;
const MOVE_THRESHOLD = 14; // px。これを超えたらしずく→ひっかきへ

// ---------- おと (合成のみ、素材ファイル不要) ----------

const audio = (() => {
  let ctx = null;
  let swishGain = null;
  let swishTarget = 0;

  function ensure () {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // ひっかき用のさらさら音: ループノイズ + バンドパス
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 0.8;
    swishGain = ctx.createGain();
    swishGain.gain.value = 0;
    src.connect(bp).connect(swishGain).connect(ctx.destination);
    src.start();
  }

  function plip (pitch = 540, vol = 0.16) {
    if (!soundOn) return;
    ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch * 1.7, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + 0.16);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  function swish (speed) {
    if (!soundOn) return;
    ensure();
    if (!ctx) return;
    swishTarget = Math.min(0.05, speed * 0.012);
  }

  function tick () {
    if (!ctx || !swishGain) return;
    swishTarget *= 0.82;
    const g = swishGain.gain;
    g.setTargetAtTime(soundOn ? swishTarget : 0, ctx.currentTime, 0.04);
  }

  return { plip, swish, tick, ensure };
})();

// ---------- ポインタ ----------

const pointers = new Map();

function toUV (e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: 1 - (e.clientY - rect.top) / rect.height
  };
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.ensure();
  hideHint();
  if (paused) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等でIDが無効な場合 */ }
  markActivity();
  const uv = toUV(e);
  const now = performance.now();

  if (pointers.size === 1) {
    // 2本目の指: アルコールのしずく。強い放射流でインクを繊維状に押しやる
    const other = [...pointers.values()][0];
    other.mode = 'dead';
    const mx = (other.x + uv.x) / 2;
    const my = (other.y + uv.y) / 2;
    fluid.splatDye(mx, my, CLEAR, 0.03);
    fluid.splatRadial(mx, my, 260, 0.004);
    audio.plip(300, 0.2);
    pointers.set(e.pointerId, { ...uv, downX: e.clientX, downY: e.clientY, mode: 'dead' });
    return;
  }

  pointers.set(e.pointerId, {
    x: uv.x, y: uv.y,
    downX: e.clientX, downY: e.clientY,
    mode: 'drop',
    phaseStart: now,
    phaseR: 0, // 現フェーズで適用済みのしずく半径 (増分適用のため)
    useClear: false
  });
  audio.plip(560 + Math.random() * 120, 0.14);
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || paused || p.mode === 'dead') return;
  const uv = toUV(e);

  if (p.mode === 'drop') {
    const moved = Math.hypot(e.clientX - p.downX, e.clientY - p.downY);
    if (moved > MOVE_THRESHOLD) p.mode = 'rake';
  }

  if (p.mode === 'rake') {
    let dx = (uv.x - p.x) * RAKE_FORCE;
    let dy = (uv.y - p.y) * RAKE_FORCE;
    let speed = Math.hypot(dx, dy);
    if (speed > RAKE_MAX_SPEED) {
      dx *= RAKE_MAX_SPEED / speed;
      dy *= RAKE_MAX_SPEED / speed;
      speed = RAKE_MAX_SPEED;
    }
    if (currentTool === 'kushi') {
      // くし: 進行方向と垂直に並んだ複数の細い筋
      const len = Math.max(Math.hypot(uv.x - p.x, uv.y - p.y), 1e-5);
      const aspectR = canvas.width / canvas.height;
      const px = -(uv.y - p.y) / len;
      const py = (uv.x - p.x) / len;
      const half = (COMB_TINES - 1) / 2;
      for (let i = 0; i < COMB_TINES; i++) {
        const off = (i - half) * COMB_SPACING;
        fluid.splatVelocity(uv.x + px * off / aspectR, uv.y + py * off, dx, dy, COMB_RADIUS);
      }
    } else {
      fluid.splatVelocity(uv.x, uv.y, dx, dy, RAKE_RADIUS);
    }
    audio.swish(Math.min(speed, 8));
    markActivity();
  }

  p.x = uv.x;
  p.y = uv.y;
});

function release (e) {
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
// タッチ端末で canvas のキャプチャ外へ逃げた up も拾い、幽霊ポインタを残さない
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('contextmenu', (e) => e.preventDefault());

// しずくの注入はフレームごとに行う (押している間ふくらみ続ける)
// マーブリング変換は「半径drのしずくを重ねがけ = 半径√(Σdr²)のしずく」なので、
// フェーズ内の目標半径との差分だけを毎フレーム適用する。
function updateDrops (now) {
  for (const p of pointers.values()) {
    if (p.mode !== 'drop') continue;
    const t = now - p.phaseStart;
    const ink = INKS[currentInk];
    if (t > PHASE_MS && ink.a > 0) {
      // 長押し: すみ⇄みず を自動で交互に → ひとりでに同心円ができる
      p.useClear = !p.useClear;
      p.phaseStart = now;
      p.phaseR = 0;
      audio.plip(p.useClear ? 700 : 500, 0.1);
    }
    // rAF の now は pointerdown 時の performance.now() より過去のことがある。
    // tt が負だと sqrt(1-exp(...)) が NaN になり画面全体が塗りつぶされる
    const tt = Math.max(now - p.phaseStart, 0);
    const r = DROP_RMAX * Math.sqrt(1 - Math.exp(-tt / DROP_GROW_TAU));
    const dr = Math.sqrt(Math.max(r * r - p.phaseR * p.phaseR, 0));
    if (!(dr >= 0.002)) continue; // NaN もここではじく
    const color = (p.useClear || ink.a === 0) ? CLEAR : ink;
    fluid.splatDrop(p.x, p.y, dr, color);
    p.phaseR = r;
    markActivity();
  }
}

// ---------- メインループ ----------

// 水面が静まったらシミュレーションを凍結する。
// 流速ゼロ付近でも MacCormack 移流を回し続けると、わずかな再サンプリング誤差が
// 何百フレームも蓄積して塗りが縞状に劣化する。最後の操作から SETTLE_MS 経つと
// step を止め、表示だけ続けて模様をその時点で固定する。
const SETTLE_MS = 5000;
let lastTime = performance.now();
let lastActivity = performance.now();
let seeded = false;
function markActivity () { lastActivity = performance.now(); }

function frame (now) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;
  if (!paused) {
    fluid.resize();
    if (!seeded && canvas.width > 0) {
      seeded = true;
      seedDemo();
    }
    // 最後の操作から SETTLE_MS の間だけ流体を進める。指で操作中は
    // updateDrops / pointermove が markActivity を呼ぶので動き続ける。
    // pointers.size に依存させないのは、タッチ端末で pointerup を取りこぼして
    // 幽霊ポインタが残ると凍結できず、放置で模様が縞状に劣化するため。
    if (now - lastActivity < SETTLE_MS) {
      updateDrops(now);
      fluid.step(dt > 0 ? dt : 1 / 60);
    }
    fluid.render();
  }
  audio.tick();
  requestAnimationFrame(frame);
}

// ---------- さいしょのおてほん (中央にしずく三輪) ----------

function seedDemo () {
  // 本物と同じ手順: 同じ場所に すみ と みず を交互に落とすと輪ができる
  const cx = 0.5;
  const cy = 0.55;
  for (let i = 0; i < 7; i++) {
    fluid.splatDrop(cx, cy, 0.04, i % 2 === 0 ? INKS.sumi : CLEAR);
  }
}

// ---------- UI ----------

const hint = document.getElementById('hint');
let hintHidden = false;
function hideHint () {
  if (hintHidden) return;
  hintHidden = true;
  hint.classList.add('hidden');
}

document.querySelectorAll('[data-ink]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentInk = btn.dataset.ink;
    document.querySelectorAll('[data-ink]').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentTool = btn.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

const soundBtn = document.getElementById('btn-sound');
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.classList.toggle('muted', !soundOn);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  fluid.reset();
  audio.plip(400, 0.12);
});

// ---------- かみにうつす ----------

const wipe = document.getElementById('paper-wipe');
const modal = document.getElementById('print-modal');
const printImg = document.getElementById('print-img');
let printCanvas = null;

document.getElementById('btn-paper').addEventListener('click', () => {
  if (paused) return;
  paused = true;
  pointers.clear();
  wipe.classList.add('sweep');
  setTimeout(() => {
    printCanvas = fluid.renderPrint();
    printImg.src = printCanvas.toDataURL('image/png');
    modal.classList.add('open');
    wipe.classList.remove('sweep');
    audio.plip(360, 0.15);
  }, 750);
});

document.getElementById('btn-back').addEventListener('click', () => {
  modal.classList.remove('open');
  // 本物の墨流しと同じく、紙が模様を吸い取って水面はきれいになる
  fluid.reset();
  paused = false;
  lastTime = performance.now();
});

// もどる: 紙にうつすのをやめて、模様をそのままに水面へ戻る
document.getElementById('btn-cancel').addEventListener('click', () => {
  modal.classList.remove('open');
  paused = false;
  lastTime = performance.now();
});

document.getElementById('btn-save').addEventListener('click', async () => {
  if (!printCanvas) return;
  const blob = await new Promise((res) => printCanvas.toBlob(res, 'image/png'));
  if (!blob) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = new File([blob], `suminagashi-${stamp}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ---------- 開始 ----------

requestAnimationFrame(frame);
