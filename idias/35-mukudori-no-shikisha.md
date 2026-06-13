# むくどりの むれを あやつる しきしゃ

## 概要
夕ぐれの空いっぱいに、何千羽ものムクドリの大群がうねうねと形を変えながら飛んでいる(本物の鳥の群れと同じアルゴリズム)。カメラの前で手をかざすと群れが手のひらに吸いよせられ、グーをにぎると天敵が来たように群れがパッと爆発四散。両手を広げれば群れが二つに割れる。指揮者のように腕を振って、空に生きた墨絵を描くおもちゃ。

## Concept (EN)
Conduct a starling murmuration. Thousands of boids swirl over a dusk skyline, obeying the real flocking rules (separation / alignment / cohesion) that produce those liquid, shape-shifting clouds. Your hands, tracked by the camera, become forces of nature: open palm attracts the flock; a closed fist is a falcon — the murmuration detonates away from it; two hands tear the flock in half; sweeping gestures send waves rippling through thousands of wings. You're not controlling birds, you're *perturbing an organism*, which is why it feels alive.

## Tech
- Flock: boids with the three classic rules + soft world bounds + a mild wind field. Two implementation tiers:
  - CPU tier: 2,000–4,000 boids with a uniform spatial hash grid (neighbor radius ~2 cells), SoA Float32Arrays, integrate in a worker if needed. Plenty for the visual.
  - GPU tier (stretch): GPGPU position/velocity textures (three.js `GPUComputationRenderer`), 65k boids; neighbor search via a coarse force-field texture (splat flock density+velocity, sample it) — approximate but indistinguishable at murmuration scale.
- Render: `InstancedMesh` of a 2-triangle "bird" with a vertex-shader wing flap (phase from instance id + speed); color = near-black against a gradient dusk sky with a distant city silhouette; slight motion blur via accumulation buffer at 10% for the silky look.
- Hands: MediaPipe Hand Landmarker, `VIDEO` mode. Palm-open vs fist from landmark geometry (fingertip-to-palm distances). Map hand position (mirrored) into world space at the flock's depth plane. Forces: open palm = attractor spring (capped); fist = strong short-range repulsor + a "panic" scalar that temporarily boosts every boid's max speed and noise (this is what makes the explosion look like fear, not physics); hand velocity injects momentum (conducting sweeps).
- Sound: flock = filtered noise whose volume/brightness follows local density and average speed (wing-whoosh); panic adds a chirp scatter (granular bursts). Evening crickets bed underneath.
- Fallback: pointer/touch = palm; long-press = falcon. (Toy fully playable without camera.)

## Implementation sketch
1. CPU boids + instanced rendering + dusk scene; tune the three rule weights until idle motion alone is hypnotic (it must demo well with zero input).
2. Pointer attractor/repulsor forces + the panic scalar; juice the explosion (sound, brief slow-mo).
3. MediaPipe hands → palm/fist classification → forces; smooth with One-Euro filter.
4. Two-hand split behavior falls out of two attractors automatically — verify, then tune.
5. Roost ending: after N minutes idle, flock spirals into a tree and settles, chirping — a natural "session end" with a screenshot prompt.
6. Stretch: GPU tier; "draw a shape and the flock fills it" mode (SDF of a doodle as a weak attractor field).

## Pitfalls
- Boids collapsing into a blob or dispersing = bad tuning → normalize forces, cap accelerations, keep cohesion weakest of the three.
- Hand jitter at distance → require minimum hand size (closeness) before forces engage; show a faint hand ghost cursor so cause/effect is legible.

## Why it surprises
Murmurations are one of nature's best free shows; people stop their cars to watch real ones. Giving a child the falcon's power — make a fist, and three thousand birds *flinch* — is an astonishing causality jump from a tiny gesture to a sky-sized reaction. Unlike a mirror toy, the flock has its own will, so it feels less like an effect and more like meeting a creature.
