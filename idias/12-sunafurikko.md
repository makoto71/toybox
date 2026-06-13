# じぶんが ふる すなあらし

## 概要
カメラに映った自分の体のシルエットが、何万粒もの光る砂粒でできていて、動くと砂が舞い散り、止まるとまた集まって自分の形に戻る。体が粒子でできているような感覚になる、王道だけど確実に驚くパーティクルアート。

## Concept (EN)
Your body, made of 100k particles. MediaPipe Selfie Segmentation extracts your silhouette each frame; GPU particles are attracted to points inside the mask (colored by the camera pixel underneath, so the particle cloud is a pointillist live portrait). Move fast and particles can't keep up — they scatter with turbulence and slowly re-converge when you stop. Clap (audio spike) to explode the whole cloud; it reassembles into you over 3 seconds.

## Tech
- MediaPipe Selfie Segmentation (or Pose for a cheaper skeleton-attractor variant)
- GPGPU particles in three.js: position/velocity in float textures, updated by a simulation fragment shader (`GPUComputationRenderer`); 100k+ particles fine on most devices, fallback to 20k
- Attractor field: each particle has a home UV; steering force toward home if mask(homeUV)==1, else find nearest valid (cheap: random re-home a few % of orphans per frame)
- Curl noise turbulence scaled by inverse "calmness"; audio spike detector for the clap-explosion

## Implementation sketch
1. GPGPU scaffold: ping-pong position/velocity textures, point sprites colored by camera texture at home UV.
2. Segmentation mask → data texture each frame; spring force toward home when home is inside mask.
3. Velocity-based scatter: per-frame mask diff (movement amount) injects turbulence locally.
4. Clap: radial impulse from body center; gravity-off drift; 3s re-convergence with ease-in.
5. Stretch: material presets (gold dust, snow, cherry petals — petals are textured quads with rotation); slow-mo button.

## Why it surprises
Seeing yourself as a living sand sculpture taps something primal. The clap-explode-reassemble loop never gets old.
