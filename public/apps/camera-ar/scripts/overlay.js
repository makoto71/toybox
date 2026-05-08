export class OverlayManager {
  constructor() {
    this.config = null;
    this.images = {};
  }

  async loadConfig(configUrl, basePath) {
    const res = await fetch(configUrl);
    this.config = await res.json();

    const loadPromises = this.config.assets.map(asset => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          this.images[asset.id] = img;
          resolve();
        };
        img.onerror = reject;
        img.src = `${basePath}/${asset.src}`;
      });
    });

    await Promise.all(loadPromises);
  }

  draw(ctx, landmarks, canvasWidth, canvasHeight) {
    if (!this.config || landmarks.length === 0) return;

    for (const face of landmarks) {
      for (const asset of this.config.assets) {
        const img = this.images[asset.id];
        if (!img) continue;

        const anchor = face[asset.anchor.landmark];
        const lmA = face[asset.widthReference.landmarkA];
        const lmB = face[asset.widthReference.landmarkB];

        const anchorX = anchor.x * canvasWidth;
        const anchorY = anchor.y * canvasHeight;

        const faceWidth = Math.hypot(
          (lmA.x - lmB.x) * canvasWidth,
          (lmA.y - lmB.y) * canvasHeight
        );

        const renderWidth = faceWidth * asset.scale.widthMultiplier;
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        const renderHeight = renderWidth / aspectRatio;

        const drawX = anchorX - renderWidth / 2 + asset.offset.x * renderWidth;
        const drawY = anchorY - renderHeight / 2 + asset.offset.y * renderWidth;

        ctx.drawImage(img, drawX, drawY, renderWidth, renderHeight);
      }
    }
  }
}
