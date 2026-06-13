// ===========================================================================
//  audio.js  —  マイク低域エネルギー (任意機能)
//  音楽のビートで磁場を脈動させる。許可が要るのでボタンで明示的に開始。
// ===========================================================================

export function createMic() {
  let analyser = null;
  let data = null;
  let level = 0;
  let enabled = false;

  async function enable() {
    if (enabled) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      data = new Uint8Array(analyser.frequencyBinCount);
      enabled = true;
      return true;
    } catch (e) {
      console.warn('マイク利用不可:', e);
      return false;
    }
  }

  function update() {
    if (!enabled || !analyser) { level = 0; return 0; }
    analyser.getByteFrequencyData(data);
    // 低域(おおよそ最初の 1/4)の平均
    let sum = 0;
    const n = Math.floor(data.length * 0.25);
    for (let i = 0; i < n; i++) sum += data[i];
    const raw = sum / n / 255;
    // 滑らかに追従、軽く強調
    level += (Math.max(0, raw - 0.08) * 1.6 - level) * 0.4;
    return Math.min(level, 1);
  }

  return { enable, update, get enabled() { return enabled; } };
}
