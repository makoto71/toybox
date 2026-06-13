# かべのあな

## 概要
画面の奥から「人型の穴があいた壁」が迫ってくる。カメラに映る自分の体でその穴と同じポーズをとれば、壁をすり抜けられる! 失敗すると壁がドーンと崩れる。全身を使う「脳トレ×体操」なポーズ通過ゲーム。

## Concept (EN)
Hole-in-the-wall pose game (the classic TV show, in the browser). MediaPipe Pose tracks the player's skeleton; an approaching wall has a person-shaped hole generated from a target pose. At the moment of impact, the player's silhouette is compared to the hole — pass through with sparkles, or comically crash the wall into bricks.

## Tech
- MediaPipe Pose (33 landmarks) or Selfie Segmentation for the silhouette mask
- Matching: rasterize both the target-pose silhouette and the live segmentation mask to small grids (e.g. 64×96) → IoU score; threshold = pass. Robust and cheap, no joint-angle math needed
- three.js: wall as an extruded shape with the hole (Shape + holes path), brick-explosion via instanced cubes with impulses; player layer = camera video with segmentation cutout composited between walls
- Target poses authored as landmark sets → silhouette via stylized capsule-figure rendering

## Implementation sketch
1. Calibration: full body in frame check, friendly outline guide.
2. Wall pipeline: pick pose → build silhouette mesh → boolean hole in wall plane → animate toward camera over ~5s with speed ramp per level.
3. At z=0: IoU(live mask, hole mask) → pass/fail; show ghost overlay of the target during approach so kids can adjust.
4. Fail = wall shatters (instanced physics-lite: scripted velocities, no engine needed) + everyone laughs; pass = wall flies by, score combo.
5. Party mode: two players share the frame, two-person holes (one big + one small — parent & kid!).

## Why it surprises
It pulls whole families off the sofa. The two-person holes turn it into cooperative physical comedy — peak living-room media art.
