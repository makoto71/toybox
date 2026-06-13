# かこの じぶんと おどる

## 概要
カメラの前で動くと、数秒前の自分が半透明の分身になって画面に残り、一緒に踊ってくれる。動けば動くほど分身が増えて、最大で5人の「過去の自分」と群舞ができる。ひとりなのに、みんなで踊っているみたいになる時間差ダンスミラー。

## Concept (EN)
Dance with your past selves. The player's segmented silhouette is recorded continuously; delayed copies (e.g. -2s, -4s, -6s…) are composited behind the live image as translucent, color-tinted clones. Simple choreography emerges naturally: raise your arm, and a wave of arms follows. Modes: canon (fixed delays), mirror clones (flipped), and "loop stage" where you record an 8-second loop per layer and stack performances like a visual loop pedal.

## Tech
- MediaPipe Selfie Segmentation → per-frame mask; store masked RGBA frames in a ring buffer of canvases/textures (e.g. 8s × 30fps at 480p — memory-check, drop to 15fps clones if needed)
- Composite in WebGL: background (virtual stage or darkened camera feed) + N delayed layers (tint, alpha, slight scale offset for depth) + live layer on top
- Optional: beat-sync clone delays to BPM tapped by the user; mic beat detection as stretch
- Loop-pedal mode = the same buffers, but gated by record/overdub buttons

## Implementation sketch
1. Capture: video frame + segmentation mask → premultiplied RGBA into ring buffer texture array.
2. Render: for delay d in [2,4,6,8]s draw `buffer[now-d]` with hue-rotated tint and 0.6→0.3 alpha; live frame full opacity.
3. Stage dressing: floor reflection (flip + gradient fade) instantly makes it feel like a music video.
4. Loop mode: layer slots with record buttons; each slot loops its 8s clip until cleared — build a crowd of yourself.
5. Export: `MediaRecorder` of the composited canvas → share a 15s clip.

## Why it surprises
The first accidental wave — when your past arm follows your present one — is hypnotic. Kids choreograph with themselves; it's Norman McLaren's "Pas de deux" as a toy.
