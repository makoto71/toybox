# かげえの どうぶつえん

## 概要
カメラに向かって手で影絵（キツネ、犬、鳥など）の形を作ると、画面の中でその影が本物の動物に変身して動き出す。手影絵という古い遊びとハンドトラッキングの組み合わせ。

## Concept (EN)
A virtual shadow-puppet wall. MediaPipe Hands tracks both hands; when the finger configuration matches a known shadow-puppet pose (fox, dog, bird, snail), the silhouette "comes alive": eyes blink open inside the shadow, then it detaches from your hand and walks/flies across the screen as a stylized shadow creature. Lose the pose and it dissolves back into your hand's shadow.

## Tech
- MediaPipe Hands (tasks-vision) for 21 landmarks per hand
- Pose classification: simple rule-based on finger joint angles + thumb/finger distances (no ML training needed — 4–6 poses are easily separable)
- three.js or 2D canvas: render hand silhouette from landmarks (filled polygon + blur = soft shadow), creatures as black silhouette sprites with subtle skeletal animation
- Warm "lantern light" gradient background, dust particles in the light beam

## Implementation sketch
1. Render the live hand as a soft shadow (landmark hull, blurred), on a paper-lantern background.
2. Detect fox pose: index+pinky extended, middle+ring folded touching thumb. Add bird (thumbs hooked, palms flapping) and dog.
3. On detection: 1s "magic" transition (particles swirl), spawn animated silhouette creature with its own behavior loop.
4. Each discovered animal gets added to a "zukan" (collection book) — collection mechanic drives replay.
5. Stretch: two-hand combo animals; let creatures interact (fox chases bird).

## Why it surprises
Bridges a traditional analog game with CV magic. The moment the shadow blinks at you is genuinely uncanny and delightful.
