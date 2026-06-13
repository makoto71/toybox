# ピクセルのむれ

## 概要
カメラに映る自分の姿が、何万匹もの小さな光の粒(むれ)でできている鏡。手を近づけると粒たちが魚の群れのように逃げ、じっとしていると戻ってきて自分の姿を組み立て直す。「壊せるけど、また戻る」インタラクティブミラー。

## Concept (EN)
A mirror made of 100k+ particles. Each particle's "home" is a pixel of the live camera feed (position + color). Your hand acts as a predator: particles within reach flee with boids-like panic, then ease back home when the threat leaves. Clapping (mic transient) scatters the whole image like startled birds.

## Tech
- GPGPU particle sim in three.js (ping-pong FBOs or WebGL2 transform feedback): state = position + velocity
- Forces: spring toward home pixel, repulsion from hand position(s), slight curl-noise drift, damping
- Hand position: MediaPipe Hands (just the wrist/index landmark — cheap), or even simpler: frame-difference motion map as a repulsion texture (zero ML)
- Particle color sampled live from the video texture at the home UV → the "mirror" updates even while swarming

## Implementation sketch
1. Init particles on a grid matching a downscaled video (e.g. 480×270 ≈ 130k particles).
2. Sim shader: `vel += spring(home - pos) + flee(hand) + curlNoise(pos)`; render as round points with additive glow.
3. Motion-map variant: `abs(frame - prevFrame)` blurred → repulsion field. Works with full body, no tracking library.
4. Mic `AnalyserNode`: loud transient → global explosion impulse; silence → particles settle into a crisp portrait.
5. Modes: fish school / fireflies / snow (different force tuning + sprite).

## Why it surprises
You can't touch yourself — your own image flees from your hand. The moment of stillness when the portrait reassembles feels magical.
