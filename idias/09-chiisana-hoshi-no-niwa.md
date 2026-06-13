# ちいさな ほしのにわ

## 概要
手のひらサイズの小さな球体の惑星に、指でなぞって木や家や川を生やしていく箱庭おもちゃ。星はくるくる回せて、育てた星は昼と夜を繰り返し、夜には家に明かりが灯る。星の王子さま的世界観。

## Concept (EN)
A tiny-planet garden. A small sphere floats in space; drag to rotate it, and "paint" on its surface with element brushes: tree brush sprouts procedural trees that grow over seconds, water brush carves blue rivers, house brush drops glowing cottages, snow brush whitens the pole. A sun orbits the planet creating a real day/night cycle — at night, houses light up, fireflies appear over water. The planet keeps living (trees sway, smoke rises) even when you stop touching it.

## Tech
- three.js: sphere raycasting for brush position; surface data stored in an equirect "biome texture" (RGBA channels = grass/water/snow/height) sampled by the terrain shader
- Objects (trees/houses) as instanced meshes placed on the sphere normal; procedural low-poly trees (cone stacks) need no assets
- Day/night: orbiting directional light + emissive windows modulated by sun dot product
- Persistence: serialize biome texture + object list to localStorage

## Implementation sketch
1. Sphere with a shader blending grass/dirt/water/snow from the paint texture; paint by drawing into a render target at the raycast UV.
2. Brush palette UI (5 brushes + eraser). Trees: on paint, scatter 1–3 instances with scale-up "growing" tween.
3. Sun orbit (90s per day), sky color lerp, stars fade in, window emissive at night.
4. Idle life: tree sway via vertex shader, firefly particles over water at night, chimney smoke.
5. Stretch: weather button (rain makes grass spread near water); share planet as a spinning GIF; multiple planet save slots.

## Why it surprises
It's a garden that keeps living without you. The first nightfall — when the houses you placed light up on their own — is the magic moment.
