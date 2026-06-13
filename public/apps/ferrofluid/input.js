// ===========================================================================
//  input.js  —  ポインタ(指/マウス)を磁場フィールドの座標へ変換する
//  描画シェーダのカメラと同じ式でレイを作り、プール面 z=0 と交差させる。
// ===========================================================================

// --- 最小限のベクトル演算 ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return scl(a, 1 / l); };

// シェーダ RENDER_FRAG と一致させること
const CAM_POS = [0.0, -2.55, 2.05];
const TARGET = [0.0, 0.05, 0.05];

function screenToPool(cssX, cssY, cssW, cssH) {
  // fragCoord 系 (y上向き) の uv へ
  const ux = (cssX * 2 - cssW) / cssH;
  const uy = (cssH - cssY * 2) / cssH;

  const fwd = norm(sub(TARGET, CAM_POS));
  const right = norm(cross(fwd, [0, 0, 1]));
  const upv = cross(right, fwd);
  const dir = norm(add(add(scl(fwd, 1.7), scl(right, ux)), scl(upv, uy)));

  // プール面 z=0 と交差
  if (Math.abs(dir[2]) < 1e-5) return null;
  const t = -CAM_POS[2] / dir[2];
  if (t < 0) return null;
  const hit = add(CAM_POS, scl(dir, t));
  // pool xy[-1,1] -> field uv[0,1]
  return { u: hit[0] * 0.5 + 0.5, v: hit[1] * 0.5 + 0.5 };
}

export function createInput(canvas) {
  const pointers = new Map(); // id -> {u,v,strength}

  function updateFromEvent(id, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const p = screenToPool(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
    if (!p) return;
    const cur = pointers.get(id) || { strength: 0 };
    cur.u = p.u;
    cur.v = p.v;
    pointers.set(id, cur);
  }

  // --- Pointer Events で統一 (マウス/タッチ/ペン) ---
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    updateFromEvent(e.pointerId, e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    updateFromEvent(e.pointerId, e.clientX, e.clientY);
  });
  const release = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  // タッチでのスクロール/ズームを抑止
  canvas.style.touchAction = 'none';

  return {
    // 毎フレーム呼ぶ: 押下中のポインタを強める(磁場が貯まる感触)
    getPokes(dt) {
      const pokes = [];
      const count = Math.max(pointers.size, 1);
      // 2本指以上は1本あたりの半径を絞り、別々の磁場に
      const radius = count >= 2 ? 0.07 : 0.09;
      for (const p of pointers.values()) {
        p.strength = Math.min(p.strength + dt * 4.5, 1.4);
        pokes.push({ u: p.u, v: p.v, strength: p.strength * 0.12, radius });
      }
      return pokes;
    },
    get active() { return pointers.size > 0; },
  };
}
