import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { JackPosition, PatchCursor } from '../types';
import { getModuleDef } from '../config/modules';

// ─────────────────────────────────────────────────────────────
// PatchSystem — jack registration, cable drawing, patch interaction.
// Ported from midigame/synth-ui.js sections S9–S10.
//
// jackRegistry is a persistent Map (not rebuilt per frame).
// Cable drawing reads from registry.patches + jackRegistry.
// ─────────────────────────────────────────────────────────────

export class PatchSystem {
  private registry: ModuleRegistry;
  private canvas:   HTMLCanvasElement | null = null;
  private ctx:      CanvasRenderingContext2D | null = null;

  readonly jackRegistry = new Map<string, JackPosition>();
  patchCursor: PatchCursor | null = null;

  private _mouseX = 0;
  private _mouseY = 0;
  private _cablePhysics = new Map<string, { px: number; py: number }>();

  constructor(registry: ModuleRegistry) {
    this.registry = registry;
    this.registry.on('module-removed', ({ id }) => this._deregisterJacks(id));
    this.registry.on('patch-changed',  ()       => this._refreshJackPluggedState());
  }

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    // Track mouse globally (canvas has pointer-events:none so we use window)
    window.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this._mouseX = e.clientX - r.left;
      this._mouseY = e.clientY - r.top;
    });
    // Cancel patch on Escape or click on empty background (02-02)
    window.addEventListener('keydown', e => { if (e.key === 'Escape') this.patchCursor = null; });
    window.addEventListener('pointerdown', e => {
      if (!this.patchCursor) return;
      const target = e.target as HTMLElement;
      // Don't cancel if clicking a jack (handled by handleJackPointerDown) or a panel (handled by handleModuleClick)
      if (target.closest('.port-jack') || target.closest('.panel-box')) return;
      this.patchCursor = null;
    });
  }

  // ── Jack registration ────────────────────────────────────────

  registerJack(modId: string, port: string, isOut: boolean, el: Element): void {
    const def  = getModuleDef(this.registry.modules.get(modId)?.type ?? '');
    const rect = el.getBoundingClientRect();
    const canvasRect = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const x = rect.left + rect.width / 2  - canvasRect.left;
    const y = rect.top  + rect.height / 2 - canvasRect.top;
    const id = `${isOut ? 'out' : 'in'}-${modId}-${port}`;
    const isNote = port.startsWith('note-out') || port.startsWith('note-in');
    const isSend = port.startsWith('send-') || port.startsWith('return-');
    const plugged = isOut
      ? this.registry.patchesFrom(modId).some(p => p.fromPort === port)
      : this.registry.patchesTo(modId).some(p => p.toPort === port);
    this.jackRegistry.set(id, {
      id, modId, port, x, y, h: def?.hue ?? 200,
      isOut, isEmpty: false, isNote, isSend, plugged, alpha: 0.88,
    });
  }

  updateJackPositions(modId: string): void {
    // Re-read DOM positions for all jacks belonging to modId
    for (const [jackId, jack] of this.jackRegistry) {
      if (jack.modId !== modId) continue;
      const selector = `[data-module="${modId}"][data-port="${jack.port}"].${jack.isOut ? 'port-out' : 'port-in'}`;
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const cr   = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
      jack.x = rect.left + rect.width  / 2 - cr.left;
      jack.y = rect.top  + rect.height / 2 - cr.top;
    }
  }

  private _deregisterJacks(modId: string): void {
    for (const id of this.jackRegistry.keys()) {
      if (id.includes(`-${modId}-`)) this.jackRegistry.delete(id);
    }
  }

  private _refreshJackPluggedState(): void {
    for (const [, jack] of this.jackRegistry) {
      jack.plugged = jack.isOut
        ? this.registry.patchesFrom(jack.modId).some(p => p.fromPort === jack.port)
        : this.registry.patchesTo(jack.modId).some(p => p.toPort === jack.port);
    }
    // Prune physics entries for patches that no longer exist
    const activeKeys = new Set(this.registry.patches.map(
      p => `${p.fromId}-${p.fromPort}-${p.toId}-${p.toPort}`
    ));
    for (const key of this._cablePhysics.keys()) {
      if (!activeKeys.has(key)) this._cablePhysics.delete(key);
    }
  }

  // ── Interaction (called by UIRenderer jack DOM events) ───────

  /**
   * Called when a jack DOM element receives pointerdown.
   * Starts a patch from an output jack, or completes to an input jack.
   * Right-click on any jack removes all its cables.
   */
  handleJackPointerDown(modId: string, port: string, isOut: boolean, e: PointerEvent): void {
    e.stopPropagation();
    e.preventDefault();

    // Right-click: remove all patches from/to this jack
    if (e.button === 2) {
      if (isOut) this.registry.removePatchesFrom(modId, port);
      else       this.registry.removePatchesTo(modId, port);
      this.patchCursor = null;
      return;
    }
    if (e.button !== 0) return;

    const jackId = `${isOut ? 'out' : 'in'}-${modId}-${port}`;
    const jack   = this.jackRegistry.get(jackId);
    if (!jack) return;

    if (!this.patchCursor) {
      if (!isOut) {
        // 02-03: grab from input end — lift the connected cable if one exists
        const existing = this.registry.patchesTo(modId).find(p => p.toPort === port);
        if (!existing) return;
        const fromJack = this.jackRegistry.get(`out-${existing.fromId}-${existing.fromPort}`);
        if (!fromJack) return;
        this.registry.removePatch(existing.fromId, existing.fromPort, existing.toId, existing.toPort);
        this.patchCursor = {
          fromId:     existing.fromId,
          fromPort:   existing.fromPort,
          signalType: fromJack.isNote ? 'note' : fromJack.isSend ? 'send' : 'audio',
          fromJack:   { x: fromJack.x, y: fromJack.y, h: fromJack.h },
        };
        return;
      }
      const existing = this.registry.patchesFromPort(modId, port)[0];
      if (existing) {
        // Grab output end of a connected cable — anchor at its input, find a new output
        const toJack = this.jackRegistry.get(`in-${existing.toId}-${existing.toPort}`);
        this.registry.removePatch(existing.fromId, existing.fromPort, existing.toId, existing.toPort);
        if (toJack) {
          this.patchCursor = {
            fromId: existing.toId, fromPort: existing.toPort,
            signalType: jack.isNote ? 'note' : jack.isSend ? 'send' : 'audio',
            fromJack: { x: toJack.x, y: toJack.y, h: toJack.h },
            reverse: true, toId: existing.toId, toPort: existing.toPort,
          };
          return;
        }
      }
      this.patchCursor = {
        fromId:     modId,
        fromPort:   port,
        signalType: jack.isNote ? 'note' : jack.isSend ? 'send' : 'audio',
        fromJack:   { x: jack.x, y: jack.y, h: jack.h },
      };
    } else {
      if (isOut) {
        if (this.patchCursor.reverse) {
          // Complete reverse patch: clicked output → addPatch(output → anchored input)
          this.registry.addPatch(modId, port, this.patchCursor.toId!, this.patchCursor.toPort!);
          this.patchCursor = null;
        } else {
          this.patchCursor = null; // clicked another output in forward mode: cancel
        }
        return;
      }
      this.registry.addPatch(this.patchCursor.fromId, this.patchCursor.fromPort, modId, port);
      this.patchCursor = null;
    }
  }

  // 02-01: snap cable to first open compatible port on a module
  handleModuleClick(modId: string, e: PointerEvent): void {
    if (!this.patchCursor) return;
    const { signalType, fromId, reverse, toId, toPort } = this.patchCursor;
    for (const jack of this.jackRegistry.values()) {
      if (jack.modId !== modId || jack.modId === fromId) continue;
      if (reverse ? !jack.isOut : jack.isOut) continue;
      if (!reverse && jack.plugged) continue;
      const jSig    = jack.isNote ? 'note' : 'audio';
      const curSig  = signalType === 'send' ? 'audio' : signalType;
      if (jSig !== curSig) continue;
      if (reverse) {
        this.registry.addPatch(modId, jack.port, toId!, toPort!);
      } else {
        this.registry.addPatch(this.patchCursor.fromId, this.patchCursor.fromPort, modId, jack.port);
      }
      this.patchCursor = null;
      e.stopPropagation();
      return;
    }
  }

  // ── Drawing (called every rAF) ────────────────────────────────

  draw(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawAllCables();
    if (this.patchCursor) this._drawCompatibleHighlights();
    this._drawCursor();
  }

  private _drawAllCables(): void {
    const ctx = this.ctx!;
    for (const p of this.registry.patches) {
      const fromJ = this.jackRegistry.get(`out-${p.fromId}-${p.fromPort}`);
      const toJ   = this.jackRegistry.get(`in-${p.toId}-${p.toPort}`);
      if (!fromJ || !toJ) continue;
      const key  = `${p.fromId}-${p.fromPort}-${p.toId}-${p.toPort}`;
      const phys = this._getPhys(key, (fromJ.x + toJ.x) / 2, (fromJ.y + toJ.y) / 2);

      if (p.signalType === 'note') {
        drawNoteCable(ctx, fromJ.x, fromJ.y, toJ.x, toJ.y, phys.px, phys.py);
      } else if (p.signalType === 'send') {
        drawAudioCable(ctx, fromJ.x, fromJ.y, toJ.x, toJ.y, 25, phys.px, phys.py);
      } else {
        drawAudioCable(ctx, fromJ.x, fromJ.y, toJ.x, toJ.y, 0, phys.px, phys.py);
      }
    }
  }

  private _drawCursor(): void {
    if (!this.patchCursor) return;
    const ctx = this.ctx!;
    const { fromJack, signalType, fromId } = this.patchCursor;
    if (signalType === 'note') {
      drawNoteCable(ctx, fromJack.x, fromJack.y, this._mouseX, this._mouseY, 0, 0);
    } else if (signalType === 'send') {
      drawAudioCable(ctx, fromJack.x, fromJack.y, this._mouseX, this._mouseY, 25, 0, 0);
    } else {
      drawAudioCable(ctx, fromJack.x, fromJack.y, this._mouseX, this._mouseY, 0, 0, 0);
    }
  }

  private _drawCompatibleHighlights(): void {
    if (!this.patchCursor) return;
    const ctx = this.ctx!;
    const { signalType, fromId, fromJack } = this.patchCursor;
    const t = performance.now();
    const pulse = 0.55 + Math.sin(t / 160) * 0.3;
    ctx.save();
    // Source circle
    ctx.beginPath(); ctx.arc(fromJack.x, fromJack.y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = signalType === 'note'
      ? `rgba(255,210,80,${pulse * 0.6})`
      : signalType === 'send'
        ? `hsla(25,85%,62%,${pulse * 0.6})`
        : `hsla(0,85%,62%,${pulse * 0.6})`;
    ctx.lineWidth = 1.5; ctx.stroke();
    // Destination highlights — outputs when reverse, inputs when forward
    const { reverse } = this.patchCursor;
    for (const jack of this.jackRegistry.values()) {
      if (reverse ? !jack.isOut : jack.isOut) continue;
      if (jack.modId === fromId) continue;
      const jSig   = jack.isNote ? 'note' : 'audio';
      const curSig = signalType === 'send' ? 'audio' : signalType;
      if (jSig !== curSig) continue;
      if (!reverse && jack.plugged) continue; // inputs: skip already-connected
      ctx.beginPath(); ctx.rect(jack.x - 11, jack.y - 11, 22, 22);
      ctx.strokeStyle = `rgba(255,235,40,${pulse})`; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }

  private _getPhys(key: string, midX: number, midY: number): { px: number; py: number } {
    if (!this._cablePhysics.has(key)) this._cablePhysics.set(key, { px: 0, py: 0 });
    const phys = this._cablePhysics.get(key)!;
    const INFL = 140, MAX_PUSH = 44;
    const dx = this._mouseX - midX, dy = this._mouseY - midY, d = Math.hypot(dx, dy);
    let tx = 0, ty = 0;
    if (d < INFL && d > 0) { const s = (1 - d / INFL) * MAX_PUSH; tx = dx / d * s; ty = dy / d * s; }
    phys.px += (tx - phys.px) * 0.15;
    phys.py += (ty - phys.py) * 0.15;
    return phys;
  }
}

// ─────────────────────────────────────────────────────────────
// Cable draw functions (ported from midigame/app.js)
// ─────────────────────────────────────────────────────────────

function _bezier(c: CanvasRenderingContext2D, sx: number, sy: number, ex: number, ey: number, sag: number, px: number, py: number, bow = 0) {
  const horiz = Math.abs(ex - sx) > Math.abs(ey - sy);
  let cp1x, cp1y, cp2x, cp2y;
  if (horiz) {
    cp1x = sx + (ex - sx) * 0.25 + px * 0.4; cp1y = sy + sag + py * 0.4;
    cp2x = sx + (ex - sx) * 0.75 + px * 0.4; cp2y = ey + sag + py * 0.4;
  } else {
    const b = bow || Math.max(10, Math.hypot(ex - sx, ey - sy) * 0.14);
    cp1x = sx + b + px * 0.4; cp1y = sy + (ey - sy) * 0.38 + py * 0.4;
    cp2x = ex + b + px * 0.4; cp2y = sy + (ey - sy) * 0.62 + py * 0.4;
  }
  c.moveTo(sx, sy); c.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
}

export function drawAudioCable(c: CanvasRenderingContext2D, sx: number, sy: number, ex: number, ey: number, hue: number, px: number, py: number): void {
  const dist = Math.hypot(ex - sx, ey - sy);
  const sag  = Math.max(14, Math.min(dist * 0.22, 55));
  c.save(); c.lineCap = 'round';
  c.beginPath(); _bezier(c, sx, sy, ex, ey, sag, px, py);
  c.strokeStyle = `hsla(${hue},85%,58%,0.18)`; c.lineWidth = 4.5; c.stroke();
  c.beginPath(); _bezier(c, sx, sy, ex, ey, sag, px, py);
  c.setLineDash([5, 4]); c.strokeStyle = `hsla(${hue},90%,68%,0.88)`; c.lineWidth = 1.4; c.stroke();
  c.setLineDash([]); c.restore();
}

export function drawNoteCable(c: CanvasRenderingContext2D, sx: number, sy: number, ex: number, ey: number, px: number, py: number): void {
  const dist = Math.hypot(ex - sx, ey - sy);
  const sag  = Math.max(12, Math.min(dist * 0.22, 50));
  c.save(); c.lineCap = 'round';
  c.beginPath(); _bezier(c, sx, sy, ex, ey, sag, px, py);
  c.strokeStyle = 'rgba(255,200,80,0.15)'; c.lineWidth = 4; c.stroke();
  c.beginPath(); _bezier(c, sx, sy, ex, ey, sag, px, py);
  c.setLineDash([4, 4]); c.strokeStyle = 'rgba(255,210,90,0.9)'; c.lineWidth = 1.2; c.stroke();
  c.setLineDash([]); c.restore();
}
