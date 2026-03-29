import type { NoteRouter } from './NoteRouter';
import { NOTE_NAMES, ENHARMONIC } from '../config/helpers';

export type KbMode = 'piano' | 'circle' | 'hex';

// ─────────────────────────────────────────────────────────────
// OnscreenKeyboard
//
// Two modes:
//   circle — 12 nodes at the same positions as the flower-of-life
//             ring-1 nodes; pitch-class layout follows the same
//             fi = (pc * 7) % 12 mapping (circle of fifths).
//   hex    — Wicki-Hayden isomorphic layout on a pointy-top hex
//             grid. Moving right: +2 semitones. Moving up-right:
//             +7 semitones (perfect fifth).
//
// Canvas (#kc) always has pointer-events:none.
// Input is handled via capture-phase window listeners so the
// keyboard and patch-cable dragging can coexist: if a note is
// hit, the event is consumed before PatchSystem sees it.
// ─────────────────────────────────────────────────────────────

export class OnscreenKeyboard {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private router: NoteRouter;
  private _ensureAudio: () => void;

  mode:    KbMode = 'piano';
  octave:  number = 4;     // base octave — C4 = MIDI 60
  rootKey: string = 'C';   // hex mode: note at grid centre

  private _w = 0;
  private _h = 0;
  private _visible = false;

  /** All currently sounding notes from any source (subscribed from router). */
  private _activeNotes = new Set<number>();
  /** touch identifier → midi note being held by that touch */
  private _touches = new Map<number, number>();
  /** mouse note being held */
  private _mouseNote: number | null = null;

  constructor(router: NoteRouter, ensureAudio: () => void = () => {}) {
    this.router = router;
    this._ensureAudio = ensureAudio;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'kc';
    this.canvas.style.cssText =
      'position:fixed;top:0;left:0;pointer-events:none;z-index:150;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Track all note activity so highlights match reality
    router.onNoteOn(e  => { this._activeNotes.add(e.midi);    this._draw(); });
    router.onNoteOff(e => { this._activeNotes.delete(e.midi); this._draw(); });

    this._initEvents();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  resize(w: number, h: number): void {
    this.canvas.width  = w;
    this.canvas.height = h;
    this._w = w; this._h = h;
    this._draw();
  }

  get visible(): boolean { return this._visible; }

  show(): void { this._visible = true;  this._draw(); }

  hide(): void {
    this._visible = false;
    this.ctx.clearRect(0, 0, this._w, this._h);
    // Release any notes triggered via the keyboard
    for (const [, midi] of this._touches) this.router.noteOff(midi, null);
    this._touches.clear();
    if (this._mouseNote !== null) { this.router.noteOff(this._mouseNote, null); this._mouseNote = null; }
  }

  setMode(m: KbMode): void   { this.mode = m;   this._draw(); }
  setOctave(o: number): void { this.octave = o; this._draw(); }

  // ── Geometry ──────────────────────────────────────────────────────

  /** Replicates VisualEngine's _nodePos formula exactly. */
  private _circleNodePos(fi: number): { x: number; y: number } {
    const cx = this._w / 2, cy = this._h / 2;
    const boundR = Math.min(this._w / 2 - 20, this._h / 2 - 60);
    const baseR  = boundR / 3;
    const angle  = (fi / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * baseR, y: cy + Math.sin(angle) * baseR };
  }

  private _circleNodes(): Array<{ x: number; y: number; midi: number; pc: number; fi: number }> {
    const out = [];
    for (let fi = 0; fi < 12; fi++) {
      const pc   = (fi * 7) % 12;
      const midi = this.octave * 12 + pc;
      const { x, y } = this._circleNodePos(fi);
      out.push({ x, y, midi, pc, fi });
    }
    return out;
  }

  private _hexSize(): number {
    return Math.min(36, this._w / 18, this._h / 14);
  }

  private _hexPos(q: number, r: number): { x: number; y: number } {
    const cx = this._w / 2, cy = this._h / 2, s = this._hexSize();
    return {
      x: cx + s * Math.sqrt(3) * (q + r / 2),
      y: cy - s * 1.5 * r,
    };
  }

  private _hexMidi(q: number, r: number): number {
    const name   = ENHARMONIC[this.rootKey] ?? this.rootKey;
    const rootPc = NOTE_NAMES.indexOf(name as typeof NOTE_NAMES[number]);
    const root   = this.octave * 12 + (rootPc >= 0 ? rootPc : 0);
    return root + 2 * q + 7 * r;
  }

  // ── Drawing ───────────────────────────────────────────────────────

  private _draw(): void {
    if (!this._visible) return;
    this.ctx.clearRect(0, 0, this._w, this._h);
    if      (this.mode === 'piano')  this._drawPiano();
    else if (this.mode === 'circle') this._drawCircle();
    else                             this._drawHex();
  }

  private _drawCircle(): void {
    const { ctx } = this;
    const HIT = 22;
    for (const { x, y, midi, pc } of this._circleNodes()) {
      const active = this._activeNotes.has(midi);
      const hue    = ((pc * 7) % 12) * 30;

      ctx.beginPath(); ctx.arc(x, y, HIT, 0, Math.PI * 2);
      ctx.fillStyle   = active ? `hsla(${hue},72%,52%,0.45)` : 'rgba(255,255,255,0.04)';
      ctx.fill();
      ctx.strokeStyle = active ? `hsla(${hue},80%,70%,0.95)` : 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = active ? 2 : 1;
      ctx.stroke();

      ctx.fillStyle    = active ? `hsl(${hue},85%,82%)` : 'rgba(255,255,255,0.45)';
      ctx.font         = `${active ? 'bold ' : ''}10px "Courier New",monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(NOTE_NAMES[pc], x, y);
    }
  }

  private _drawHex(): void {
    const { ctx } = this;
    const s     = this._hexSize();
    const qSpan = Math.ceil(this._w  / (s * Math.sqrt(3))) + 2;
    const rSpan = Math.ceil(this._h  / (s * 1.5))          + 2;

    for (let r = -rSpan; r <= rSpan; r++) {
      for (let q = -qSpan; q <= qSpan; q++) {
        const midi = this._hexMidi(q, r);
        if (midi < 0 || midi > 127) continue;

        const { x, y } = this._hexPos(q, r);
        if (x < -s * 2 || x > this._w + s * 2) continue;
        if (y < -s * 2 || y > this._h + s * 2) continue;

        const pc     = ((midi % 12) + 12) % 12;
        const hue    = ((pc * 7) % 12) * 30;
        const active = this._activeNotes.has(midi);
        const isRoot = (q === 0 && r === 0);

        // Hex shape
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a  = Math.PI / 6 + (i / 6) * Math.PI * 2; // pointy-top
          const hx = x + s * 0.88 * Math.cos(a);
          const hy = y + s * 0.88 * Math.sin(a);
          i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
        }
        ctx.closePath();

        if (active) {
          ctx.fillStyle = `hsla(${hue},70%,50%,0.75)`;
        } else if (isRoot) {
          ctx.fillStyle = `hsla(${hue},40%,26%,0.75)`;
        } else {
          ctx.fillStyle = `hsla(${hue},25%,16%,0.65)`;
        }
        ctx.fill();
        ctx.strokeStyle = active  ? `hsla(${hue},80%,70%,0.95)`
                        : isRoot  ? `hsla(${hue},60%,55%,0.6)`
                        : 'rgba(255,255,255,0.1)';
        ctx.lineWidth   = active || isRoot ? 1.5 : 0.7;
        ctx.stroke();

        // Labels
        const labelSize = Math.max(8, Math.round(s * 0.28));
        ctx.fillStyle    = active ? `hsl(${hue},80%,88%)` : 'rgba(255,255,255,0.55)';
        ctx.font         = `${active ? 'bold ' : ''}${labelSize}px "Courier New",monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(NOTE_NAMES[pc], x, y - s * 0.12);

        const octNum = Math.floor(midi / 12) - 1;
        ctx.font      = `${Math.max(6, Math.round(s * 0.2))}px "Courier New",monospace`;
        ctx.fillStyle = active ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
        ctx.fillText(String(octNum), x, y + s * 0.26);
      }
    }
  }

  // ── Piano layout helpers ──────────────────────────────────────

  // Semitones within an octave that are white keys
  private static readonly WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
  // Black key semitone → index into white keys it sits between (left white key index)
  private static readonly BLACK_PCS: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

  /** Layout constants for the 2-octave piano strip. */
  private _pianoLayout(): { x0: number; y0: number; ww: number; wh: number; bw: number; bh: number; octaves: number } {
    const octaves = 2;
    const totalWhite = 7 * octaves;
    const maxW = Math.min(this._w * 0.88, 640);
    const ww   = Math.floor(maxW / totalWhite);
    const wh   = Math.min(120, this._h * 0.22);
    const bw   = Math.round(ww * 0.58);
    const bh   = Math.round(wh * 0.62);
    const x0   = Math.round((this._w - ww * totalWhite) / 2);
    const y0   = this._h - wh - 56; // sit above the game-controls bar
    return { x0, y0, ww, wh, bw, bh, octaves };
  }

  private _drawPiano(): void {
    const { ctx } = this;
    const { x0, y0, ww, wh, bw, bh, octaves } = this._pianoLayout();
    const WHITE = OnscreenKeyboard.WHITE_PCS;
    const BLACK = OnscreenKeyboard.BLACK_PCS;

    // Draw white keys first
    for (let oct = 0; oct < octaves; oct++) {
      const baseNote = (this.octave + oct) * 12;
      for (let wi = 0; wi < 7; wi++) {
        const pc   = WHITE[wi];
        const midi = baseNote + pc;
        const x    = x0 + (oct * 7 + wi) * ww;
        const active = this._activeNotes.has(midi);
        const hue    = ((pc * 7) % 12) * 30;

        ctx.beginPath();
        ctx.roundRect(x + 1, y0, ww - 2, wh, [0, 0, 4, 4]);
        ctx.fillStyle   = active ? `hsla(${hue},70%,70%,0.9)` : 'rgba(230,230,240,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth   = 1;
        ctx.stroke();

        if (active) {
          ctx.fillStyle = `hsla(${hue},80%,55%,0.4)`;
          ctx.fill();
        }

        // Note label on bottom of key
        ctx.fillStyle    = active ? `hsl(${hue},85%,25%)` : 'rgba(0,0,0,0.4)';
        ctx.font         = `${active ? 'bold ' : ''}9px "Courier New",monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(NOTE_NAMES[pc], x + ww / 2, y0 + wh - 4);
      }
    }

    // Draw black keys on top
    for (let oct = 0; oct < octaves; oct++) {
      const baseNote = (this.octave + oct) * 12;
      for (const [pcStr, leftWi] of Object.entries(BLACK)) {
        const pc     = Number(pcStr);
        const midi   = baseNote + pc;
        const wi     = oct * 7 + leftWi;
        const x      = x0 + wi * ww + ww - Math.round(bw / 2);
        const active = this._activeNotes.has(midi);
        const hue    = ((pc * 7) % 12) * 30;

        ctx.beginPath();
        ctx.roundRect(x, y0, bw, bh, [0, 0, 3, 3]);
        ctx.fillStyle   = active ? `hsl(${hue},72%,42%)` : 'rgba(18,18,24,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth   = 1;
        ctx.stroke();

        if (active) {
          ctx.fillStyle = `hsla(${hue},80%,60%,0.5)`;
          ctx.fill();
        }
      }
    }

    // Octave labels
    const { y0: py0, ww: pww } = this._pianoLayout();
    for (let oct = 0; oct < octaves; oct++) {
      ctx.fillStyle    = 'rgba(0,0,0,0.3)';
      ctx.font         = '8px "Courier New",monospace';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`C${this.octave + oct}`, x0 + oct * 7 * pww + 2, py0 + 2);
    }
  }

  // ── Hit testing ───────────────────────────────────────────────────

  hitTest(px: number, py: number): number | null {
    if (this.mode === 'piano')  return this._hitPiano(px, py);
    if (this.mode === 'circle') return this._hitCircle(px, py);
    return this._hitHex(px, py);
  }

  private _hitPiano(px: number, py: number): number | null {
    const { x0, y0, ww, wh, bw, bh, octaves } = this._pianoLayout();
    const WHITE = OnscreenKeyboard.WHITE_PCS;
    const BLACK = OnscreenKeyboard.BLACK_PCS;

    // Check black keys first (drawn on top)
    for (let oct = 0; oct < octaves; oct++) {
      const baseNote = (this.octave + oct) * 12;
      for (const [pcStr, leftWi] of Object.entries(BLACK)) {
        const pc = Number(pcStr);
        const wi = oct * 7 + leftWi;
        const x  = x0 + wi * ww + ww - Math.round(bw / 2);
        if (px >= x && px <= x + bw && py >= y0 && py <= y0 + bh) {
          return baseNote + pc;
        }
      }
    }

    // Check white keys
    for (let oct = 0; oct < octaves; oct++) {
      const baseNote = (this.octave + oct) * 12;
      for (let wi = 0; wi < 7; wi++) {
        const x = x0 + (oct * 7 + wi) * ww;
        if (px >= x && px <= x + ww && py >= y0 && py <= y0 + wh) {
          return baseNote + WHITE[wi];
        }
      }
    }

    return null;
  }

  private _hitCircle(px: number, py: number): number | null {
    const HIT = 22;
    for (const { x, y, midi } of this._circleNodes()) {
      const dx = px - x, dy = py - y;
      if (dx * dx + dy * dy <= HIT * HIT) return midi;
    }
    return null;
  }

  private _hitHex(px: number, py: number): number | null {
    const cx = this._w / 2, cy = this._h / 2, s = this._hexSize();
    // Fractional axial coordinates for pointy-top hex
    const fr = (cy - py) / (s * 1.5);
    const fq = (px - cx) / (s * Math.sqrt(3)) - fr / 2;
    // Cube-coordinate rounding (correct hex nearest-cell algorithm)
    const fy  = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr), yc = Math.round(fy);
    const dq = Math.abs(fq - q), dr = Math.abs(fr - r), dy = Math.abs(fy - yc);
    if      (dq > dr && dq > dy) q = -r - yc;
    else if (dr > dy)            r = -q - yc;
    const midi = this._hexMidi(q, r);
    return (midi >= 0 && midi <= 127) ? midi : null;
  }

  // ── Event handling ────────────────────────────────────────────────

  private _noteOn(midi: number): void  { this._ensureAudio(); this.router.noteOn(midi, 100, null); }
  private _noteOff(midi: number): void { this.router.noteOff(midi, null); }

  private _initEvents(): void {
    // Capture phase — fires before PatchSystem sees events.
    // Only consume the event if the keyboard is visible AND a note was hit.
    window.addEventListener('mousedown', e => {
      if (!this._visible || e.button !== 0) return;
      const midi = this.hitTest(e.clientX, e.clientY);
      if (midi === null) return;
      e.stopPropagation();
      this._mouseNote = midi;
      this._noteOn(midi);
    }, true);

    window.addEventListener('mousemove', e => {
      if (!this._visible || this._mouseNote === null || e.buttons !== 1) return;
      const midi = this.hitTest(e.clientX, e.clientY);
      if (midi !== null && midi !== this._mouseNote) {
        this._noteOff(this._mouseNote);
        this._mouseNote = midi;
        this._noteOn(midi);
      }
    }, true);

    window.addEventListener('mouseup', () => {
      if (this._mouseNote !== null) {
        this._noteOff(this._mouseNote);
        this._mouseNote = null;
      }
    }, true);

    window.addEventListener('touchstart', e => {
      if (!this._visible) return;
      let consumed = false;
      for (const t of Array.from(e.changedTouches)) {
        const midi = this.hitTest(t.clientX, t.clientY);
        if (midi !== null && !this._touches.has(t.identifier)) {
          this._touches.set(t.identifier, midi);
          this._noteOn(midi);
          consumed = true;
        }
      }
      if (consumed) e.preventDefault();
    }, { capture: true, passive: false });

    window.addEventListener('touchmove', e => {
      if (!this._visible) return;
      let consumed = false;
      for (const t of Array.from(e.changedTouches)) {
        const oldMidi = this._touches.get(t.identifier);
        if (oldMidi === undefined) continue;
        const newMidi = this.hitTest(t.clientX, t.clientY);
        if (newMidi !== null && newMidi !== oldMidi) {
          this._noteOff(oldMidi);
          this._touches.set(t.identifier, newMidi);
          this._noteOn(newMidi);
        }
        consumed = true;
      }
      if (consumed) e.preventDefault();
    }, { capture: true, passive: false });

    const endTouch = (e: TouchEvent) => {
      if (!this._visible) return;
      for (const t of Array.from(e.changedTouches)) {
        const midi = this._touches.get(t.identifier);
        if (midi !== undefined) { this._noteOff(midi); this._touches.delete(t.identifier); }
      }
    };
    window.addEventListener('touchend',    endTouch, { capture: true });
    window.addEventListener('touchcancel', endTouch, { capture: true });
  }
}
