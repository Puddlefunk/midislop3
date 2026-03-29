// ─────────────────────────────────────────────────────────────
// VisualEngine — canvas 2D visual layer.
// Full port of the midigame/app.js flower-of-life + bolt system.
// ─────────────────────────────────────────────────────────────

export interface VisualEngineOptions {
  canvas:      HTMLCanvasElement;
  patchCanvas: HTMLCanvasElement;
  width:       number;
  height:      number;
}

interface NoteViz    { startTime: number; }
interface FolNote    { strikeTimes: number[]; lastBeat: number; hops: Array<{ x: number; y: number }>; }
interface CrossRipple { x: number; y: number; startTime: number; h: number; }
interface BurnEffect  { startTime: number; hue: number; duration: number; }

interface Particle {
  type:     'burst-ring' | 'ring' | 'spark';
  x: number; y: number; r: number; maxR: number;
  speed:    number;
  alpha:    number;
  h:        number;
  lineWidth?: number;
  vx?: number; vy?: number;
  decay?:   number;
}

export class VisualEngine {
  private canvas:   HTMLCanvasElement;
  private ctx:      CanvasRenderingContext2D;
  private _width    = 0;
  private _height   = 0;
  private _running  = false;
  private _raf      = 0;
  private _onFrame: (() => void) | null = null;

  // Game-driven state
  private _bpm      = 120;
  private _hue      = 200;
  private _levelIdx = 0;

  // Note tracking
  private _activeNotes = new Map<number, NoteViz>();

  // FOL visual state
  private readonly _folScale        = 1.0;
  private _folStreakAlpha            = 0;
  private _folPhosphorAlpha         = 0;
  private _folPhosphorHue           = 270;
  private _folCrossRipples:          CrossRipple[] = [];
  private _folActiveCrossings        = new Set<string>();
  private _folNoteState              = new Map<number, FolNote>();
  private _burnEffect:               BurnEffect | null = null;
  private _particles:                Particle[] = [];

  constructor(opts: VisualEngineOptions) {
    this.canvas = opts.canvas;
    this.ctx    = opts.canvas.getContext('2d')!;
    this._width  = opts.width;
    this._height = opts.height;
  }

  // ── Public API ────────────────────────────────────────────────

  setFrameCallback(fn: () => void): void { this._onFrame = fn; }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._loop();
  }

  stop(): void {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  resize(w: number, h: number): void {
    this._width = w; this._height = h;
    this.canvas.width = w; this.canvas.height = h;
  }

  setBpm(bpm: number): void        { this._bpm      = bpm; }
  setHue(hue: number): void        { this._hue      = hue; }
  setLevel(idx: number): void      { this._levelIdx = idx; }

  onNoteOn(midi: number, _vel: number): void {
    this._activeNotes.set(midi, { startTime: performance.now() });
    this._noteOnFlower(midi);
    this._spawnNoteParticles(midi);
  }

  onNoteOff(midi: number): void {
    this._activeNotes.delete(midi);
    this._noteOffFlower(midi);
  }

  triggerPhosphorFlash(hue: number): void {
    this._folPhosphorAlpha = 1.0;
    this._folPhosphorHue   = hue;
  }

  triggerStreakFlash(level = 1): void {
    this._folStreakAlpha = Math.min(1, 0.25 + level * 0.15);
  }

  triggerBurn(hue: number): void {
    this._burnEffect = { startTime: performance.now(), hue, duration: 1800 };
  }

  // ── Helpers ───────────────────────────────────────────────────

  private _fi(m: number): number       { return (m % 12 * 7) % 12; }
  private _hueOf(m: number): number    { return this._fi(m) * 30; }

  private _boundR(): number {
    return Math.min(this._width / 2 - 20, this._height / 2 - 60);
  }

  private _baseR(): number { return this._boundR() * this._folScale / 3; }
  private _beatMs(): number { return 60000 / this._bpm; }
  private _chaos(): number  { return Math.min(1.0, this._levelIdx / 15); }

  private _nodePos(fi: number, ring: number): { x: number; y: number } {
    const cx = this._width / 2, cy = this._height / 2;
    const angle = (fi / 12) * Math.PI * 2 - Math.PI / 2;
    const r = this._baseR() * ring;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  }

  private _notePos(midi: number): { x: number; y: number } {
    return this._nodePos(this._fi(midi), 1);
  }

  private _segIntersect(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number,
  ): { x: number; y: number } | null {
    const d = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / d;
    const u = -((x1-x2)*(y1-y3) - (y1-y2)*(x1-x3)) / d;
    return (t>0&&t<1&&u>0&&u<1) ? { x: x1+t*(x2-x1), y: y1+t*(y2-y1) } : null;
  }

  private _computeHops(fi: number, chaos: number): Array<{ x: number; y: number }> {
    if (!chaos || Math.random() >= chaos * 0.38) return [];
    const numHops = chaos > 0.55 && Math.random() < 0.45 ? 2 : 1;
    const activeFis = new Set([...this._activeNotes.keys()].map(m => this._fi(m)));
    const hops: Array<{ x: number; y: number }> = [];
    let curFi = fi;
    for (let i = 0; i < numHops; i++) {
      const sign  = Math.random() < 0.5 ? 1 : -1;
      const delta = 1 + (chaos > 0.65 && Math.random() < 0.35 ? 1 : 0);
      const hopFi = (curFi + sign * delta + 12) % 12;
      if (!activeFis.has(hopFi) && hopFi !== fi) {
        hops.push(this._nodePos(hopFi, 1));
        curFi = hopFi;
      }
    }
    return hops;
  }

  // ── Note flower hooks ────────────────────────────────────────

  private _noteOnFlower(midi: number): void {
    const now = performance.now();
    if (!this._folNoteState.has(midi))
      this._folNoteState.set(midi, { strikeTimes: [], lastBeat: -1, hops: [] });
    const s = this._folNoteState.get(midi)!;
    s.hops = this._computeHops(this._fi(midi), this._chaos());
    s.strikeTimes.push(now);
    if (s.strikeTimes.length > 8) s.strikeTimes.shift();
  }

  private _noteOffFlower(midi: number): void {
    this._folNoteState.delete(midi);
    for (const key of this._folActiveCrossings)
      if (key.startsWith(midi + '-') || key.endsWith('-' + midi))
        this._folActiveCrossings.delete(key);
  }

  private _spawnNoteParticles(midi: number): void {
    const pos = this._notePos(midi);
    const h   = this._hueOf(midi);
    const br  = this._baseR();
    this._particles.push({ type: 'burst-ring', x: pos.x, y: pos.y, r: 6, maxR: br * 0.38, speed: 3.2, alpha: 0.75, h, lineWidth: 2.0 });
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, spd = 1.5 + Math.random() * 3;
      this._particles.push({ type: 'spark', x: pos.x, y: pos.y, r: 1.8, maxR: 0, speed: spd, alpha: 0.85, h, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, decay: 0.028 });
    }
  }

  // ── Frame loop ────────────────────────────────────────────────

  private _loop(): void {
    if (!this._running) return;
    this._draw();
    this._onFrame?.();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  private _draw(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,.13)';
    ctx.fillRect(0, 0, this._width, this._height);
    this._drawBurnEffect();
    this._drawFOLBackground();
    this._updateFlowerPulse();
    this._drawFOLNodes();
    this._drawLightning();
    this._drawPlasmaArc();
    this._drawRipples();
    this._drawCenterGlow();
    this._drawPolygon();
    this._drawActiveNotes();
    this._drawParticles();
  }

  // ── Visual draws ──────────────────────────────────────────────

  private _drawBurnEffect(): void {
    if (!this._burnEffect) return;
    const { ctx } = this;
    const { startTime, hue: h, duration } = this._burnEffect;
    const raw = (performance.now() - startTime) / duration;
    if (raw >= 1) { this._burnEffect = null; return; }
    const t    = Math.min(1, raw);
    const ease = 1 - Math.pow(1 - t, 2.2);
    const cx = this._width / 2, cy = this._height / 2;
    const maxR = Math.hypot(this._width / 2, this._height / 2) * 1.35;
    const baseR = maxR * ease;
    const STEPS = 128;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      const d = 1
        + 0.10 * Math.sin(a *  3 + t *  6.2)
        + 0.06 * Math.sin(a *  7 + t * 11.3)
        + 0.04 * Math.sin(a * 13 + t * 17.7)
        + 0.02 * Math.sin(a * 23 + t * 27.1);
      pts.push({ x: cx + baseR * d * Math.cos(a), y: cy + baseR * d * Math.sin(a) });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    const edgeA = (1 - t * 0.5) * 0.85;
    ctx.save();
    ctx.strokeStyle = `hsla(${h},75%,82%,${edgeA})`;
    ctx.lineWidth   = 3;
    ctx.shadowColor = `hsla(${h},85%,65%,${edgeA * 0.9})`;
    ctx.shadowBlur  = 28;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  private _drawFOLBackground(): void {
    const { ctx } = this;
    const cx = this._width / 2, cy = this._height / 2;
    const r  = this._baseR(), boundR = this._boundR();
    const dy = r * Math.sqrt(3) / 2;
    const maxR = Math.hypot(this._width, this._height) / 2 + r;
    const rows = Math.ceil(maxR / dy) + 1;
    const cols = Math.ceil(maxR / r)  + 1;
    ctx.save();

    // ── Infinite tile ──
    const isStreak = this._folStreakAlpha > 0;
    const now = performance.now();
    const flicker = isStreak
      ? 1 + this._folStreakAlpha * 0.18 * Math.sin(now / 72 + Math.cos(now / 153) * 2.1)
      : 1;
    const sv = Math.pow(this._folStreakAlpha, 1.6) * flicker;
    const cb = Math.min(1, this._folStreakAlpha / 0.30);
    const rC = Math.round(98  + (210-98 ) * cb);
    const gC = Math.round(55  + (235-55 ) * cb);
    const bC = Math.round(182 + (255-182) * cb);
    ctx.strokeStyle = `rgba(${rC},${gC},${bC},${0.030 + sv * 0.20})`;
    ctx.lineWidth   = 0.48 + 0.42 * cb;
    for (let row = -rows; row <= rows; row++) {
      const xOff = (row & 1) ? r / 2 : 0;
      const y    = row * dy;
      for (let col = -cols; col <= cols; col++) {
        ctx.beginPath();
        ctx.arc(cx + col * r + xOff, cy + y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (isStreak) {
      const sparkA = sv * 0.45;
      for (let ring = 1; ring <= 3; ring++) {
        for (let fi = 0; fi < 12; fi++) {
          const np = this._nodePos(fi, ring);
          if (np.x < -r || np.x > this._width + r || np.y < -r || np.y > this._height + r) continue;
          ctx.beginPath(); ctx.arc(np.x, np.y, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(220,240,255,${sparkA})`; ctx.fill();
        }
      }
      const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.65);
      sg.addColorStop(0, `rgba(190,215,255,${sv * 0.09})`);
      sg.addColorStop(1, 'transparent');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, this._width, this._height);
    }
    if (this._folStreakAlpha > 0.002) this._folStreakAlpha *= 0.980; else this._folStreakAlpha = 0;

    // ── Bounded form (phosphor / level-up) ──
    if (this._folPhosphorAlpha > 0) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = `rgba(255,248,255,${this._folPhosphorAlpha * 0.42})`;
      ctx.lineWidth   = 1.3;
      for (let row = -rows; row <= rows; row++) {
        const xOff = (row & 1) ? r / 2 : 0;
        const y    = row * dy;
        for (let col = -cols; col <= cols; col++) {
          const x = col * r + xOff;
          if (Math.hypot(x, y) > boundR + r) continue;
          ctx.beginPath(); ctx.arc(cx + x, cy + y, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${this._folPhosphorHue},80%,72%,${this._folPhosphorAlpha * 0.9})`;
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = `hsla(${this._folPhosphorHue},85%,60%,${this._folPhosphorAlpha * 0.7})`;
      ctx.shadowBlur  = 22;
      ctx.stroke(); ctx.shadowBlur = 0;
      const fa = Math.pow(this._folPhosphorAlpha, 2.2) * 0.35;
      const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, boundR);
      g.addColorStop(0,   `hsla(${this._folPhosphorHue},70%,88%,${fa})`);
      g.addColorStop(0.5, `hsla(${this._folPhosphorHue},80%,60%,${this._folPhosphorAlpha * 0.03})`);
      g.addColorStop(1,   'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2); ctx.fill();
      this._folPhosphorAlpha = Math.max(0, this._folPhosphorAlpha - 0.010);
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(110,65,175,0.03)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }

  private _drawFOLNodes(): void {
    const { ctx } = this;
    const now = performance.now();
    const boundR = this._boundR(), baseR = this._baseR();
    for (let ring = 1; ring <= 3; ring++) {
      if (ring * baseR > boundR + 20) break;
      const dotR = Math.max(0.8, 2.6 - ring * 0.38);
      for (let fi = 0; fi < 12; fi++) {
        const pos      = this._nodePos(fi, ring);
        const isActive = [...this._activeNotes.keys()].some(m => this._fi(m) === fi);
        if (isActive) {
          const h     = fi * 30;
          const pulse = 0.62 + 0.38 * Math.sin(now / 155 + ring * 0.85 + fi * 0.55);
          ctx.beginPath(); ctx.arc(pos.x, pos.y, dotR * 2.4 * pulse, 0, Math.PI * 2);
          ctx.fillStyle   = `hsla(${h},90%,78%,${0.88 / ring})`;
          ctx.shadowColor = `hsla(${h},90%,72%,0.65)`;
          ctx.shadowBlur  = 10; ctx.fill(); ctx.shadowBlur = 0;
        } else {
          ctx.beginPath(); ctx.arc(pos.x, pos.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(118,75,200,${0.10 / ring})`; ctx.fill();
        }
      }
    }
  }

  private _updateFlowerPulse(): void {
    const now = performance.now(), beatMs = this._beatMs();
    for (const [midi, note] of this._activeNotes) {
      const s = this._folNoteState.get(midi);
      if (!s) continue;
      const beat = Math.floor((now - note.startTime) / beatMs);
      if (beat <= s.lastBeat) continue;
      s.lastBeat = beat;
      s.hops = this._computeHops(this._fi(midi), this._chaos());
      s.strikeTimes.push(now);
      if (s.strikeTimes.length > 8) s.strikeTimes.shift();
    }
  }

  // ── Lightning bolt rendering ──────────────────────────────────

  private _subdivide(
    x1: number, y1: number, x2: number, y2: number,
    disp: number, depth: number, pts: number[][],
    branches: Array<{ pts: number[][]; relDepth: number }> | null,
  ): void {
    if (depth === 0 || Math.hypot(x2-x1, y2-y1) < 4) { pts.push([x2, y2]); return; }
    const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx, dy);
    const px = -dy/len, py = dx/len;
    const off = (Math.random()-0.5) * disp * len * 0.55;
    const nx = (x1+x2)/2 + px*off, ny = (y1+y2)/2 + py*off;
    if (branches && disp > 0.12 && depth >= 2 && Math.random() < disp * 0.32) {
      const bLen = len * (0.22 + Math.random() * 0.45) * disp;
      const bSgn = Math.random() < 0.5 ? 1 : -1;
      const bAng = bSgn * (0.28 + Math.random() * 0.65) * Math.PI * 0.5;
      const cos  = Math.cos(bAng), sin = Math.sin(bAng);
      const bx = nx + (cos*dx/len - sin*dy/len) * bLen;
      const by = ny + (sin*dx/len + cos*dy/len) * bLen;
      const bPts: number[][] = [[nx, ny]];
      this._subdivide(nx, ny, bx, by, disp * 0.52, depth-2, bPts, null);
      branches.push({ pts: bPts, relDepth: depth });
    }
    this._subdivide(x1, y1, nx, ny, disp*0.62, depth-1, pts, branches);
    this._subdivide(nx, ny, x2, y2, disp*0.62, depth-1, pts, branches);
  }

  private _strokePath(pts: number[][], h: number, alpha: number, width: number, flicker: number): void {
    if (pts.length < 2) return;
    const { ctx } = this;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); };
    path(); ctx.strokeStyle=`hsla(${h},80%,65%,${alpha*0.07*flicker})`;  ctx.lineWidth=width*15;   ctx.stroke();
    path(); ctx.strokeStyle=`hsla(${h},88%,72%,${alpha*0.25*flicker})`;  ctx.lineWidth=width*3.8;  ctx.stroke();
    path(); ctx.strokeStyle=`hsla(${h},96%,93%,${alpha*0.70*flicker})`;  ctx.lineWidth=width*0.88; ctx.stroke();
    ctx.restore();
  }

  private _subdivSeg(x0: number, y0: number, x1: number, y1: number, chaos: number, depth: number, pts: number[][]): void {
    const seg: number[][] = [[x0, y0]];
    this._subdivide(x0, y0, x1, y1, chaos * 0.38, depth, seg, null);
    pts.push(...seg.slice(1));
  }

  private _drawLightning(): void {
    const now    = performance.now();
    const cx     = this._width / 2, cy = this._height / 2;
    const boundR = this._boundR(), ring1R = this._baseR();
    const chaos  = this._chaos(), beatMs = this._beatMs();
    const depth  = 2 + Math.floor(chaos * 3.5);
    const boltData: Array<{ wps: number[][]; h: number; midi: number }> = [];

    const drawBolt = (midi: number, h: number, fullAlpha: number, fullWidth: number) => {
      const state = this._folNoteState.get(midi);
      if (!state?.strikeTimes.length) return;
      const fi  = this._fi(midi);
      const age = now - state.strikeTimes.at(-1)!;
      const front   = Math.min(age / (beatMs * 0.5) * boundR, boundR);
      const flicker = (0.55+0.45*Math.sin(now/52+midi*2.1)) * (0.75+0.25*Math.sin(now/19+fi*1.7));
      const angle   = (fi/12) * Math.PI*2 - Math.PI/2;
      const ex = cx + Math.cos(angle)*front, ey = cy + Math.sin(angle)*front;
      const hops    = front >= ring1R * 0.8 && state.hops.length > 0 ? state.hops : [];
      const wps: number[][] = [[cx, cy], ...hops.map(hop => [hop.x, hop.y]), [ex, ey]];
      boltData.push({ wps, h, midi });
      const ring1x = cx + Math.cos(angle)*ring1R, ring1y = cy + Math.sin(angle)*ring1R;
      const pastRing1 = front >= ring1R, hasHops = hops.length > 0;
      if (!pastRing1 && !hasHops) {
        const pre: number[][] = [[cx, cy]];
        this._subdivSeg(cx, cy, ex, ey, chaos, depth, pre);
        this._strokePath(pre, h, fullAlpha * 0.38, fullWidth * 0.40, flicker);
        return;
      }
      const preT = hasHops ? [hops[0].x, hops[0].y] : [ring1x, ring1y];
      const pre: number[][] = [[cx, cy]];
      this._subdivSeg(cx, cy, preT[0], preT[1], chaos, depth, pre);
      this._strokePath(pre, h, fullAlpha * 0.38, fullWidth * 0.40, flicker);
      const postStart = hasHops ? [hops[0].x, hops[0].y] : [ring1x, ring1y];
      const post: number[][] = [postStart];
      const remaining = hasHops ? [...hops.slice(1).map(hop => [hop.x, hop.y]), [ex, ey]] : [[ex, ey]];
      let px = postStart[0], py = postStart[1];
      for (const [nx, ny] of remaining) { this._subdivSeg(px, py, nx, ny, chaos, depth, post); px = nx; py = ny; }
      this._strokePath(post, h, fullAlpha, fullWidth, flicker);
    };

    for (const [midi] of this._activeNotes) drawBolt(midi, this._hueOf(midi), 1.0, 1);

    // Intersection ripples
    const minD = ring1R * 0.25, minSin = 0.28;
    for (let a = 0; a < boltData.length-1; a++) {
      for (let b = a+1; b < boltData.length; b++) {
        const mA = boltData[a].midi, mB = boltData[b].midi;
        const key = Math.min(mA,mB) + '-' + Math.max(mA,mB);
        if (this._folActiveCrossings.has(key)) continue;
        const wA = boltData[a].wps, wB = boltData[b].wps;
        outer: for (let i = 0; i < wA.length-1; i++) {
          for (let j = 0; j < wB.length-1; j++) {
            const pt = this._segIntersect(wA[i][0],wA[i][1],wA[i+1][0],wA[i+1][1], wB[j][0],wB[j][1],wB[j+1][0],wB[j+1][1]);
            if (!pt || Math.hypot(pt.x-cx, pt.y-cy) < minD) continue;
            const dxA=wA[i+1][0]-wA[i][0], dyA=wA[i+1][1]-wA[i][1];
            const dxB=wB[j+1][0]-wB[j][0], dyB=wB[j+1][1]-wB[j][1];
            const sinA = Math.abs(dxA*dyB - dyA*dxB) / (Math.hypot(dxA,dyA) * Math.hypot(dxB,dyB));
            if (sinA < minSin) continue;
            this._folCrossRipples.push({ x: pt.x, y: pt.y, startTime: now, h: (boltData[a].h + boltData[b].h) / 2 });
            this._folActiveCrossings.add(key);
            break outer;
          }
        }
      }
    }
  }

  private _drawPlasmaArc(): void {
    if (!this._activeNotes.size) return;
    const { ctx } = this;
    const now    = performance.now();
    const cx     = this._width / 2, cy = this._height / 2;
    const boundR = this._boundR(), beatMs = this._beatMs();
    for (const [midi] of this._activeNotes) {
      const state = this._folNoteState.get(midi);
      if (!state?.strikeTimes.length) continue;
      const fi      = this._fi(midi), h = this._hueOf(midi);
      const age     = now - state.strikeTimes.at(-1)!;
      const reach   = Math.min(age / (beatMs * 0.5), 1);
      if (reach < 0.55) continue;
      const intensity    = Math.pow((reach - 0.55) / 0.45, 1.4);
      const contactAngle = (fi / 12) * Math.PI * 2 - Math.PI / 2;
      const flicker      = (0.55+0.45*Math.sin(now/41+midi*1.9)) * (0.75+0.25*Math.sin(now/19+fi*2.7));
      const maxSpread    = (0.55 + 0.20 * Math.sin(now/310 + midi*0.7)) * intensity;
      ctx.save(); ctx.lineCap = 'round';
      for (const l of [
        { s: 1.00, w: 28, a: 0.07 }, { s: 0.72, w: 12, a: 0.16 },
        { s: 0.45, w:  5, a: 0.38 }, { s: 0.22, w:  2, a: 0.72 },
        { s: 0.06, w:  3, a: 0.95 },
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, boundR, contactAngle - maxSpread*l.s, contactAngle + maxSpread*l.s);
        ctx.strokeStyle = l.s < 0.1
          ? `rgba(255,255,255,${intensity * flicker * l.a})`
          : `hsla(${h},88%,72%,${intensity * flicker * l.a})`;
        ctx.lineWidth = l.w; ctx.stroke();
      }
      ctx.restore();
    }
  }

  private _drawRipples(): void {
    const { ctx } = this;
    const now = performance.now();
    for (let i = this._folCrossRipples.length-1; i >= 0; i--) {
      const cr  = this._folCrossRipples[i];
      const age = now - cr.startTime;
      if (age > 900) { this._folCrossRipples.splice(i, 1); continue; }
      const t = age / 900;
      const r = t * this._baseR() * 0.75;
      const a = Math.pow(1 - t, 1.8) * 0.75;
      ctx.beginPath(); ctx.arc(cr.x, cr.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${cr.h},90%,88%,${a})`;
      ctx.lineWidth   = 2.2;
      ctx.shadowColor = `hsla(${cr.h},90%,80%,${a * 0.6})`;
      ctx.shadowBlur  = 12; ctx.stroke(); ctx.shadowBlur = 0;
    }
  }

  private _drawCenterGlow(): void {
    if (!this._activeNotes.size) return;
    const { ctx } = this;
    const cx = this._width / 2, cy = this._height / 2;
    const r  = 60 + this._activeNotes.size * 20;
    const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `hsla(${this._hue},80%,55%,${Math.min(this._activeNotes.size * 0.13, 0.4)})`);
    g.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fillStyle = g; ctx.fill();
  }

  private _drawPolygon(): void {
    if (this._activeNotes.size < 2) return;
    const { ctx } = this;
    const pos = [...this._activeNotes.keys()].map(m => this._notePos(m));
    ctx.strokeStyle = `hsla(${this._hue},85%,65%,0.22)`; ctx.lineWidth = 1.2;
    for (let i = 0; i < pos.length; i++)
      for (let j = i+1; j < pos.length; j++) {
        ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
      }
  }

  private _drawActiveNotes(): void {
    const { ctx } = this;
    const now = performance.now();
    for (const [midi, note] of this._activeNotes) {
      const pos   = this._notePos(midi);
      const pulse = Math.sin((now - note.startTime) / 180) * 3;
      const h     = this._hueOf(midi);
      ctx.shadowColor = `hsl(${h},90%,70%)`; ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 9 + pulse, 0, Math.PI*2);
      ctx.fillStyle = `hsl(${h},90%,68%)`; ctx.fill(); ctx.shadowBlur = 0;
    }
  }

  private _drawParticles(): void {
    const { ctx } = this;
    for (let i = this._particles.length-1; i >= 0; i--) {
      const p = this._particles[i];
      if (p.type === 'burst-ring' || p.type === 'ring') {
        p.r += p.speed;
        p.alpha -= p.type === 'burst-ring' ? 0.012 : 0.018;
        if (p.alpha <= 0 || p.r >= p.maxR) { this._particles.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.strokeStyle = `hsla(${p.h},90%,70%,${p.alpha})`;
        ctx.lineWidth = p.lineWidth ?? 1.5; ctx.stroke();
      } else {
        p.x += p.vx ?? 0; p.y += p.vy ?? 0;
        if (p.vx !== undefined) p.vx *= 0.94;
        if (p.vy !== undefined) p.vy *= 0.94;
        p.alpha -= p.decay ?? 0.025;
        if (p.alpha <= 0) { this._particles.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.fillStyle = `hsla(${p.h},90%,70%,${p.alpha})`; ctx.fill();
      }
    }
  }
}
