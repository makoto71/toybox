# スマホが ひかりのふで

## 概要
スマホそのものが「光の筆」になる。腕をのばしてスマホをぶんぶん振り回すと、空中に光のリボンがするすると描かれていく(画面は筆先のあと)。描き終わったら「みるモード」に切りかえて、スマホをかざしてあたりを見回すと——さっき描いた光の彫刻が、ちゃんと空中のその場所に浮かんでいる。体ぜんぶで描く、部屋サイズの3Dおえかき。

## Concept (EN)
The phone *is* the brush. Wave the device through the air and a glowing ribbon is laid down along its motion path (draw mode shows the brush-tip view streaming past). Then flip to view mode: the phone becomes a window you point around the room, and your light sculpture hangs in mid-air exactly where you drew it. Uses only the IMU (gyro + accelerometer) — no camera needed for the core loop — making it the rare full-body 3D drawing toy with zero permissions. Pairs naturally with the existing oekaki-3d codebase (and its WebXR module as an optional true-AR upgrade).

## Tech
- Orientation: `DeviceOrientationEvent` (or sensor-fusion from `devicemotion` raw gyro+accel via a Madgwick/complementary filter for control over drift) → device quaternion at 60 Hz.
- The key cheat — arm-lever model: true positional tracking from an IMU is impossible (double-integration drifts in seconds), so don't try. Model the phone as held at a fixed radius from a pivot at the user's shoulder/chest: `tipPos = pivot + quat · (0, 0, −r)`, r ≈ 0.5 m (adjustable). Orientation changes sweep the tip across a sphere around the user — which matches how people *actually* wave a phone with an extended arm. Add a "reach" axis: pull/push along the view direction with a thumb slider (or accel-burst detection: a jab momentarily extends r). Result: expressive, stable, drift-free-enough 3D strokes.
- Strokes: append tip samples (One-Euro filtered) into a ribbon mesh — `TubeGeometry` is too slow to rebuild; use a custom extruded triangle strip with per-vertex `age` for shimmer. Brush width from angular speed (fast sweep = thin streak, slow = thick pour — calligraphic). Additive material + bloom; optional particle dust falling off fresh strokes.
- Draw-mode display: camera at the pivot looking along the device — you see the brush tip and the trail whipping past, like riding the pen nib.
- View mode: same pivot camera, but now strokes are static and the gyro pans the view (photosphere-style) — the sculpture is anchored in room orientation because both modes share the same world frame. Walk-around is fake (rotation only), but the "it's still there!" moment lands hard.
- Optional true-AR layer: reuse oekaki-3d's `ar-webxr.js` — on WebXR-capable Androids, view mode becomes camera-passthrough AR with real 6-DoF; the IMU sketch imports 1:1.
- Audio: stroke speed → whoosh (filtered noise), like a sparkler.

## Implementation sketch
1. Quaternion → tip-on-sphere → ribbon strip; tune One-Euro + width-from-speed until a figure-8 wave feels like a sparkler. (Test rig: mouse-drag orientation emulation on desktop.)
2. Mode toggle (big thumb button: hold = ink flows, release = move without drawing — like a real brush lift).
3. Reach control (thumb slider first; jab detection later). Color/brush palette on the lower thumb arc.
4. View mode + "find your drawing" onboarding; long-exposure-style PNG export (render with extended bloom).
5. iOS: `DeviceOrientationEvent.requestPermission()` gate behind a tap; calibrate "forward" at session start (current heading = north of the drawing world).
6. Stretch: WebXR AR view via existing module; ghost-replay (watch the stroke redraw itself in time); two-phone duet via local QR-handshake + WebRTC (no server beyond free STUN).

## Pitfalls
- Gyro drift slowly rotates the world → offer a "re-center" pinch gesture; keep sessions short and playful.
- The lever model breaks if the user draws with wrist-only flicks → onboarding animation explicitly shows the big-arm sparkler motion (which is also the fun way).

## Why it surprises
Every drawing app shrinks art to a fingertip; this one un-shrinks it — you draw with your whole arm, the way kids draw with sparklers on summer nights, and the room remembers it. The view-mode reveal ("turn around… it's HANGING THERE") reliably produces the look-behind-the-screen double-take, with zero camera permission and zero setup.
