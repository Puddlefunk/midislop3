import type { NoteEvent } from '../types';
import type { ModuleRegistry } from '../core/ModuleRegistry';
import { MODULE_TYPE_DEFS } from '../config/modules';

type NoteHandler = (event: NoteEvent) => void;

// ─────────────────────────────────────────────────────────────
// NoteRouter — sits between physical input sources and the audio
// graph. Maps device IDs → generator modules, applies trigger-note
// matching for drums, fires typed NoteEvents.
//
// Replaces the direct MIDI → onNoteOn coupling in app.js.
// ─────────────────────────────────────────────────────────────

export class NoteRouter {
  private registry: ModuleRegistry;
  private _onHandlers  = new Set<NoteHandler>();
  private _offHandlers = new Set<NoteHandler>();
  private _ccHandlers  = new Set<(cc: number, value: number) => void>();

  /** MIDI devices currently connected: deviceId → { name } */
  readonly devices = new Map<string, { id: string; name: string }>();

  constructor(registry: ModuleRegistry) {
    this.registry = registry;
  }

  // ── Device management ────────────────────────────────────────

  connectDevice(id: string, name: string): void {
    this.devices.set(id, { id, name });
  }

  disconnectDevice(id: string): void {
    this.devices.delete(id);
    // If a midi-in module existed for this device, remove it from registry
    const mod = [...this.registry.modules.values()]
      .find(m => m.type === 'midi-in' && m.params.deviceId === id);
    if (mod) this.registry.removeModule(mod.id);
  }

  // ── Note dispatch ────────────────────────────────────────────

  /**
   * Called by MIDI input, QWERTY handler, and on-screen piano.
   * @param midi    MIDI note number 0–127
   * @param velocity 0–127
   * @param deviceId WebMIDI input ID, or null for QWERTY/on-screen
   */
  noteOn(midi: number, velocity: number, deviceId: string | null = null): void {
    const allMod = this.registry.getModulesByType('midi-all')[0];
    if (allMod) {
      this._fire('on', { midi, velocity, deviceId, generatorId: allMod.id });
    }

    // Intentional dual-fire: if a device-specific midi-in module exists, fire a second
    // NoteEvent with that generatorId. This lets users with multiple controllers route
    // each device through its own patch chain while midi-all continues to handle everything
    // globally. A device with a dedicated midi-in will trigger both chains simultaneously —
    // that layering is by design, not a bug.
    if (deviceId) {
      const devMod = [...this.registry.modules.values()]
        .find(m => m.type === 'midi-in' && m.params.deviceId === deviceId);
      if (devMod) {
        this._fire('on', { midi, velocity, deviceId, generatorId: devMod.id });
      }
    }
  }

  noteOff(midi: number, deviceId: string | null = null): void {
    const allMod = this.registry.getModulesByType('midi-all')[0];
    if (allMod) {
      this._fire('off', { midi, velocity: 0, deviceId, generatorId: allMod.id });
    }
    if (deviceId) {
      const devMod = [...this.registry.modules.values()]
        .find(m => m.type === 'midi-in' && m.params.deviceId === deviceId);
      if (devMod) {
        this._fire('off', { midi, velocity: 0, deviceId, generatorId: devMod.id });
      }
    }
    // Fallback: fire with null so any null-keyed voices also stop
    if (!allMod) this._fire('off', { midi, velocity: 0, deviceId, generatorId: null });
  }

  // ── Subscriptions ─────────────────────────────────────────────

  onNoteOn(handler:  NoteHandler): void { this._onHandlers.add(handler);  }
  onNoteOff(handler: NoteHandler): void { this._offHandlers.add(handler); }
  offNoteOn(handler:  NoteHandler): void { this._onHandlers.delete(handler);  }
  offNoteOff(handler: NoteHandler): void { this._offHandlers.delete(handler); }
  onCC(handler: (cc: number, value: number) => void): void { this._ccHandlers.add(handler); }

  private _fire(type: 'on' | 'off', event: NoteEvent): void {
    const set = type === 'on' ? this._onHandlers : this._offHandlers;
    set.forEach(h => h(event));
  }

  // ── MIDI initialisation ──────────────────────────────────────

  async initMIDI(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not available');
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      const connect = () => {
        for (const input of access.inputs.values()) {
          if (!this.devices.has(input.id)) this.connectDevice(input.id, input.name ?? input.id);
          input.onmidimessage = (msg) => this._onMidiMessage(msg, input.id);
        }
        // Disconnect devices that disappeared
        for (const id of this.devices.keys()) {
          if (![...access.inputs.values()].some(i => i.id === id)) {
            this.disconnectDevice(id);
          }
        }
      };
      connect();
      access.onstatechange = connect;
    } catch (e) {
      console.warn('MIDI access denied:', e);
    }
  }

  private _onMidiMessage(msg: MIDIMessageEvent, deviceId: string): void {
    if (!msg.data) return;
    const [status, note, velocity] = msg.data;
    const type = status & 0xf0;
    if (type === 0x90 && velocity > 0) this.noteOn(note, velocity, deviceId);
    else if (type === 0x80 || (type === 0x90 && velocity === 0)) this.noteOff(note, deviceId);
    else if (type === 0xB0) this._ccHandlers.forEach(h => h(note, velocity));
  }
}
