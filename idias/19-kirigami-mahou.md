# きりがみ まほう

## 概要
画面の上で紙を半分に、また半分に折って、指でチョキチョキ切る。「ひらく」ボタンを押すと、紙がふわっと開いて、思いもよらない雪の結晶や紋様が現れる。本物のはさみが使えない子でも安全に楽しめる、デジタル切り紙。

## Concept (EN)
Virtual kirigami (fold-and-cut). Fold a square of paper 2–4 times (animated 3D folds), draw cut lines with your finger, then unfold: the cuts are mirrored/rotated by the fold symmetry into a surprising mandala or snowflake. Results can be hung in a virtual window where light shines through, or layered into a mobile.

## Tech
- Geometry: represent the folded stack as one triangle/wedge domain; cuts = polylines clipped to the wedge; unfolding = apply the fold group's reflections/rotations (D4, D6, D8 dihedral symmetry) to generate the full pattern — pure 2D math, then triangulate (earcut) for rendering
- three.js for the satisfying part: paper as a thin mesh, fold animations via simple hinge rotations, unfold staged crease by crease with paper-bend easing and a soft shadow
- Light-through-window mode: pattern as alpha mask on an emissive plane + god-ray-ish glow

## Implementation sketch
1. Fold UI: tap preset folds (half / quarter / eighth / hexagonal like real snowflake folding).
2. Cut: finger draws polylines on the visible wedge; boolean-subtract from wedge polygon (small clipping lib or hand-rolled, shapes are simple).
3. Unfold: precompute mirrored polygon union; animate hinges opening one crease at a time — this reveal is the whole show, make it slow and springy.
4. Save as PNG/SVG; bonus: print-friendly PDF of the folded wedge + cut lines so kids can recreate it with real paper (digital→physical!).
5. Stretch: "guess mode" — show a target pattern, challenge to cut it.

## Why it surprises
The unfold reveal is a guaranteed gasp — even adults can't predict the result. The print-it-and-cut-real-paper bridge makes it more than a screen toy.
