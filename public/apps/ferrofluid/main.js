// ===========================================================================
//  main.js  —  磁性流体おもちゃのエントリポイント
// ===========================================================================
import { VERT, FIELD_FRAG, RENDER_FRAG } from './shaders.js';
import {
  getContext, createProgram, createFullscreenTriangle, createPingPong,
} from './gl.js';
import { createInput } from './input.js';
import { createMic } from './audio.js';

const FIELD_SIZE = 256;
const DECAY = 0.90;
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const STEPS = isMobile ? 84 : 120;

// --- 色味プリセット ---
const PALETTES = [
  { name: 'ブラッククローム', tint: [0.55, 0.6, 0.72], irid: 0.0 },
  { name: 'ゴールド',         tint: [1.0, 0.78, 0.32], irid: 0.0 },
  { name: 'オイルスリック',   tint: [0.6, 0.6, 0.7],  irid: 0.85 },
  { name: 'マーキュリー',     tint: [0.9, 0.94, 1.0], irid: 0.0 },
];

const canvas = document.getElementById('c');
const gl = getContext(canvas);

const fieldProg = createProgram(gl, VERT, FIELD_FRAG);
const renderProg = createProgram(gl, VERT, RENDER_FRAG);
const quad = createFullscreenTriangle(gl);
const field = createPingPong(gl, FIELD_SIZE);
const input = createInput(canvas);
const mic = createMic();

let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 2);
  const w = Math.floor(innerWidth * dpr);
  const h = Math.floor(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
window.addEventListener('resize', resize);
resize();

// --- 待機中の自動演出: 誰も触っていないと幻の指がさまよう ---
let idleTime = 0;
const phantoms = [
  { speed: 0.21, rx: 0.55, ry: 0.4, ph: 0.0 },
  { speed: -0.16, rx: 0.4, ry: 0.55, ph: 2.1 },
];
function idlePokes(time) {
  const out = [];
  const strength = Math.min(idleTime - 1.5, 1) * 0.085;
  if (strength <= 0) return out;
  for (const p of phantoms) {
    const a = time * p.speed + p.ph;
    out.push({
      u: 0.5 + Math.cos(a) * p.rx * 0.5,
      v: 0.5 + Math.sin(a * 1.3) * p.ry * 0.5,
      strength,
      radius: 0.085,
    });
  }
  return out;
}

let palette = 0;
let last = performance.now();
let startT = last;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = (now - startT) / 1000;

  // --- 入力収集 ---
  const userPokes = input.getPokes(dt);
  idleTime = input.active ? 0 : idleTime + dt;
  const pokes = userPokes.length ? userPokes : idlePokes(time);
  const micLevel = mic.update();

  // ============ パス1: 磁場の更新 ============
  gl.bindVertexArray(quad);
  gl.useProgram(fieldProg.program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, field.write.fbo);
  gl.viewport(0, 0, FIELD_SIZE, FIELD_SIZE);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, field.read.tex);
  gl.uniform1i(fieldProg.uniforms.uPrev, 0);
  gl.uniform2f(fieldProg.uniforms.uTexel, 1 / FIELD_SIZE, 1 / FIELD_SIZE);
  gl.uniform1f(fieldProg.uniforms.uDecay, DECAY);
  gl.uniform1f(fieldProg.uniforms.uMic, micLevel);
  gl.uniform1f(fieldProg.uniforms.uTime, time);

  const n = Math.min(pokes.length, 10);
  gl.uniform1i(fieldProg.uniforms.uPokeCount, n);
  if (n > 0) {
    const arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      arr[i * 4] = pokes[i].u;
      arr[i * 4 + 1] = pokes[i].v;
      arr[i * 4 + 2] = pokes[i].strength;
      arr[i * 4 + 3] = pokes[i].radius;
    }
    gl.uniform4fv(fieldProg.uniforms.uPokes, arr);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  field.swap();

  // ============ パス2: 描画 ============
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(renderProg.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, field.read.tex);
  gl.uniform1i(renderProg.uniforms.uField, 0);
  gl.uniform2f(renderProg.uniforms.uRes, canvas.width, canvas.height);
  gl.uniform1f(renderProg.uniforms.uTime, time);
  gl.uniform1i(renderProg.uniforms.uSteps, STEPS);
  const pal = PALETTES[palette];
  gl.uniform3fv(renderProg.uniforms.uTint, pal.tint);
  gl.uniform1f(renderProg.uniforms.uIridescence, pal.irid);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// =========================================================================
//  UI 配線
// =========================================================================
const paletteBtn = document.getElementById('palette');
function refreshPaletteLabel() { paletteBtn.textContent = '◐ ' + PALETTES[palette].name; }
paletteBtn.addEventListener('click', () => {
  palette = (palette + 1) % PALETTES.length;
  refreshPaletteLabel();
});
refreshPaletteLabel();

const micBtn = document.getElementById('mic');
micBtn.addEventListener('click', async () => {
  if (mic.enabled) return;
  micBtn.textContent = '🎙 …';
  const ok = await mic.enable();
  micBtn.textContent = ok ? '🎙 音 ON' : '🎙 不可';
  micBtn.classList.toggle('on', ok);
});

const saveBtn = document.getElementById('save');
saveBtn.addEventListener('click', () => {
  // 直近フレームを保存 (preserveDrawingBuffer 済み)
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ferrofluid-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

// ヒントを数秒で消す
const hint = document.getElementById('hint');
setTimeout(() => hint.classList.add('fade'), 4200);
canvas.addEventListener('pointerdown', () => hint.classList.add('fade'), { once: true });
