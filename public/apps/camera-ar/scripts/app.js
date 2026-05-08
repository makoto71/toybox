import { CameraManager } from './camera.js';
import { FaceMeshDetector } from './facemesh.js';
import { OverlayManager } from './overlay.js';
import { Renderer } from './renderer.js';
import { CaptureManager } from './capture.js';

document.addEventListener('DOMContentLoaded', async () => {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('ar-canvas');
  const captureBtn = document.getElementById('capture-btn');
  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error-message');

  const camera = new CameraManager(video);
  const detector = new FaceMeshDetector();
  const overlay = new OverlayManager();

  try {
    loading.textContent = 'カメラを起動中...';
    await camera.start();

    loading.textContent = '顔認識モデルを読み込み中...';
    await detector.init();

    loading.textContent = '素材を読み込み中...';
    await overlay.loadConfig('./assets/config.json', './assets');

    loading.classList.add('hidden');

    const renderer = new Renderer(canvas, video, detector, overlay);
    renderer.start();

    const capture = new CaptureManager(canvas);
    captureBtn.addEventListener('click', () => capture.capture());

  } catch (err) {
    console.error(err);
    loading.classList.add('hidden');
    errorEl.textContent = err.name === 'NotAllowedError'
      ? 'カメラの使用が許可されていません。設定から許可してください。'
      : `エラーが発生しました: ${err.message}`;
    errorEl.classList.remove('hidden');
  }
});
