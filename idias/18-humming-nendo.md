# ハミングねんど

## 概要
「ん〜〜♪」とハミングすると、ろくろの上の粘土が声に合わせて形を変えていく。高い声でくびれ、低い声でふくらみ、声の大きさで太さが変わる。歌い終わると、自分の声の形をした壺や彫刻が完成。声を3Dの「もの」に変える音声彫刻おもちゃ。

## Concept (EN)
Voice pottery. A lathe (rotational solid) spins on screen; while you hum, the profile curve is extruded upward over time — pitch maps to radius modulation, volume to overall thickness, vibrato adds ripples. When you stop, the vessel is complete: your melody frozen as a 3D object. Gallery saves past sculptures; tapping one plays back the original hum (the shape IS the recording).

## Tech
- Web Audio: pitch via autocorrelation, RMS volume, ~30 samples/sec appended to a profile array
- three.js `LatheGeometry` rebuilt incrementally (or a custom cylinder whose ring radii update in the vertex buffer — cheap)
- Material: clay → glaze shader (matcap is enough); slow turntable rotation
- Playback: stored pitch/volume arrays → `OscillatorNode` resynthesis; localStorage gallery (profile arrays are tiny)

## Implementation sketch
1. Capture loop: silence-gated; while voiced, push `(radius = f(pitch), thickness = f(rms))` to profile.
2. Rebuild lathe every few frames during creation; final smoothing pass (Catmull-Rom) on completion.
3. Firing animation: clay color → chosen glaze with a glow, confetti, name your piece.
4. Gallery shelf scene; tap = spin + resynthesized hum playback (shape-to-sound round trip).
5. Stretch: two-person mode — one person makes the body, the second hum carves a spiral texture into the surface.

## Why it surprises
Your voice becomes a permanent physical-looking object — and the object can sing the voice back. The bidirectional mapping (sound↔shape) is genuinely media-art-grade.
