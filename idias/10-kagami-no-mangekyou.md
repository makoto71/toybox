# かがみの まんげきょう

## 概要
カメラに映る自分や部屋の風景が、巨大な万華鏡の模様になる。手を叩くと模様のパターンが切り替わり、動くたびに世界が花のように開いては閉じる。自分自身が万華鏡の中身になるメディアアート。

## Concept (EN)
You are the glass beads inside a kaleidoscope. The live camera feed is fed through a GPU kaleidoscope shader (N-fold mirror symmetry, default 8). Your movements bloom into mandala patterns in real time. Hand tracking adds control without UI: clap = randomize segment count & rotation speed; spread both hands apart = zoom the mirror cell; raise one hand = hue rotation. A slow auto-drift keeps it mesmerizing even when idle.

## Tech
- WebGL fragment shader: polar-coordinate fold — `a = mod(atan(p.y,p.x), 2π/N); a = abs(a - π/N);` then sample the camera texture. ~30 lines, runs at 60fps anywhere
- Feedback buffer (previous frame slightly zoomed/rotated, mixed at 5–10%) for infinite-tunnel trails — this is what elevates it from filter to art
- MediaPipe Hands for the 3 gesture controls; clap = both wrists' distance dips below threshold quickly
- Optional Web Audio reactive mode: mic volume modulates fold count smoothly

## Implementation sketch
1. Fullscreen quad, camera texture, kaleidoscope fold shader with uniforms {segments, rotation, zoom, hueShift}.
2. Add feedback pass (ping-pong framebuffers). Tune decay so trails feel like flowing ink, not smear.
3. Gesture layer: clap/spread/raise mappings; show a 2s hint overlay on start, then no UI at all.
4. Screenshot button (long-press anywhere) saves the current mandala as PNG.
5. Stretch: "object mode" — point the rear camera at toys/flowers; preset moods (ice / fire / ukiyo-e color grading via LUT).

## Why it surprises
Cheapest implementation in this list, biggest visual payoff per line of code. People instinctively start dancing in front of it.
