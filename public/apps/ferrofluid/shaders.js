// ===========================================================================
//  shaders.js  —  すべての GLSL ソース (WebGL2 / GLSL ES 3.00)
// ===========================================================================

// 全パス共通の頂点シェーダ。フルスクリーン三角形を描く。
export const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
//  磁場パス
//  画面に「磁石(指)の影響度」を貯める単一チャンネルのフィールド。
//  毎フレーム少し減衰させ、指の位置にガウシアンを足し、軽くぼかす。
// ---------------------------------------------------------------------------
export const FIELD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uPrev;      // 前フレームのフィールド
uniform vec2  uTexel;         // 1.0 / フィールド解像度
uniform float uDecay;         // 減衰率 (0.85 など)
uniform float uMic;           // マイク低域エネルギー (0..1)
uniform float uTime;

#define MAX_POKES 10
uniform int   uPokeCount;
uniform vec4  uPokes[MAX_POKES]; // xy = uv, z = 強さ, w = 半径

void main() {
  // --- 近傍 5 タップで軽く拡散させる (磁場をなめらかに) ---
  float c = texture(uPrev, vUv).r;
  float n = texture(uPrev, vUv + vec2(0.0,  uTexel.y)).r;
  float s = texture(uPrev, vUv + vec2(0.0, -uTexel.y)).r;
  float e = texture(uPrev, vUv + vec2( uTexel.x, 0.0)).r;
  float w = texture(uPrev, vUv + vec2(-uTexel.x, 0.0)).r;
  float blurred = mix(c, (n + s + e + w) * 0.25, 0.18);

  float v = blurred * uDecay;

  // --- 指のガウシアンを加算 ---
  for (int i = 0; i < MAX_POKES; i++) {
    if (i >= uPokeCount) break;
    vec4 p = uPokes[i];
    float d = distance(vUv, p.xy);
    float g = exp(-(d * d) / (p.w * p.w));
    v += g * p.z;
  }

  // --- マイクで全体を底上げ (任意) ---
  v += uMic * 0.45;

  frag = vec4(clamp(v, 0.0, 1.6), 0.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
//  描画パス
//  磁場フィールドから高さ場を作り、視線レイをマーチして磁性流体を描く。
//  真っ黒で艶のある金属的な流体 + スタジオ環境反射。
// ---------------------------------------------------------------------------
export const RENDER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform vec2  uRes;
uniform float uTime;
uniform sampler2D uField;
uniform int   uSteps;        // レイマーチ最大ステップ
uniform vec3  uTint;         // 流体の色味 (黒/金/虹)
uniform float uIridescence;  // 虹色の強さ

const float SQRT3 = 1.7320508;

// ---- ハッシュ (スパイクごとのゆらぎ用) --------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// ---- フィールド取得 (pool 座標 g[-1,1] -> uv) -------------------------------
float fieldAt(vec2 g) {
  return texture(uField, g * 0.5 + 0.5).r;
}

// ---- 三角格子(=六方最密)の最寄りノードまでの距離と中心を返す --------------
//  spacing s の格子。各ノードは少し揺らがせて自然なスパイク配置にする。
float hexNearest(vec2 p, float s, out vec2 center) {
  // 基底ベクトル a=(s,0), b=(0.5s, (sqrt3/2)s) の逆行列で格子座標へ。
  // GLSL の mat2 は列優先なので、論理行列 (1/s)[[1,-1/√3],[0,2/√3]] は
  // mat2(列0=(1,0), 列1=(-1/√3,2/√3)) で表す。
  mat2 inv = (1.0 / s) * mat2(1.0, 0.0, -1.0 / SQRT3, 2.0 / SQRT3);
  vec2 lc = inv * p;
  // 60°斜交格子では最寄りノードが斜め隣のこともあるので、丸めた点の周囲3x3を探索
  vec2 nb = floor(lc + 0.5);
  float best = 1e9;
  center = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 node = nb + vec2(float(i), float(j));
      // 格子座標 -> ワールド
      vec2 wc = node.x * vec2(s, 0.0) + node.y * vec2(0.5 * s, 0.5 * SQRT3 * s);
      // ノードごとのゆらぎ
      vec2 jit = (vec2(hash21(node), hash21(node + 7.1)) - 0.5) * s * 0.34;
      wc += jit;
      float d = distance(p, wc);
      if (d < best) { best = d; center = wc; }
    }
  }
  return best;
}

// ---- 高さ場 H(g) -----------------------------------------------------------
//  pool 中心の流体プール + 磁場に応じて立ち上がるスパイク群。
float heightAt(vec2 g) {
  float r = length(g);
  float poolMask = smoothstep(1.04, 0.86, r); // 内側1, 外側0
  float field = fieldAt(g);

  float dish = -0.18;                           // 皿の底
  // 流体プール: 磁場で中央が盛り上がる
  float puddle = 0.015 + field * 0.12;
  float base = mix(dish, puddle, poolMask);

  // スパイク: 磁場が強いほど間隔が詰まり、背が高くなる
  float s = mix(0.165, 0.105, clamp(field, 0.0, 1.0));
  vec2 center;
  float d = hexNearest(g, s, center);
  float fc = fieldAt(center);                   // スパイク中心の磁場
  float rnd = hash21(center * 13.7);
  float amp = smoothstep(0.04, 0.55, fc) * (0.30 + 0.30 * rnd);
  // とがった円錐プロファイル
  float prof = max(0.0, 1.0 - d / (s * 0.60));
  prof = pow(prof, 1.7);
  // ほんのり呼吸 (待機中も生きて見える)
  amp *= 1.0 + 0.05 * sin(uTime * 2.0 + rnd * 6.28);

  float spikes = amp * prof * poolMask;
  return base + spikes;
}

// ---- 法線 (有限差分) -------------------------------------------------------
vec3 normalAt(vec2 g, float e) {
  float hx = heightAt(g + vec2(e, 0.0)) - heightAt(g - vec2(e, 0.0));
  float hy = heightAt(g + vec2(0.0, e)) - heightAt(g - vec2(0.0, e));
  return normalize(vec3(-hx, -hy, 2.0 * e));
}

// ---- スタジオ環境 ----------------------------------------------------------
//  黒クロームに映り込む光。横に走るソフトボックスのバーが「艶」を作る。
vec3 envColor(vec3 d) {
  float up = clamp(d.z * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.015, 0.018, 0.028), vec3(0.10, 0.13, 0.19), up);

  // 上方の大きなソフトボックス
  float top = smoothstep(0.55, 1.0, d.z);
  sky += vec3(0.9, 0.93, 1.0) * pow(top, 3.0) * 0.9;

  // 水平に走る2本のライトバー (映り込みの筋)
  float az = atan(d.y, d.x);
  float bar1 = smoothstep(0.16, 0.0, abs(d.z - 0.22)) * (0.5 + 0.5 * cos(az * 1.0));
  float bar2 = smoothstep(0.10, 0.0, abs(d.z - 0.62));
  sky += vec3(1.0, 0.97, 0.92) * bar1 * 0.55;
  sky += vec3(0.85, 0.9, 1.0) * bar2 * 0.7;

  // 低い位置の暖色のアクセント
  float warm = smoothstep(0.0, -0.4, d.z) * smoothstep(0.4, 1.0, d.x * 0.5 + 0.5);
  sky += vec3(0.5, 0.28, 0.12) * warm * 0.4;

  return sky;
}

// ---- 薄膜干渉風の虹色 ------------------------------------------------------
vec3 iridescent(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;

  // カメラ: 斜め上から皿を見下ろす
  vec3 camPos = vec3(0.0, -2.55, 2.05);
  vec3 target = vec3(0.0, 0.05, 0.05);
  vec3 fwd = normalize(target - camPos);
  vec3 right = normalize(cross(fwd, vec3(0.0, 0.0, 1.0)));
  vec3 upv = cross(right, fwd);
  vec3 dir = normalize(fwd * 1.7 + right * uv.x + upv * uv.y);

  // ---- 高さ場レイマーチ (z = H(xy)) ----
  // レイは下降していく。pos.z が surface を下回った瞬間が交点。
  float t = 0.0;
  float tmax = 8.0;
  bool hit = false;
  vec3 pos = camPos;
  float prevDiff = camPos.z - heightAt(camPos.xy);

  // 平面 z=dish までの距離で初期 t をざっくり前進 (空打ち削減)
  if (dir.z < -0.001) {
    // スパイク最大高さ(約0.8)より上から開始すると先端が削れる。余裕をみて0.95。
    float tPlane = (camPos.z - 0.95) / -dir.z;
    t = max(0.0, tPlane);
  }

  float dt = tmax / float(uSteps);
  float hitT = tmax;
  for (int i = 0; i < 256; i++) {
    if (i >= uSteps) break;
    pos = camPos + dir * t;
    if (abs(pos.x) > 1.6 || pos.y > 1.4) { t += dt; continue; }
    float h = heightAt(pos.xy);
    float diff = pos.z - h;
    if (diff < 0.0) {
      // 直前ステップとの線形補間で交点を精緻化
      float t0 = t - dt;
      float blend = prevDiff / (prevDiff - diff);
      hitT = mix(t0, t, clamp(blend, 0.0, 1.0));
      hit = true;
      break;
    }
    prevDiff = diff;
    t += dt;
  }

  vec3 col;
  if (hit) {
    vec3 p = camPos + dir * hitT;
    vec3 N = normalAt(p.xy, 0.0035);
    vec3 V = normalize(camPos - p);
    vec3 R = reflect(-V, N);

    vec3 env = envColor(R);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);

    // 黒クローム: 反射が支配的、地色はほぼ黒
    col = uTint * 0.02;
    col += env * 0.9;
    col += fres * vec3(0.85, 0.9, 1.0) * 0.8;

    // キーライトの鋭いハイライト
    vec3 L = normalize(vec3(0.35, -0.2, 0.95));
    float spec = pow(max(dot(R, L), 0.0), 220.0);
    col += spec * vec3(1.0);

    // 谷間の擬似AO (高さが低いほど暗く)
    float ao = smoothstep(-0.2, 0.25, p.z);
    col *= 0.35 + 0.65 * ao;

    // 虹色モード
    if (uIridescence > 0.0) {
      float ang = fres + p.z * 0.5 + dot(N, V) * 0.5;
      col = mix(col, col * iridescent(ang) * 2.2, uIridescence);
    }
    // 金モード等の色味
    col *= mix(vec3(1.0), uTint, 0.5);
  } else {
    // 背景: スタジオ幕
    col = envColor(dir) * 0.6;
    col = mix(col, vec3(0.01, 0.012, 0.02), 0.3);
  }

  // トーンマップ + ビネット
  col = col / (col + 0.7);
  col = pow(col, vec3(0.85));
  float vig = 1.0 - 0.35 * dot(uv, uv);
  col *= clamp(vig, 0.0, 1.0);

  frag = vec4(col, 1.0);
}`;
