import type { ModuleRegistry } from '../core/ModuleRegistry';
import { getModuleDef } from '../config/modules';

// ─────────────────────────────────────────────────────────────
// MidiLearnSystem — maps MIDI CC numbers to synth knob params.
//
// Flow:
//   1. User clicks LEARN button → toggle() → active = true
//   2. User clicks a synth knob → UIRenderer dispatches 'midi-learn-select'
//   3. User moves a CC encoder  → handleCC() stores mapping, clears pending
//
// Events fired on window:
//   'midi-learn-state'  { active: boolean, pending: boolean }
//
// Global flag read by UIRenderer:
//   window.__midiLearnActive: boolean
// ─────────────────────────────────────────────────────────────

interface CCTarget { moduleId: string; param: string }

export class MidiLearnSystem {
  private registry: ModuleRegistry;
  private _active  = false;
  private _pending: CCTarget | null = null;
  private _pendingEl: HTMLCanvasElement | null = null;
  private _map     = new Map<number, CCTarget>();

  constructor(registry: ModuleRegistry) {
    this.registry = registry;

    window.addEventListener('midi-learn-toggle', () => this.toggle());

    window.addEventListener('midi-learn-select', (e: Event) => {
      if (!this._active) return;
      const { moduleId, param } = (e as CustomEvent<CCTarget>).detail;
      this._setPending(moduleId, param);
    });

    // Inject knob-highlight styles once
    if (!document.getElementById('midi-learn-styles')) {
      const style = document.createElement('style');
      style.id = 'midi-learn-styles';
      style.textContent = `
        body.midi-learn-mode .knob-canvas {
          outline: 1px solid rgba(255,180,0,0.35);
          outline-offset: 2px;
        }
        .knob-canvas.midi-learn-pending {
          outline: 2px solid rgba(255,180,0,1) !important;
          outline-offset: 2px;
          animation: ml-pulse 0.7s ease-in-out infinite alternate;
        }
        @keyframes ml-pulse {
          from { box-shadow: 0 0 4px 2px rgba(255,180,0,0.5); }
          to   { box-shadow: 0 0 10px 4px rgba(255,180,0,0.9); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  get active() { return this._active; }

  toggle(): void {
    this._active = !this._active;
    this._clearPending();
    (window as unknown as Record<string, unknown>).__midiLearnActive = this._active;
    document.body.classList.toggle('midi-learn-mode', this._active);
    this._emitState();
  }

  /** Called by NoteRouter on every 0xB0 CC message. */
  handleCC(cc: number, rawValue: number): boolean {
    if (this._active && this._pending) {
      this._map.set(cc, { ...this._pending });
      this._clearPending();
      this._emitState();
      return true;
    }

    const target = this._map.get(cc);
    if (!target) return false;

    const mod = this.registry.modules.get(target.moduleId);
    if (!mod) { this._map.delete(cc); return false; }

    const def  = getModuleDef(mod.type);
    const pdef = def?.paramDefs?.[target.param];
    if (!pdef) return false;

    const value = pdef.min + (rawValue / 127) * (pdef.max - pdef.min);
    this.registry.setParam(target.moduleId, target.param, value);
    return true;
  }

  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [cc, t] of this._map) out[String(cc)] = `${t.moduleId}:${t.param}`;
    return out;
  }

  fromJSON(data: Record<string, string>): void {
    this._map.clear();
    for (const [ccStr, val] of Object.entries(data ?? {})) {
      const cc  = parseInt(ccStr, 10);
      const sep = val.lastIndexOf(':');
      if (isNaN(cc) || sep < 0) continue;
      this._map.set(cc, { moduleId: val.slice(0, sep), param: val.slice(sep + 1) });
    }
  }

  private _setPending(moduleId: string, param: string): void {
    this._clearPending();
    this._pending = { moduleId, param };
    const el = document.querySelector<HTMLCanvasElement>(
      `.knob-canvas[data-module="${moduleId}"][data-param="${param}"]`
    );
    if (el) { el.classList.add('midi-learn-pending'); this._pendingEl = el; }
    this._emitState();
  }

  private _clearPending(): void {
    this._pendingEl?.classList.remove('midi-learn-pending');
    this._pendingEl = null;
    this._pending   = null;
  }

  private _emitState(): void {
    window.dispatchEvent(new CustomEvent('midi-learn-state', {
      detail: { active: this._active, pending: this._pending !== null }
    }));
  }
}
