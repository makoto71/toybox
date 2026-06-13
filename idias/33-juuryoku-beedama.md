# じゅうりょく ビーだま

## 概要
まっくらな宇宙に、光るビー玉(惑星)をピンッとはじいて放りこむ。まんなかの太陽のまわりをくるくる回ったり、すっとんでいったり、二つの玉が出会ってダンスしたり。玉どうしがぶつかると合体して大きくなり、軌道は光の糸になって残るので、遊んだあとには美しい軌道のレース模様ができあがる。重力だけでできた、宇宙のおはじき。

## Concept (EN)
An N-body gravity marble sandbox. Flick glowing marbles into space around a sun; real gravitational dynamics produce ellipses, slingshots, binary waltzes, and chaotic three-body scrambles. Collisions merge bodies (mass and momentum conserved, radius ∝ m^⅓). Orbits leave persistent light-trails, so play accretes into generative art — a lace of physics. No camera, no mic, no instructions needed: flicking is the whole interface.

## Tech
- Physics: direct-sum N-body (n ≤ ~200, O(n²) is trivial) with Plummer softening `F = G·m₁m₂·r/(|r|²+ε²)^{3/2}` to avoid singular slingshots; integrate with velocity Verlet / semi-implicit Euler at fixed dt with substeps (4–8/frame) for orbit stability. 2D plane by default (readability for kids), optional shallow 3D tilt for parallax beauty.
- Trails: render bodies into an accumulation FBO that fades by ~0.5%/frame (multiply by 0.995) — classic persistence buffer; bodies themselves drawn on top as instanced sprites with bloom (UnrealBloomPass or a cheap dual-Kawase blur).
- Input: drag from a body-spawn = position + release velocity vector (slingshot UI with predicted-path preview: integrate a ghost trajectory 500 steps ahead each frame during drag — *this preview is the secret sauce*, it teaches orbital mechanics wordlessly).
- Merging: on overlap, combine into one body conserving momentum; spawn a ring-shockwave particle burst + a thump (Web Audio noise burst through lowpass, pitch ∝ 1/mass).
- Sonification: each body emits a soft sine drone, pitch from orbital energy, volume from proximity to the sun — stable systems literally hum chords; chaos sounds anxious. (Pentatonic-quantize toggle.)
- Presets: binary stars, figure-8 (the famous choreography initial conditions), Trojan points demo, "asteroid rain". Time controls: pinch = zoom, two-finger twist = slow-mo/fast-forward (dt scale).

## Implementation sketch
1. Sun + flick-spawn + Verlet + trails. Already fun in an afternoon.
2. Trajectory preview during drag (re-simulate ghost each frame from current world state — must include other bodies for honesty).
3. Merging + audio thumps; drone sonification.
4. Presets menu as little constellation cards; "save my universe" = serialize body states to localStorage; photo export of the trail buffer (it's genuinely frameable).
5. Stretch: "rocket mode" — one marble is yours, tap to thrust, try to achieve orbit (the Kerbal seed); negative-mass weirdball as a hidden toy.

## Pitfalls
- Energy drift makes orbits spiral over minutes → fixed dt + Verlet keeps it bounded; renormalize total momentum occasionally so the system doesn't drift offscreen (or recenter camera on barycenter).
- Too many bodies → merge aggressively, cap n, and cull escapees beyond 10× view radius.

## Why it surprises
The flick-to-orbit moment — when a marble you threw *comes back around* — is a genuine physical epiphany; most adults have never felt orbital mechanics in their hands. The trail lace means every session ends with an artwork, and the humming-chord sonification makes a stable solar system feel like an achievement you can hear.
