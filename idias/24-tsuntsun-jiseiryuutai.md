# つんつん じせいりゅうたい

## 概要
画面の中に、黒くてつやつやの不思議な液体(磁性流体)が入っている。指を近づけるとトゲトゲの山がニョキニョキ立ち上がり、指を動かすと追いかけてくる。音楽を流すとビートに合わせてトゲが脈動する。実物はなかなか触れない磁性流体を、指で直接いじれるおもちゃ。

## Concept (EN)
Interactive ferrofluid (homage to Sachiko Kodama's "Protrude, Flow"). A glossy black liquid blob rests in a dish; the finger acts as a magnet — proximity raises the characteristic spike arrays (Rosensweig instability), dragging pulls the fluid along, two-finger touch creates competing spike fields. Mic input modulates field strength so music makes the spikes dance. A color picker turns it into chrome / gold / iridescent fluid.

## Tech
- Rendering: raymarched SDF in a fragment shader — base blob (smooth-min of dish + fluid heightfield) plus spike field: radial array of cone SDFs whose height/sharpness scale with local "magnetic field" value; normals → glossy PBR-ish shading with env-map reflection (this is where the realism comes from)
- Field sim: small 2D texture of magnet influence — touch points splat Gaussians, advect/decay each frame; spike spacing via hex-lattice function of field strength (real ferrofluid spike spacing shrinks as field grows — easy to fake convincingly)
- Mic: `AnalyserNode` bass energy → global field multiplier
- No camera, no ML; one fullscreen shader + a tiny JS state layer. three.js optional (a quad is enough)

## Implementation sketch
1. Prototype the static spike SDF in a shader first (the look is 80% of the toy).
2. Field texture: `field = max(field*0.95, touchSplat)`; bass adds a uniform term.
3. Spikes: domain-repeat cones on the blob surface; height `h = k*field^1.5`, lattice density `∝ field` — interpolate two lattices to avoid popping.
4. Drag flow: advect the field texture toward pointer velocity so the blob "follows" the finger.
5. Stretch: record a loop as WebM; "two magnets" multi-touch tug-of-war.

## Why it surprises
Ferrofluid is mesmerizing in museums but untouchable behind glass — here your bare finger is the magnet. The spike lattice reacting to a music drop is an instant share-clip.
