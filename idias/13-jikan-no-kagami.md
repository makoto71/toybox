# じかんのかがみ

## 概要
カメラに映る自分が、場所によって「ちょっと前の自分」になる不思議な鏡。画面の上は今、下は2秒前。手を振ると波のように動きが時間差で伝わっていく。スリットスキャンというメディアアートの古典技法をおもちゃにしたもの。

## Concept (EN)
A time-displacement mirror. The webcam feed is split into horizontal slices (or a smooth gradient), each showing a different moment from the past. Waving your arm produces a liquid, wave-like echo of yourself. Modes: vertical gradient, radial (center=now, edges=past), and "wipe" where touch position controls the time offset locally.

## Tech
- Ring buffer of the last ~120 camera frames stored in a single WebGL texture array (or one large atlas texture)
- One fragment shader: for each pixel, sample frame `N - offset(uv)` where `offset` comes from a gradient / radial function / touch-painted offset map
- No three.js needed — raw WebGL2 or a tiny fullscreen-quad helper. No tracking, no ML.

## Implementation sketch
1. `getUserMedia` → upload each frame into the next slot of a `TEXTURE_2D_ARRAY` (e.g. 120 × 640×360 ≈ fits easily in GPU memory).
2. Fragment shader picks the layer per-pixel from an offset function; lerp between adjacent layers for smoothness.
3. Touch mode: draw into an offset map (R8 texture) with a soft brush; touched areas sink deeper into the past and slowly recover.
4. Mode switch button cycles gradient / radial / touch / "scanline" (1px per frame = classic slit-scan portraits).

## Why it surprises
Everyone instinctively waves at it and gasps when their arm turns into a ribbon. Minimal code, maximal art-museum feeling.
