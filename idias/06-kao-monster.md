# かおモンスター

## 概要
カメラに映った自分の表情が、そのまま画面の中のモンスターに乗り移る。口を開けるとモンスターも大あくび、まばたきも眉の動きもリアルタイムに同期。表情で操る着ぐるみのようなデジタルパペット。

## Concept (EN)
A real-time face-puppeted creature. MediaPipe Face Landmarker outputs 52 blendshape scores (jawOpen, eyeBlink, browUp, mouthSmile...) — map them onto an absurd creature (a giant daruma, a blob, a tengu) rendered in three.js. Head rotation moves the creature's body. Open your mouth wide to shoot a particle beam; puff your cheeks to inflate it like a balloon; smile to make flowers bloom around it.

## Tech
- MediaPipe Face Landmarker (tasks-vision) with `outputFaceBlendshapes: true` — gives ARKit-compatible blendshapes for free, no model training
- three.js: creature built from primitives + morph targets, or a simple rigged GLB with morphs authored in Blender
- Trigger system: blendshape thresholds → events (mouth>0.8 for 0.5s → beam)

## Implementation sketch
1. Pipe blendshapes to morph target influences 1:1 (jawOpen→mouth morph, blinkL/R→eyelids). Head pose from the facial transformation matrix.
2. Start with a procedurally-built blob creature (spheres + shader wobble) so no asset pipeline is needed for MVP.
3. Add 3 expression-triggered effects: beam (mouth), balloon (cheek puff), flower burst (smile).
4. Character select screen; each character has different trigger effects.
5. Stretch: record 10s clips with `MediaRecorder`; two-face mode where two people puppet two monsters that react to each other.

## Why it surprises
Latency-free expression transfer feels like possession. Kids immediately start pulling faces — the toy plays *them*.
