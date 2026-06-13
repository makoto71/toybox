# おとで みえる せかい

## 概要
画面は真っ暗。手をたたくと、音の波紋が光になって広がり、暗闇の中に隠れた世界(森、街、海の底)が一瞬照らし出される。コウモリやイルカの「エコーロケーション」を体験するおもちゃ。大きい音は遠くまで、小さい音はすぐそばだけ。

## Concept (EN)
Echolocation as a visual. A 3D scene exists in total darkness. A clap / shout / tap emits an expanding spherical wavefront from the listener; surfaces light up only where the wavefront passes, with brightness from sound loudness, then fade back to black. Continuous humming creates a sustained shimmer near you. Hidden creatures' eyes glint just outside the lit shell, inviting another clap.

## Tech
- three.js scene + custom material (or onBeforeCompile injection): emissive term = `pulse(dist(worldPos, origin) - waveRadius(t))`, supporting ~4 simultaneous wavefronts via uniform array
- Mic: `AnalyserNode` RMS; transient detection (delta over threshold) → spawn wave with radius speed and max range proportional to loudness
- Scene: low-poly environment; creatures as simple animated meshes that relocate while unlit
- No camera needed — mic only

## Implementation sketch
1. Wave uniforms: `vec4 waves[4]` = (origin.xyz unused → use camera origin, startTime, amplitude); shader band-pass on distance.
2. Transient detector: RMS jump > threshold with 150ms refractory → push wave.
3. Edge highlight: light surfaces by `dot(normal, dirToOrigin)` so the wave reads as illumination, plus a thin bright rim at the wavefront.
4. Gameplay-lite: find all 5 hidden animals; each found animal sings back (Web Audio synth echo).
5. Tap-to-clap fallback for quiet environments / no mic permission.

## Why it surprises
Inverts the usual rule — sound becomes the only light source. The 2 seconds of darkness after each clap create real suspense, and kids spontaneously start experimenting with whispers vs. shouts.
