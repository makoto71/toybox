# のぞきこむ ふしぎなハコ

## 概要
スマホやタブレットの画面が「本物の窓」になる。顔を左右に動かすと、画面の中の小さなジオラマ(部屋・水槽・宇宙)が本当にそこにあるかのように奥が見え、のぞき込むと中の住人と目が合う。メガネも特殊デバイスも不要、フロントカメラだけで成立する裸眼ホログラム風おもちゃ。

## Concept (EN)
Head-coupled perspective (the classic "Johnny Lee Wii Remote" illusion, done with the front camera). The screen stops being a flat picture and becomes a physical window: move your head left and you see the right wall of the diorama; lean in and objects near the frame slide past with strong parallax. Some objects poke *out* of the window (negative parallax) — a butterfly seems to hover in front of the glass. No glasses, no markers, no server.

## Tech
- Face tracking: MediaPipe Face Landmarker (or the lighter Face Detector) on the front camera, ~30fps. Head position in screen space from the eye midpoint; distance estimated from interpupillary pixel distance (IPD ≈ 63 mm assumed) → full 3D eye position relative to the screen.
- Projection: generalized off-axis projection (Kooima's formulation). Define the screen as a rectangle in world space (pa, pb, pc corners), compute the frustum from the tracked eye point each frame and set `camera.projectionMatrix` manually in three.js. This — not just moving the camera — is what sells the illusion.
- Smoothing: One-Euro filter on the eye position (jitter kills the effect; latency kills it more — tune `beta` high).
- Scene: a shoebox diorama slightly *behind* the screen plane, with strong depth cues: side walls, floor grid, fog, small objects at different depths, one object in front of the plane. Render at devicePixelRatio with antialiasing.

## Implementation sketch
1. Build a static shoebox scene whose front opening exactly matches screen physical size (read `screen.width` + assume DPI, or calibrate with a credit-card overlay once; store in localStorage).
2. Implement off-axis projection with a hardcoded fake eye position controlled by mouse — verify the window illusion works before adding the camera.
3. Add Face Landmarker → eye midpoint → unproject to 3D using IPD-based depth. Mirror the X axis (front camera).
4. One-Euro filter; clamp eye motion range; lerp to center when face is lost.
5. Content pass: an aquarium room where fish swim toward the glass when you peek in, plus a tiny resident who notices you and waves (distance < threshold triggers animation).
6. Stretch: gyro fusion for when the face leaves the frame; "look behind the object" hide-and-seek minigame.

## Pitfalls
- Effect only works for one viewer (one pair of eyes) — by design, frame it as "your secret box".
- Front camera FOV varies per device; expose a sensitivity slider.
- Latency above ~100 ms breaks immersion: keep the ML on `VIDEO` mode with `runningMode` GPU delegate, render scene independently at 60fps and only update the eye target from ML.

## Why it surprises
Everyone has seen 3D on a screen; almost nobody has seen the screen itself become a hole in the wall. The moment a kid leans sideways and sees "around" an object, they grab the adult next to them. It demos in 3 seconds with zero instructions — you just naturally peek.
