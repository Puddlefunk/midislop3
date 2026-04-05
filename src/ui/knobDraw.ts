// ─────────────────────────────────────────────────────────────
// Canvas drawing helpers — extracted from UIRenderer.ts
// ─────────────────────────────────────────────────────────────

export function drawKnob(canvas: HTMLCanvasElement | null, v01: number, hue: number, focused = false): void {
  if (!canvas) return;
  const kc = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, r = w * 0.33;
  const sc = w / 34; // scale factor relative to reference size
  kc.clearRect(0, 0, w, h);
  const START = Math.PI * 0.75, RANGE = Math.PI * 1.5;
  kc.beginPath(); kc.arc(cx, cy, r, START, START + RANGE);
  kc.strokeStyle = 'rgba(255,255,255,0.18)'; kc.lineWidth = 2.5 * sc; kc.lineCap = 'round'; kc.stroke();
  if (v01 > 0.001) {
    kc.beginPath(); kc.arc(cx, cy, r, START, START + v01 * RANGE);
    kc.strokeStyle = focused ? `hsl(${hue},85%,72%)` : `hsla(${hue},72%,72%,0.82)`;
    kc.lineWidth = 2.5 * sc; kc.lineCap = 'round'; kc.stroke();
  }
  const a = START + v01 * RANGE;
  kc.beginPath(); kc.arc(cx + Math.cos(a) * (r - sc), cy + Math.sin(a) * (r - sc), 2.5 * sc, 0, Math.PI * 2);
  kc.fillStyle = focused ? `hsl(${hue},85%,85%)` : `hsla(${hue},65%,88%,0.85)`; kc.fill();
}

export function drawBipolarKnob(canvas: HTMLCanvasElement | null, v01: number, hue: number, focused = false): void {
  if (!canvas) return;
  const kc = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, r = w * 0.33;
  const sc = w / 34;
  kc.clearRect(0, 0, w, h);
  const START = Math.PI * 0.75, RANGE = Math.PI * 1.5;
  const CENTER = START + 0.5 * RANGE; // 12 o'clock
  // Background arc
  kc.beginPath(); kc.arc(cx, cy, r, START, START + RANGE);
  kc.strokeStyle = 'rgba(255,255,255,0.18)'; kc.lineWidth = 2.5 * sc; kc.lineCap = 'round'; kc.stroke();
  // Fill arc from center outward
  if (Math.abs(v01 - 0.5) > 0.012) {
    const a = START + v01 * RANGE;
    kc.beginPath();
    if (v01 < 0.5) kc.arc(cx, cy, r, a, CENTER);
    else           kc.arc(cx, cy, r, CENTER, a);
    kc.strokeStyle = focused ? `hsl(${hue},85%,72%)` : `hsla(${hue},72%,72%,0.82)`;
    kc.lineWidth = 2.5 * sc; kc.lineCap = 'round'; kc.stroke();
  }
  // Center tick
  kc.beginPath(); kc.moveTo(cx + Math.cos(CENTER) * (r - 4 * sc), cy + Math.sin(CENTER) * (r - 4 * sc));
  kc.lineTo(cx + Math.cos(CENTER) * (r + sc), cy + Math.sin(CENTER) * (r + sc));
  kc.strokeStyle = 'rgba(255,255,255,0.25)'; kc.lineWidth = sc; kc.stroke();
  // Dot
  const a = START + v01 * RANGE;
  kc.beginPath(); kc.arc(cx + Math.cos(a) * (r - sc), cy + Math.sin(a) * (r - sc), 2.5 * sc, 0, Math.PI * 2);
  kc.fillStyle = focused ? `hsl(${hue},85%,85%)` : `hsla(${hue},65%,88%,0.85)`; kc.fill();
}

export function drawFader(canvas: HTMLCanvasElement | null, v01: number, hue: number, focused = false): void {
  if (!canvas) return;
  const fc = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, cx = w / 2;
  const sc = w / 22; // scale factor relative to reference fader width
  fc.clearRect(0, 0, w, h);
  const padV = 7 * sc, tBot = h - padV, tH = tBot - padV, tY = tBot - v01 * tH;
  fc.beginPath(); fc.moveTo(cx, padV); fc.lineTo(cx, tBot);
  fc.strokeStyle = 'rgba(255,255,255,0.18)'; fc.lineWidth = 2 * sc; fc.lineCap = 'round'; fc.stroke();
  if (v01 > 0.005) {
    fc.beginPath(); fc.moveTo(cx, tY); fc.lineTo(cx, tBot);
    fc.strokeStyle = focused ? `hsl(${hue},85%,72%)` : `hsla(${hue},72%,72%,0.82)`;
    fc.lineWidth = 2 * sc; fc.lineCap = 'round'; fc.stroke();
  }
  const thumbW = w - 2 * sc, thumbH = 6 * sc, thumbR = 2 * sc;
  fc.beginPath(); fc.roundRect(cx - thumbW / 2, tY - thumbH / 2, thumbW, thumbH, thumbR);
  fc.fillStyle = focused ? `hsl(${hue},80%,78%)` : 'rgba(225,225,225,0.72)'; fc.fill();
}

export function drawWavePreview(canvas: HTMLCanvasElement | null, type: string, param1 = 0): void {
  if (!canvas) return;
  const c2 = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, mid = h / 2;
  c2.clearRect(0, 0, w, h);
  c2.strokeStyle = 'rgba(255,255,255,0.7)'; c2.lineWidth = 1.5; c2.lineJoin = 'round'; c2.beginPath();
  for (let x = 0; x <= w; x++) {
    const t = x / w; let y: number;
    switch (type) {
      case 'sine': {
        y = Math.sin(t * Math.PI * 2);
        if (param1 > 0) { let yf = y * (1 + param1 * 3.5); while (Math.abs(yf) > 1) yf = Math.sign(yf) * 2 - yf; y = yf; }
        break;
      }
      case 'sawtooth': { y = 1 - 2 * t; if (param1 > 0) y = Math.tanh(y * (1 + param1 * 4)) / Math.tanh(1 + param1 * 4); break; }
      case 'triangle': { const s = Math.max(0.01, Math.min(0.99, param1 || 0.5)); y = t < s ? (t / s) * 2 - 1 : 1 - ((t - s) / (1 - s)) * 2; break; }
      case 'square':   { y = t < (param1 || 0.5) ? 1 : -1; break; }
      case 'sub':      { y = t < 0.5 ? 0.6 : -0.6; break; }
      case 'noise':    { y = Math.sin(t * 71.3) * Math.cos(t * 127.7) * Math.sin(t * 43.1); break; }
      default:         { y = 0; }
    }
    x === 0 ? c2.moveTo(x, mid - y * (mid - 3)) : c2.lineTo(x, mid - y * (mid - 3));
  }
  c2.stroke();
}
