# かたむける おもちゃばこ

## 概要
スマホそのものが「小さな部屋」になる。画面の中にボールやつみき、アヒルが入っていて、スマホを傾けるとコロコロ転がり、振るとビュンビュン飛び回る。スマホを裏返すと全部天井に落ちる。端末を物理的な箱として扱う、おもちゃ箱シミュレーター。

## Concept (EN)
The phone IS a toy box. A 3D room matching the screen contains physics toys (balls, blocks, a rubber duck, jelly cubes). Device orientation rotates real gravity in the simulation; shaking applies impulses from the accelerometer; tapping pokes objects. Hold it still and everything settles with satisfying clatter sounds. Snow-globe mode: shake to fill the room with drifting snow/stars.

## Tech
- DeviceOrientation/DeviceMotion APIs (iOS needs the permission prompt) → gravity vector + shake impulses
- Physics: rapier (wasm) or cannon-es; ~30 bodies is trivial; box walls = screen-sized static colliders
- three.js: soft toy materials, contact-driven `AudioContext` sounds (impact velocity → volume/pitch of pre-baked "koto/poko" samples)
- Desktop fallback: mouse drag tilts the room

## Implementation sketch
1. Map device quaternion → world gravity (`9.8 * downVector`); low-pass to avoid jitter.
2. Shake detection: high-pass accelerometer magnitude → random impulses on all bodies + rattle sound.
3. Toy picker: add/remove toys; jelly cubes via simple vertex-shader wobble on contact (fake softbody, looks great).
4. Tap = raycast poke; long-press = pick up and drag with a spring joint.
5. Stretch: marble-run mode — tilt to guide a marble through a maze room; "fireflies" that scatter when shaken and regroup when calm.

## Why it surprises
Zero UI, 100% physical intuition — even a 1-year-old understands it instantly. Flipping the phone upside down and watching everything fall "up" is the reliable laugh moment.
