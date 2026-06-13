# いきで ふくせかい

## 概要
マイクに「ふーっ」と息を吹きかけると、画面の中のタンポポの綿毛が飛び、シャボン玉がふくらみ、風車が回る。息という最も原始的な入力で動く、静かで詩的なインタラクティブ庭園。

## Concept (EN)
A breath-controlled miniature garden. Blowing into the mic creates wind in a 3D diorama: dandelion seeds detach and drift, bubbles inflate from a wand (longer breath = bigger bubble, too long = pop), pinwheels spin, a tiny sailboat crosses a pond. Blow direction is faked by face position (MediaPipe: if your face is on the left of frame, wind blows left→right). No buttons at all — the whole UI is breath.

## Tech
- Web Audio: breath detection = high RMS in low-frequency band + high zero-crossing/noise profile (distinguishes blowing from speech fairly well; calibration screen helps)
- three.js: instanced dandelion seeds with curl-noise drift, soap-bubble shader (fresnel + thin-film interference rainbow — small shader, huge wow), cloth-less pinwheel (simple rotation)
- Optional MediaPipe Face Detection for wind origin

## Implementation sketch
1. Breath detector: bandpass 100–600Hz RMS with a noise-gate; output continuous "wind strength" 0–1, smoothed.
2. Garden scene with 3 stations (dandelion / bubbles / pinwheel+boat); camera drifts slowly between them or user swipes.
3. Dandelion: ~200 instanced seeds, each detaches when local wind exceeds its threshold; curl noise + gravity drift, respawn after 30s.
4. Bubble: sphere with thin-film fresnel shader, scale grows with cumulative breath, wobble via vertex noise, pop = particle ring + sound.
5. Stretch: seasonal scenes (snow blowing, autumn leaves); record a calm "garden cam" loop.

## Why it surprises
Blowing at a screen and having it respond breaks the touchscreen mental model completely. Gentle, beautiful, and works for toddlers.
