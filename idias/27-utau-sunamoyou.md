# うたうと うかぶ すなもよう

## 概要
画面の中の鉄板に砂がまかれている。スマホに向かって「あーーー」と声を出すと、声の高さに応じて砂がスルスルと動き出し、幾何学模様(クラドニ図形)を描く。声を高くしたり低くしたりすると模様が生き物のように変形していく。実験室でしか見られない「音のかたち」を、自分の声で描けるおもちゃ。

## Concept (EN)
A virtual Chladni plate. Sing or hum and the sand on a vibrating plate migrates to the nodal lines of the plate's standing waves, drawing the famous symmetric figures. Sweep your pitch and the pattern continuously morphs through the mode shapes — circles bloom into stars into lattices. Cymatics made personal: your voice literally has a shape.

## Tech
- Pitch detection: autocorrelation (or McLeod/YIN) on `AnalyserNode` time-domain data — 20 lines of JS, robust for sustained vowels. Amplitude from RMS.
- Plate model: square plate standing wave `u(x,y) = cos(nπx)cos(mπy) − cos(mπx)cos(nπy)` (and the `+` variant). Map frequency → a continuous path through (m,n) mode space; interpolate between adjacent integer modes so patterns morph smoothly instead of snapping. Also offer a circular plate using `J_n(k r)·cos(nθ)` Bessel modes for rounder figures.
- Particles: GPGPU, 100–300k grains as a position texture (three.js ping-pong FBO). Velocity = `−∇|u|² · drive + jitter·amplitude` — grains random-walk when the plate is loud and settle on nodal lines (|u| ≈ 0), exactly like real sand. ∇ computed analytically in the shader (no texture lookups needed).
- Render: additive points with soft sprite, slight warm color by grain speed; plate as a dark brushed-metal quad.

## Implementation sketch
1. Static version first: a slider sets (m,n), grains settle into the pattern. This validates the particle dynamics (the toy's core feel).
2. Hook up mic → pitch → mode path. Map e.g. 80–800 Hz logarithmically onto a 1D parameter `t`, and (m,n) = a zigzag walk through mode space so neighboring pitches give related shapes.
3. Amplitude → jitter strength: silence freezes the sand mid-pattern (you can "catch" a shape by going quiet — great game mechanic).
4. Tap to pour more sand (splat grains at touch); shake (accelerometer) to scatter everything.
5. Modes: voice / slider / music (FFT dominant-bin follows a song). Photo export of caught patterns onto a virtual postcard.
6. Stretch: two-voice mode — second detected pitch (from FFT peaks) superimposes a second mode, interference patterns.

## Pitfalls
- Pitch detectors stutter on breathy onsets → median-filter over 5 frames and gate by RMS.
- Grains must not all collapse to identical points: keep per-grain noise seed and finite settle speed so lines stay fuzzy and sandy.

## Why it surprises
Chladni figures look like magic even in physics class — and here the magic answers *your* voice. The feedback loop (sing higher… the star grows another point!) is instantly understood by a 4-year-old and quietly teaches wave physics. Catching a pattern by going silent makes it a game.
