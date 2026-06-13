# からだで ひかりのおえかき

## 概要
カメラの前で体を動かすと、手や足の軌跡が光の線になって空間に残る。踊るだけで長時間露光写真のようなライトペインティング作品ができあがる。

## Concept (EN)
Full-body light painting. MediaPipe Pose tracks wrists/ankles/head; each keypoint emits a glowing ribbon trail that persists and slowly fades (or never fades, in "exposure" mode). Movement speed controls brush width and brightness — fast swings make thin sharp streaks, slow movement makes thick soft glow. A "shutter" button freezes the artwork over a dimmed camera still for saving.

## Tech
- MediaPipe Pose (tasks-vision), landmarks smoothed with One Euro filter
- three.js: trails as `MeshLine`-style ribbon geometry or instanced quads along the path; additive blending + UnrealBloomPass
- Optional: selfie segmentation mask to show the dancer as a dark silhouette inside their own light

## Implementation sketch
1. Track 5 emitters (both wrists, both ankles, nose). Each keeps a ring buffer of last N positions.
2. Build camera-facing ribbon strips per frame; width/alpha from velocity; hue cycles slowly over time or is per-limb.
3. Render trails to a separate framebuffer that accumulates (no clear) for true long-exposure feel; composite over the camera feed.
4. Save button: composite trails over a darkened camera frame → PNG download.
5. Stretch: "music mode" — play a built-in loop, pulse trail brightness to the beat; mirror/kaleidoscope symmetry toggle.

## Why it surprises
It turns dancing into a tangible artwork you can keep. Works for any age and is extremely photogenic — instant fridge-door art.
