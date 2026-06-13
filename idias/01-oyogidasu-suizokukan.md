# およぎだす すいぞくかん

## 概要
紙に描いた魚の絵をカメラで撮ると、その絵がそのまま3D水族館の中で泳ぎ出す。描いた本人の絵が動くという、teamLab的な驚きのあるおもちゃ。画面内おえかきモードも用意すれば紙がなくても遊べる。

## Concept (EN)
Kids draw a fish (on paper or on a canvas in the app). The drawing is captured, segmented from the background, and texture-mapped onto a deformable fish mesh that swims in a shared 3D aquarium with gentle caustics, bubbles, and other fish. Tap a fish to make it dart away; feed them by tapping the water surface.

## Tech
- three.js for the aquarium scene (fog, caustics via projected texture, particle bubbles)
- getUserMedia + simple color/threshold segmentation (or draw inside an on-screen canvas to skip segmentation entirely — recommended MVP path)
- Fish animation: skinned mesh or vertex shader sine-wave deformation along the spine (cheap, looks great)

## Implementation sketch
1. MVP: in-app drawing canvas with a fish outline template; user paints inside it.
2. Use the canvas as a `CanvasTexture` on a flat fish mesh (2 triangles strip subdivided ~20x), deform vertices in vertex shader: `x += sin(time*4 + uv.x*6) * uv.x * amp`.
3. Boid-like wander steering, depth fog, light rays (additive billboards).
4. Stretch: paper-capture mode — detect the printed template's corner markers (jsQR-style or OpenCV.js homography), warp, extract drawing.
5. Stretch: persist fish to localStorage so the aquarium fills up over visits.

## Why it surprises
"My drawing came alive" is the strongest possible payoff for the effort of drawing. Proven crowd-pleaser format, rarely seen as a free web toy.
