# こおりのまど

## 概要
画面全体が凍った窓ガラスになる。指でこすると氷が溶けて向こう側(カメラの景色や隠し絵)が見え、ハーッと息を吹きかける(マイク)と白く曇る。放っておくとまたゆっくり凍っていく。冬の窓あそびをいつでもどこでも。

## Concept (EN)
A frosted-glass window simulation. A "frost map" covers the screen; rubbing with a finger melts it (revealing the back layer — live camera, a hidden picture, or a tiny animated scene), blowing into the mic fogs it up again, and frost slowly regrows from the edges with realistic dendrite patterns. You can also draw in the fog and your doodle stays as a melt-line.

## Tech
- Frost state in a ping-pong FBO (R channel = ice thickness): touch brush subtracts, breath (mic low-frequency RMS burst) adds fog, slow reaction-diffusion-style regrowth biased by a precomputed dendrite noise texture
- Display shader: back layer distorted by frost-thickness-based refraction (normal from gradient of frost map), blur + whitening proportional to thickness, sparkle highlights
- Back layer options: `getUserMedia` camera, or a procedural three.js micro-scene (falling snow village) for a no-permission mode

## Implementation sketch
1. Generate dendrite/crystal growth texture offline-style at load (DLA-ish noise or layered Voronoi).
2. Sim pass each frame: `ice += regrowth * dendriteMask - touchBrush - age(meltLines)`; fog from breath decays into ice.
3. Render pass: refract+blur back layer by `ice`, add crystalline glints at high-gradient edges.
4. Breath detection: RMS spike in low band ≈ wind noise on mic — same trick as existing idea 07, ~20 lines.
5. Hidden-picture mode: melt to reveal one of the user's own oekaki drawings.

## Why it surprises
Tactile and nostalgic — everyone immediately writes their name. The regrowing frost erasing your writing gives it a gentle, ephemeral art feeling.
