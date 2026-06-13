# みえない うごきが みえるカメラ

## 概要
カメラを向けると、世界の「動きだけ」が見えるふしぎなカメラ。じっとしている自分の体から心臓の鼓動が波になって見えたり、止まって見える木が実はゆらゆら呼吸していたり。動きを何十倍にも拡大する「おおげさモード」では、友だちのまばたきが大地震みたいに見える。

## Concept (EN)
A motion-extraction / motion-magnification camera (Posy-style motion extraction + a lightweight Eulerian video magnification). Mode A "motion only": everything static fades to gray, any movement glows — waving a hand paints ghostly trails, a breathing chest pulses. Mode B "exaggerate": tiny motions are amplified ×20–50, so your pulse visibly throbs in your face and a 'still' tree sways like a storm. Pure shader work on the camera feed, no ML, no server.

## Tech
- Mode A (motion extraction, cheap & robust): keep a short ring buffer of past frames as textures; output = `0.5 + (current − frame[t−Δ]) * gain`. Δ controlled by a slider (small Δ = fast motions, large Δ = slow drifts). Inverted-delayed-frame blend gives the classic "everything still cancels to gray" look.
- Mode B (Eulerian magnification, simplified): build a 3–4 level Gaussian pyramid of the luma in WebGL (successive downsample FBOs). Per level, run a temporal IIR bandpass per pixel: two exponential moving averages with different time constants, `band = ema_fast − ema_slow` (stores 2 floats/pixel in a ping-pong FBO). Amplify `band * alpha` and add back during pyramid collapse. Choose the band ~0.7–2.5 Hz for heartbeat (color magnification on the chroma channel), ~0.2–1 Hz for breathing/swaying.
- All passes are fullscreen quads; three.js optional (raw WebGL2 or three's `WebGLRenderTarget` ping-pong both fine). 60fps easily at 720p on a phone.

## Implementation sketch
1. Camera → texture; implement Mode A first (one shader, one history texture). Already a shippable toy.
2. Add the frame ring buffer (e.g. 32 frames at 1/4 res) with a Δ slider — sliding it sweeps through "what speed of motion do you want to see".
3. Mode B: pyramid down/up passes; IIR bandpass pass; amplification slider. Clamp output to avoid blowup; denoise by zeroing band values below a threshold (camera noise floor).
4. Heartbeat preset: chrominance-only amplification at 0.8–3 Hz + face-sized vignette; prompt "stay still 5 seconds" then reveal.
5. UX: side-by-side split (raw | magnified) sells the magic; record 5s WebM clips via `MediaRecorder` for sharing.

## Pitfalls
- Phone shake destroys both modes → detect via accelerometer and show "place me on the table / lean me against a cup" coaching.
- Auto-exposure pulsing creates fake global motion → request `exposureMode: 'manual'` if supported, else subtract the per-frame mean.
- Heartbeat works best on bright, evenly lit faces; manage expectations with a fun "measuring..." animation.

## Why it surprises
It reveals something true and invisible about the real world — not a graphic effect, but your actual pulse, the building's actual sway. "The camera that sees the invisible" feels like a superpower, and adults are as hooked as kids because they don't believe it until they cover their wrist and the throbbing stops.
