import type { ModuleInstance, ModuleDef, ParamValue } from '../types';
import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { PatchSystem } from './PatchSystem';
import { getModuleDef } from '../config/modules';
import { noteHue, NOTE_NAMES, SCALE_INTERVALS, type NoteName } from '../config/helpers';

// ─────────────────────────────────────────────────────────────
// Canvas drawing helpers
// ─────────────────────────────────────────────────────────────

export function drawKnob(canvas: HTMLCanvasElement | null, v01: number, hue: number, focused = false): void {
  if (!canvas) return;
  const kc = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, r = w * 0.33;
  kc.clearRect(0, 0, w, h);
  const START = Math.PI * 0.75, RANGE = Math.PI * 1.5;
  kc.beginPath(); kc.arc(cx, cy, r, START, START + RANGE);
  kc.strokeStyle = 'rgba(255,255,255,0.18)'; kc.lineWidth = 2.5; kc.lineCap = 'round'; kc.stroke();
  if (v01 > 0.001) {
    kc.beginPath(); kc.arc(cx, cy, r, START, START + v01 * RANGE);
    kc.strokeStyle = focused ? `hsl(${hue},85%,72%)` : `hsla(${hue},72%,72%,0.82)`;
    kc.lineWidth = 2.5; kc.lineCap = 'round'; kc.stroke();
  }
  const a = START + v01 * RANGE;
  kc.beginPath(); kc.arc(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2.5, 0, Math.PI * 2);
  kc.fillStyle = focused ? `hsl(${hue},85%,85%)` : `hsla(${hue},65%,88%,0.85)`; kc.fill();
}

export function drawBipolarKnob(canvas: HTMLCanvasElement | null, v01: number, hue: number, focused = false): void {
  if (!canvas) return;
  const kc = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, r = w * 0.33;
  kc.clearRect(0, 0, w, h);
  const START = Math.PI * 0.75, RANGE = Math.PI * 1.5;
  const CENTER = START + 0.5 * RANGE; // 12 o'clock
  // Background arc
  kc.beginPath(); kc.arc(cx, cy, r, START, START + RANGE);
  kc.strokeStyle = 'rgba(255,255,255,0.18)'; kc.lineWidth = 2.5; kc.lineCap = 'round'; kc.stroke();
  // Fill arc from center outward
  if (Math.abs(v01 - 0.5) > 0.012) {
    const a = START + v01 * RANGE;
    kc.beginPath();
    if (v01 < 0.5) kc.arc(cx, cy, r, a, CENTER);       // negative: fill left of center
    else           kc.arc(cx, cy, r, CENTER, a);        // positive: fill right of center
    kc.strokeStyle = focused ? `hsl(${hue},85%,72%)` : `hsla(${hue},72%,72%,0.82)`;
    kc.lineWidth = 2.5; kc.lineCap = 'round'; kc.stroke();
  }
  // Center tick
  kc.beginPath(); kc.moveTo(cx + Math.cos(CENTER) * (r - 4), cy + Math.sin(CENTER) * (r - 4));
  kc.lineTo(cx + Math.cos(CENTER) * (r + 1), cy + Math.sin(CENTER) * (r + 1));
  kc.strokeStyle = 'rgba(255,255,255,0.25)'; kc.lineWidth = 1; kc.stroke();
  // Dot
  const a = START + v01 * RANGE;
  kc.beginPath(); kc.arc(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2.5, 0, Math.PI * 2);
  kc.fillStyle = focused ? `hsl(${hue},85%,85%)` : `hsla(${hue},65%,88%,0.85)`; kc.fill();
}

export function drawFader(canvas: HTMLCanvasElement | null, v01: number, hue: number, focused = false): void {
  if (!canvas) return;
  const fc = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, cx = w / 2;
  fc.clearRect(0, 0, w, h);
  const padV = 7, tBot = h - padV, tH = tBot - padV, tY = tBot - v01 * tH;
  fc.beginPath(); fc.moveTo(cx, padV); fc.lineTo(cx, tBot);
  fc.strokeStyle = 'rgba(255,255,255,0.18)'; fc.lineWidth = 2; fc.lineCap = 'round'; fc.stroke();
  if (v01 > 0.005) {
    fc.beginPath(); fc.moveTo(cx, tY); fc.lineTo(cx, tBot);
    fc.strokeStyle = focused ? `hsl(${hue},85%,72%)` : `hsla(${hue},72%,72%,0.82)`;
    fc.lineWidth = 2; fc.lineCap = 'round'; fc.stroke();
  }
  fc.beginPath(); fc.roundRect(cx - (w - 2) / 2, tY - 3, w - 2, 6, 2);
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

// ─────────────────────────────────────────────────────────────
// Panel placement helper
// ─────────────────────────────────────────────────────────────

function findClearSpot(panelW: number, panelH: number, xZone: { min: number; max: number } | null) {
  const margin = 12, pad = 10;
  const W = window.innerWidth, H = window.innerHeight;
  const topBound = 60, botBound = H - 240;
  const occupied = [...document.querySelectorAll('#panels-container .panel-box')]
    .map(p => p.getBoundingClientRect()).filter(r => r.width > 0);

  const search = (lft: number, rgt: number) => {
    if (lft + panelW > rgt) return null;
    const cx = (lft + rgt) / 2, cy = (topBound + botBound - panelH) / 2;
    const candidates: Array<{ x: number; y: number; d: number }> = [];
    for (let x = lft; x <= rgt; x += 24)
      for (let y = topBound; y <= botBound - panelH; y += 24)
        candidates.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    candidates.sort((a, b) => a.d - b.d);
    for (const { x, y } of candidates)
      if (!occupied.some(r => x < r.right + pad && x + panelW > r.left - pad && y < r.bottom + pad && y + panelH > r.top - pad))
        return { left: x, top: y };
    return null;
  };

  if (xZone) {
    const pos = search(Math.max(margin, Math.round(xZone.min)), Math.min(W - panelW - margin, Math.round(xZone.max) - panelW));
    if (pos) return pos;
  }
  return search(margin, W - panelW - margin)
    ?? { left: Math.max(margin, Math.round((W - panelW) / 2)), top: Math.max(60, Math.round((H - panelH) / 2)) };
}

// ─────────────────────────────────────────────────────────────
// UIRenderer
// ─────────────────────────────────────────────────────────────

interface KnobDrag {
  moduleId: string;
  param:    string;
  pdef:     { min: number; max: number };
  startY:   number;
  startVal: number;
}

interface PanelDrag {
  panels:      Array<{ el: HTMLElement; id: string; startLeft: number; startTop: number }>;
  startMouseX: number;
  startMouseY: number;
}

interface SelectionRect {
  startX: number;
  startY: number;
  el:     HTMLElement;
}

export class UIRenderer {
  private registry:    ModuleRegistry;
  private patchSystem: PatchSystem;
  private container:   HTMLElement;

  readonly panelMap = new Map<string, HTMLElement>();
  positions:  Record<string, { left: number; top: number }> = {};
  panelTopZ = 5;

  private _knobDrag:        KnobDrag | null = null;
  private _panelDrag:       PanelDrag | null = null;
  private _selectionRect:   SelectionRect | null = null;
  private _selectedIds:     Set<string> = new Set();
  private _suppressNextClick = false;
  private _stylesInjected = false;
  private _rootKey  = 'C';
  private _scaleType = 'major';
  private _activeNotesByMod = new Map<string, Set<number>>();

  constructor(registry: ModuleRegistry, patchSystem: PatchSystem) {
    this.registry    = registry;
    this.patchSystem = patchSystem;
    this.container   = document.getElementById('panels-container')!;

    this._injectStyles();
    this._initGlobalHandlers();

    registry.on('module-added',  mod          => this._onModuleAdded(mod));
    // Catch modules already in registry (e.g. if created before UIRenderer was instantiated)
    for (const mod of registry.modules.values()) this._onModuleAdded(mod);
    registry.on('module-removed', ({ id })    => this._onModuleRemoved(id));
    registry.on('param-changed', e            => this._onParamChanged(e.id, e.param, e.value));
    registry.on('patch-changed', ()           => this._onPatchChanged());

    window.addEventListener('chord-voice-on', (e: Event) => {
      const { modId, voice, midi } = (e as CustomEvent<{ modId: string; voice: number; midi: number }>).detail;
      const p = this.panelMap.get(modId);
      if (!p) return;
      const light = p.querySelector<HTMLElement>(`.chord-note-light[data-voice="${voice}"]`);
      if (!light) return;
      light.style.setProperty('--lh', String(noteHue(midi)));
      light.classList.remove('chord-voice-active');
      requestAnimationFrame(() => {
        light.classList.add('chord-voice-active');
        setTimeout(() => light.classList.remove('chord-voice-active'), 500);
      });
    });

    window.addEventListener('note-module-on', (e: Event) => {
      const { modId, midi } = (e as CustomEvent<{ modId: string; midi: number; velocity: number }>).detail;
      let notes = this._activeNotesByMod.get(modId);
      if (!notes) { notes = new Set(); this._activeNotesByMod.set(modId, notes); }
      notes.add(midi);
      this._applyNoteGlow(modId, notes);
    });

    window.addEventListener('note-module-off', (e: Event) => {
      const { modId, midi } = (e as CustomEvent<{ modId: string; midi: number }>).detail;
      const notes = this._activeNotesByMod.get(modId);
      if (!notes) return;
      notes.delete(midi);
      if (notes.size === 0) this._clearNoteGlow(modId);
      else this._applyNoteGlow(modId, notes);
    });
  }

  // ── Registry callbacks ───────────────────────────────────────

  private _onModuleAdded(mod: ModuleInstance): void {
    if (this.panelMap.has(mod.id)) return;
    const panel = this._createPanel(mod.id, mod.type, mod.params);
    if (!panel) return;

    // Wrap existing content in .panel-body; add jack strips on left and right
    const body   = document.createElement('div'); body.className = 'panel-body';
    while (panel.firstChild) body.appendChild(panel.firstChild);
    const jacksL = document.createElement('div'); jacksL.className = 'jacks-l';
    const jacksR = document.createElement('div'); jacksR.className = 'jacks-r';
    // Lift .voice-panel out of panel-body so it becomes a flex sibling inside panel-box
    const voicePanel = body.querySelector<HTMLElement>('.voice-panel');
    if (voicePanel) body.removeChild(voicePanel);
    panel.appendChild(jacksL);
    panel.appendChild(body);
    if (voicePanel) panel.appendChild(voicePanel);
    panel.appendChild(jacksR);

    this.container.appendChild(panel);
    this.panelMap.set(mod.id, panel);
    this._injectRivets(panel);
    this._initDrag(panel);
    // 02-01: snap cable to module on panel click
    panel.addEventListener('pointerdown', e => {
      this.patchSystem.handleModuleClick(mod.id, e as PointerEvent);
    });
    panel.addEventListener('mouseenter', () => this._applyChainHover(mod.id));
    panel.addEventListener('mouseleave', () => this._clearChainHover());
    this._positionPanel(mod.id, mod.type, panel);
    this._renderModulePorts(mod.id, panel);
    requestAnimationFrame(() => panel.classList.add('unlocked'));
  }

  private _onModuleRemoved(id: string): void {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    panel.classList.remove('unlocked');
    setTimeout(() => panel.remove(), 600);
    this.panelMap.delete(id);
    this._selectedIds.delete(id);
  }

  private _onParamChanged(id: string, param: string, value: ParamValue): void {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const def = getModuleDef(mod.type);
    const hue = def?.hue ?? 200;

    // Value display
    const valEl = panel.querySelector<HTMLElement>(`[data-val="${param}"]`);
    if (valEl) {
      const fmt = def?.paramDefs?.[param]?.format;
      valEl.textContent = fmt ? fmt(value as number) : Math.round((value as number) * 100) + '%';
    }

    // Knob/fader redraw
    const knobEl = panel.querySelector<HTMLCanvasElement>(`[data-param="${param}"]`);
    if (knobEl) {
      const pdef = def?.paramDefs?.[param] ?? { min: 0, max: 1 };
      const v01  = ((value as number) - pdef.min) / (pdef.max - pdef.min);
      if (knobEl.classList.contains('fader-canvas')) drawFader(knobEl, v01, hue);
      else if (knobEl.dataset['bipolar'])            drawBipolarKnob(knobEl, v01, hue);
      else                                           drawKnob(knobEl, v01, hue);
    }

    // Wave preview
    if (['fold', 'drive', 'slope', 'width', 'waveform', 'waveParam'].includes(param)) {
      this._updateWavePreview(panel, id, mod.type);
    }

    // Filter type buttons
    if (mod.type === 'vcf-x2' && param === 'filterType') {
      const numVal = value as number;
      panel.querySelectorAll<HTMLElement>('.filter-type-btn').forEach(b =>
        b.classList.toggle('active', parseFloat(b.dataset['ft'] ?? '0') === numVal));
    }

    // Oct buttons
    if (param === 'octave') {
      panel.querySelectorAll<HTMLElement>('.oct-btn').forEach(b =>
        b.classList.toggle('oct-active', parseInt(b.dataset['oct'] ?? '0') === value));
    }

    // Chord offset dimming
    if (mod.type === 'chord' && (param === 'offset-0' || param === 'offset-1' || param === 'offset-2')) {
      this._updateChordKnobDim(panel, mod.params);
    }

    // Chord split toggle
    if (mod.type === 'chord' && param === 'mode') {
      const btn = panel.querySelector<HTMLElement>('.chord-split-btn');
      if (btn) btn.classList.toggle('active', value === 'split');
    }

    // Seq updates
    if (mod.type === 'noteSeq' && param === 'bars') { this._rebuildSeqCvGrid(id, panel);  return; }
    if (mod.type === 'drumSeq' && param === 'bars') { this._rebuildSeqDrumGrid(id, panel); return; }
    if ((mod.type === 'noteSeq' || mod.type === 'drumSeq') && param === 'rate') {
      panel.querySelectorAll<HTMLElement>('.seq-rate-btn').forEach(b =>
        b.classList.toggle('active', b.dataset['rate'] === value));
      return;
    }
    if (mod.type === 'noteSeq' && param.startsWith('step-')) this._refreshSeqCvGrid(id, panel);
    if (mod.type === 'drumSeq' && param.startsWith('step-')) {
      const parts = param.split('-');
      const row = parseInt(parts[1]), col = parseInt(parts[2]);
      const cell = panel.querySelector<HTMLElement>(`.drum-cell[data-row="${row}"][data-step="${col}"]`);
      if (cell) {
        cell.className = 'drum-cell';
        const v = (value as number) ?? 0;
        if (v > 0) cell.classList.add(`vel-${v}`);
      }
    }
  }

  private _onPatchChanged(): void {
    for (const [id, panel] of this.panelMap) {
      this._updatePluggedStates(id, panel);
    }
  }

  // ── Panel creation ───────────────────────────────────────────

  private _createPanel(id: string, type: string, params: Record<string, ParamValue>): HTMLElement | null {
    const def = getModuleDef(type);
    if (!def) return null;

    // Types with no panel
    if (type === 'transport') return null;
    if (type === 'audio-out') return this._createSinkPanel(id, def);

    const panel = document.createElement('div');
    panel.className = 'panel-box';
    panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', String(def.hue));

    if (def.category === 'osc') return this._buildOscPanel(panel, id, type, params, def);
    if (type === 'mixer')       return this._buildMixerPanel(panel, id, params, def);
    if (type === 'noteSeq')     return this._buildSeqCvPanel(panel, id, params, def);
    if (type === 'drumSeq')     return this._buildSeqDrumPanel(panel, id, params, def);
    if (type === 'vcf-x2') return this._buildFilterPanel(panel, id, params, def);
    if (type === 'chord')       return this._buildChordPanel(panel, id, params, def);

    // Generic panel: title + all paramDefs as knobs
    return this._buildGenericPanel(panel, id, params, def);
  }

  private _createSinkPanel(id: string, def: ModuleDef): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'panel-box';
    panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', String(def.hue));
    panel.innerHTML = `<span class="panel-title">${def.label}</span>`;
    return panel;
  }

  private _buildGenericPanel(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    const paramRows = this._buildKnobRows(id, params, def);
    panel.innerHTML = `<span class="panel-title">${def.label}</span>
      <div class="synth-hgroup">${paramRows}</div>`;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  private _buildFilterPanel(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    const ft = (params['filterType'] as number) ?? 0;
    panel.innerHTML = `
      <span class="panel-title">${def.label}</span>
      <div class="filter-type-row">
        <button class="filter-type-btn${ft < 0.33 ? ' active' : ''}" data-ft="0">LP</button>
        <button class="filter-type-btn${ft >= 0.33 && ft < 0.67 ? ' active' : ''}" data-ft="0.5">HP</button>
        <button class="filter-type-btn${ft >= 0.67 ? ' active' : ''}" data-ft="1">BP</button>
      </div>
      <div class="synth-hgroup">${this._buildKnobRows(id, params, def, ['cutoff', 'res'])}</div>`;
    panel.querySelectorAll<HTMLElement>('.filter-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.filter-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.registry.setParam(id, 'filterType', parseFloat(btn.dataset['ft']!));
      });
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  private _buildChordPanel(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    panel.classList.add('chord-panel');
    const mode = (params['mode'] as string) ?? 'combined';

    const voices = [
      { offset: 'offset-0', vel: 'vel-0', port: 'note-out-1' },
      { offset: 'offset-1', vel: 'vel-1', port: 'note-out-2' },
      { offset: 'offset-2', vel: 'vel-2', port: 'note-out-3' },
    ];

    const rowsHtml = voices.map((v, i) => {
      const offVal = (params[v.offset] as number) ?? 0;
      const velVal = (params[v.vel]    as number) ?? 1;
      const offFmt = def.paramDefs[v.offset]?.format(offVal) ?? '0st';
      const velFmt = def.paramDefs[v.vel]?.format(velVal)    ?? '100%';
      return `<div class="chord-row">
        <div class="synth-control">
          <label>OFF</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="${v.offset}" data-bipolar="1" width="28" height="28"></canvas>
          <span class="val" data-val="${v.offset}">${offFmt}</span>
        </div>
        <div class="synth-control">
          <label>VEL</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="${v.vel}" width="28" height="28"></canvas>
          <span class="val" data-val="${v.vel}">${velFmt}</span>
        </div>
        <span class="chord-note-light" data-voice="${i}"></span>
      </div>`;
    }).join('');

    const outJacksHtml = voices.map(v =>
      `<div class="port-jack port-out port-note" data-module="${id}" data-port="${v.port}" title="${v.port}"></div>`
    ).join('');

    panel.innerHTML = `
      <div class="chord-header">
        <span class="panel-title">${def.label}</span>
        <button class="chord-split-btn${mode === 'split' ? ' active' : ''}">SPLIT</button>
      </div>
      <div class="chord-main">
        <div class="chord-strip-l">
          <div class="port-jack port-in port-note" data-module="${id}" data-port="note-in" title="note-in"></div>
        </div>
        <div class="chord-content">${rowsHtml}</div>
        <div class="chord-strip-r">${outJacksHtml}</div>
      </div>`;

    panel.querySelector<HTMLElement>('.chord-split-btn')!.addEventListener('click', () => {
      const cur = (this.registry.modules.get(id)?.params['mode'] as string) ?? 'combined';
      this.registry.setParam(id, 'mode', cur === 'split' ? 'combined' : 'split');
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => {
      this._redrawAllKnobs(panel, id, params, def);
      this._updateChordKnobDim(panel, params);
    });
    return panel;
  }

  private _updateChordKnobDim(panel: HTMLElement, params: Record<string, ParamValue>): void {
    for (const i of [0, 1, 2]) {
      const off  = (params[`offset-${i}`] as number) ?? 0;
      const knob = panel.querySelector<HTMLCanvasElement>(`[data-param="offset-${i}"]`);
      knob?.closest('.synth-control')?.classList.toggle('dim', off === 0);
    }
  }

  private _buildOscPanel(panel: HTMLElement, id: string, type: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    const wfMap: Record<string, string> = { 'osc-sine': 'fold', 'osc-saw': 'drive', 'osc-tri': 'slope', 'osc-sq': 'width', 'osc-sub': 'subTune', 'osc-noise': 'level' };
    const labelMap: Record<string, string> = { 'osc-sine': 'FOLD', 'osc-saw': 'DRIVE', 'osc-tri': 'SLOPE', 'osc-sq': 'WIDTH', 'osc-sub': 'TUNE', 'osc-noise': 'COLOR' };
    const specialParam = wfMap[type] ?? '';
    const specialLabel = labelMap[type] ?? '';
    const levelVal = (params['level'] as number) ?? 0.8;
    const octave   = (params['octave'] as number) ?? 0;
    const curWf    = (params['waveform'] as string) ?? 'sine';
    const wfType   = type === 'osc' ? curWf : type.replace('osc-', '');

    const WF_BTNS = [['sine','SIN'],['sawtooth','SAW'],['triangle','TRI'],['square','SQ']] as const;

    panel.innerHTML = `
      <span class="panel-title">${def.label}</span>
      <canvas class="wave-preview" id="wave-prev-${id}" width="90" height="28"></canvas>
      <div class="osc-body">
        <canvas class="knob-canvas" data-module="${id}" data-param="level" width="40" height="40"></canvas>
        <span class="val" data-val="level">${Math.round(levelVal * 100)}%</span>
      </div>
      ${type !== 'osc-noise' ? `
      <div class="oct-switch">
        <button class="oct-btn${octave === -1 ? ' oct-active' : ''}" data-oct="-1">-1</button>
        <button class="oct-btn${octave === 0  ? ' oct-active' : ''}" data-oct="0">0</button>
        <button class="oct-btn${octave === 1  ? ' oct-active' : ''}" data-oct="1">+1</button>
      </div>` : ''}
      ${type === 'osc' ? `
      <div class="wf-select">
        ${WF_BTNS.map(([wf, lbl]) => `<button class="wf-btn${curWf === wf ? ' wf-active' : ''}" data-wf="${wf}">${lbl}</button>`).join('')}
      </div>` : ''}
      ${specialParam && specialParam !== 'level' ? `
      <div class="osc-special">
        <label>${specialLabel}</label>
        <canvas class="knob-canvas" data-module="${id}" data-param="${specialParam}" width="30" height="30"></canvas>
        <span class="val" data-val="${specialParam}">${def.paramDefs[specialParam]?.format((params[specialParam] as number) ?? 0) ?? '0%'}</span>
      </div>` : ''}
      ${type !== 'osc-noise' ? `
      <button class="voice-toggle-btn" title="Voice params">VOICE</button>
      <div class="voice-panel">
        <div class="voice-grid">
          ${this._buildKnobRows(id, params, def, ['semi','portamento','vib-rate','vib-depth','detune','vel-sens'], new Set(['semi']))}
        </div>
      </div>` : ''}`;

    panel.querySelectorAll<HTMLElement>('.oct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.oct-btn').forEach(b => b.classList.remove('oct-active'));
        btn.classList.add('oct-active');
        this.registry.setParam(id, 'octave', parseInt(btn.dataset['oct']!));
      });
    });

    panel.querySelectorAll<HTMLElement>('.wf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.wf-btn').forEach(b => b.classList.remove('wf-active'));
        btn.classList.add('wf-active');
        this.registry.setParam(id, 'waveform', btn.dataset['wf']!);
      });
    });

    panel.querySelector<HTMLElement>('.voice-toggle-btn')?.addEventListener('click', () => {
      panel.classList.toggle('voice-open');
    });

    this._initKnobs(panel, id);
    requestAnimationFrame(() => {
      this._redrawAllKnobs(panel, id, params, def);
      const WF_NORM: Record<string, string> = { saw: 'sawtooth', tri: 'triangle', sq: 'square' };
      const rawWf = type === 'osc' ? curWf : wfType;
      drawWavePreview(panel.querySelector(`#wave-prev-${id}`), WF_NORM[rawWf] ?? rawWf, (params[specialParam] as number) ?? 0);
    });
    return panel;
  }

  private _buildMixerPanel(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    panel.className += ' mixer-panel';
    const masterVal = (params['level'] as number) ?? 1;
    panel.innerHTML = `
      <span class="panel-title">${def.label}</span>
      <div class="mix-strips">
        ${[0,1,2,3].map(i => `
          <div class="fader-cell" id="mix-ch-${id}-${i}">
            <canvas class="fader-canvas knob-canvas" data-module="${id}" data-param="level-in-${i}" width="22" height="84"></canvas>
            <span class="val" data-val="level-in-${i}">${Math.round(((params[`level-in-${i}`] as number) ?? 1) * 100)}%</span>
            <div class="mix-send-col">
              <canvas class="knob-canvas mix-send-knob" data-module="${id}" data-param="s0-in-${i}" width="16" height="16"></canvas>
              <canvas class="knob-canvas mix-send-knob" data-module="${id}" data-param="s1-in-${i}" width="16" height="16"></canvas>
            </div>
          </div>`).join('')}
        <div class="mix-master-cell">
          <span class="mix-master-lbl">MSTR</span>
          <canvas class="fader-canvas knob-canvas" data-module="${id}" data-param="level" width="22" height="120"></canvas>
          <span class="val" data-val="level">${Math.round(masterVal * 100)}%</span>
        </div>
      </div>`;

    requestAnimationFrame(() => {
      for (let i = 0; i < 4; i++) {
        const c = panel.querySelector<HTMLCanvasElement>(`[data-param="level-in-${i}"]`);
        if (c) drawFader(c, (params[`level-in-${i}`] as number) ?? 1, def.hue);
      }
      const mc = panel.querySelector<HTMLCanvasElement>('[data-param="level"]');
      if (mc) drawFader(mc, masterVal, def.hue);
      this._redrawAllKnobs(panel, id, params, def);
    });
    this._initKnobs(panel, id);
    return panel;
  }

  private _buildSeqCvPanel(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    const bars = (params['bars'] as number) ?? 1;
    const rate = (params['rate'] as string) ?? '16';
    const fold = !!(params['fold'] as number);
    const gate = (params['gate'] as number) ?? 0.5;
    const gateFmt = def.paramDefs['gate']?.format(gate) ?? '';
    panel.className += ' seq-panel';
    panel.innerHTML = `
      <span class="panel-title">${def.label}</span>
      <div class="seq-toolbar">
        <div class="seq-rate-grid">${['4','8','d8','t8','16','32'].map(r =>
          `<button class="seq-rate-btn${rate === r ? ' active' : ''}" data-rate="${r}">${r}</button>`).join('')}</div>
        <div class="seq-gate-ctrl">
          <label>GATE</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="gate" width="26" height="26"></canvas>
          <span class="val" data-val="gate">${gateFmt}</span>
        </div>
      </div>
      <div class="seq-grid-wrap" id="seq-wrap-${id}">
        <div class="seq-grid note-seq-grid" id="seq-grid-${id}" style="--seq-cols:${16 * bars}"></div>
      </div>
      <div class="seq-footer">
        <button class="seq-collapse-btn">▾</button>
        <button class="seq-bars-btn" data-module="${id}">BARS:${bars}</button>
        <button class="seq-fold-btn${fold ? ' active' : ''}">FOLD</button>
      </div>`;
    this._fillSeqCvGrid(id, panel, params, bars);
    panel.querySelectorAll<HTMLElement>('.seq-rate-btn').forEach(btn => {
      btn.addEventListener('click', () => this.registry.setParam(id, 'rate', btn.dataset['rate']!));
    });
    panel.querySelector('.seq-collapse-btn')?.addEventListener('click', (e) => {
      const wrap = panel.querySelector('.seq-grid-wrap');
      const btn  = e.currentTarget as HTMLElement;
      wrap?.classList.toggle('collapsed');
      btn.textContent = wrap?.classList.contains('collapsed') ? '▸' : '▾';
    });
    panel.querySelector('.seq-bars-btn')?.addEventListener('click', () => {
      const newBars = ((params['bars'] as number ?? 1) % 4) + 1;
      this.registry.setParam(id, 'bars', newBars);
    });
    panel.querySelector('.seq-fold-btn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLElement;
      const curFold = !!(this.registry.modules.get(id)?.params['fold'] as number);
      this.registry.setParam(id, 'fold', curFold ? 0 : 1);
      btn.classList.toggle('active', !curFold);
      this._rebuildSeqCvGrid(id, panel);
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  private _buildSeqDrumPanel(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): HTMLElement {
    const rate = (params['rate'] as string) ?? '16';
    const bars = (params['bars'] as number) ?? 1;
    panel.className += ' seq-panel';
    panel.innerHTML = `
      <span class="panel-title">${def.label}</span>
      <div class="seq-toolbar">
        <div class="seq-rate-grid">${['4','8','d8','t8','16','32'].map(r =>
          `<button class="seq-rate-btn${rate === r ? ' active' : ''}" data-rate="${r}">${r}</button>`).join('')}</div>
      </div>
      <div class="seq-grid-wrap" id="seq-wrap-${id}">
        <div class="seq-grid drum-seq-grid" id="seq-grid-${id}" style="--drum-cols:${16 * bars}"></div>
      </div>
      <div class="seq-footer">
        <button class="seq-collapse-btn">▾</button>
        <button class="seq-bars-btn" data-module="${id}">BARS:${bars}</button>
      </div>`;
    this._fillDrumGrid(id, panel, params, bars);
    panel.querySelectorAll<HTMLElement>('.seq-rate-btn').forEach(btn => {
      btn.addEventListener('click', () => this.registry.setParam(id, 'rate', btn.dataset['rate']!));
    });
    panel.querySelector('.seq-collapse-btn')?.addEventListener('click', (e) => {
      const wrap = panel.querySelector('.seq-grid-wrap');
      const btn  = e.currentTarget as HTMLElement;
      wrap?.classList.toggle('collapsed');
      btn.textContent = wrap?.classList.contains('collapsed') ? '▸' : '▾';
    });
    panel.querySelector('.seq-bars-btn')?.addEventListener('click', () => {
      const newBars = ((this.registry.modules.get(id)?.params['bars'] as number ?? 1) % 4) + 1;
      this.registry.setParam(id, 'bars', newBars);
    });
    return panel;
  }

  // ── Seq grid builders ────────────────────────────────────────

  private _fillSeqCvGrid(id: string, panel: HTMLElement, params: Record<string, ParamValue>, bars: number): void {
    const grid = panel.querySelector<HTMLElement>(`#seq-grid-${id}`);
    if (!grid) return;
    const total   = 16 * bars;
    const rootPC  = NOTE_NAMES.indexOf(this._rootKey as NoteName);
    const fold    = !!(params['fold'] as number);
    const scaleSet = new Set(SCALE_INTERVALS[this._scaleType] ?? SCALE_INTERVALS['major']);
    grid.style.setProperty('--seq-cols', String(total));
    grid.innerHTML = '';
    for (let row = 24; row >= 0; row--) {
      const pc      = ((rootPC + row - 12) % 12 + 12) % 12;
      // In fold mode, skip rows whose pitch class isn't in the current scale
      const semitoneFromRoot = ((row - 12) % 12 + 12) % 12;
      if (fold && !scaleSet.has(semitoneFromRoot)) continue;
      const hue     = noteHue(pc);
      const isTonic = (row === 0 || row === 12 || row === 24);
      for (let col = 0; col < total; col++) {
        const cell = document.createElement('div');
        cell.className = 'seq-cell';
        if (isTonic) cell.classList.add('tonic-row');
        cell.style.setProperty('--ph', String(hue));
        cell.dataset['step'] = String(col);
        cell.dataset['row']  = String(row);
        const activeRow = (params[`step-${col}-note`] as number) ?? 12;
        const vel       = (params[`step-${col}-vel`]  as number) ?? 0;
        if (activeRow === row && vel > 0) cell.classList.add(`vel-${vel}`);
        grid.appendChild(cell);
      }
    }
    // Pointer-capture drag painting.
    // Single-click drag → vel=1 (1/3). Double-click drag → vel=2 (2/3).
    // Click on active cell: if >2s since last paint → clear; else cycle 1→2→3→clear.
    let dragRow: number | null = null;
    let dragVel = 1;
    let lastPointerDownMs = 0;
    const stepLastPainted = new Map<number, number>(); // col → timestamp

    grid.addEventListener('pointerdown', e => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.seq-cell');
      if (!cell) return;
      const col      = Number(cell.dataset['step']), row = Number(cell.dataset['row']);
      const now      = Date.now();
      const isDouble = (now - lastPointerDownMs) < 300;
      lastPointerDownMs = now;
      const curVel  = (this.registry.modules.get(id)?.params[`step-${col}-vel`]  as number) ?? 0;
      const curNote = (this.registry.modules.get(id)?.params[`step-${col}-note`] as number) ?? 12;

      if (isDouble) {
        // Double-click: paint vel=2 and start drag regardless of current state
        dragRow = row; dragVel = 2;
        this.registry.setParam(id, `step-${col}-note`, row);
        this.registry.setParam(id, `step-${col}-vel`,  2);
        stepLastPainted.set(col, now);
      } else if (curNote !== row || curVel === 0) {
        // Empty or different row — paint vel=1 and start drag
        dragRow = row; dragVel = 1;
        this.registry.setParam(id, `step-${col}-note`, row);
        this.registry.setParam(id, `step-${col}-vel`,  1);
        stepLastPainted.set(col, now);
      } else {
        // Active cell, same row — check expiry then cycle; start erase drag when clearing
        const stale = (now - (stepLastPainted.get(col) ?? 0)) > 2000;
        if (stale) {
          dragRow = row; dragVel = 0;
          this.registry.setParam(id, `step-${col}-vel`, 0);
        } else {
          const next = curVel + 1;
          if (next > 3) {
            dragRow = row; dragVel = 0;
            this.registry.setParam(id, `step-${col}-vel`, 0);
          } else {
            dragRow = null;
            this.registry.setParam(id, `step-${col}-vel`, next);
            stepLastPainted.set(col, now);
          }
        }
      }
      grid.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grid.addEventListener('pointermove', e => {
      if (dragRow === null) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest<HTMLElement>('.seq-cell');
      if (!cell || cell.closest(`#seq-grid-${id}`) !== grid) return;
      const col = Number(cell.dataset['step']);
      const row = Number(cell.dataset['row']);
      if (dragVel === 0) {
        // Erase mode: clear any active cell
        const curVel = (this.registry.modules.get(id)?.params[`step-${col}-vel`] as number) ?? 0;
        if (curVel > 0) this.registry.setParam(id, `step-${col}-vel`, 0);
      } else {
        const curVel  = (this.registry.modules.get(id)?.params[`step-${col}-vel`]  as number) ?? 0;
        const curNote = (this.registry.modules.get(id)?.params[`step-${col}-note`] as number) ?? 12;
        if (curNote !== row || curVel !== dragVel) {
          this.registry.setParam(id, `step-${col}-note`, row);
          this.registry.setParam(id, `step-${col}-vel`,  dragVel);
          stepLastPainted.set(col, Date.now());
        }
      }
    });
    grid.addEventListener('pointerup',    () => { dragRow = null; });
    grid.addEventListener('pointercancel',() => { dragRow = null; });
  }

  private _fillDrumGrid(id: string, panel: HTMLElement, params: Record<string, ParamValue>, bars: number): void {
    const grid = panel.querySelector<HTMLElement>(`#seq-grid-${id}`);
    if (!grid) return;
    const total = 16 * bars;
    grid.style.setProperty('--drum-cols', String(total));
    grid.innerHTML = '';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < total; col++) {
        const cell = document.createElement('div');
        cell.className = 'drum-cell';
        cell.dataset['row']  = String(row);
        cell.dataset['step'] = String(col);
        const v = (params[`step-${row}-${col}`] as number) ?? 0;
        if (v > 0) cell.classList.add(`vel-${v}`);
        grid.appendChild(cell);
      }
    }
    // Pointer-capture drag painting — same cycle+erase system as seq-cv
    let dragActive = false;
    let dragVel    = 1;
    let lastPointerDownMs = 0;
    const stepLastPainted = new Map<number, number>(); // row*1000+col → timestamp

    grid.addEventListener('pointerdown', e => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.drum-cell');
      if (!cell) return;
      const row = Number(cell.dataset['row']), col = Number(cell.dataset['step']);
      const now      = Date.now();
      const isDouble = (now - lastPointerDownMs) < 300;
      lastPointerDownMs = now;
      const curVel = (this.registry.modules.get(id)?.params[`step-${row}-${col}`] as number) ?? 0;
      const key    = row * 1000 + col;

      if (isDouble) {
        dragActive = true; dragVel = 2;
        this.registry.setParam(id, `step-${row}-${col}`, 2);
        stepLastPainted.set(key, now);
      } else if (curVel === 0) {
        dragActive = true; dragVel = 1;
        this.registry.setParam(id, `step-${row}-${col}`, 1);
        stepLastPainted.set(key, now);
      } else {
        const stale = (now - (stepLastPainted.get(key) ?? 0)) > 2000;
        if (stale) {
          dragActive = true; dragVel = 0;
          this.registry.setParam(id, `step-${row}-${col}`, 0);
        } else {
          const next = curVel + 1;
          if (next > 3) {
            dragActive = true; dragVel = 0;
            this.registry.setParam(id, `step-${row}-${col}`, 0);
          } else {
            dragActive = false;
            this.registry.setParam(id, `step-${row}-${col}`, next);
            stepLastPainted.set(key, now);
          }
        }
      }
      grid.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grid.addEventListener('pointermove', e => {
      if (!dragActive) return;
      const el   = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest<HTMLElement>('.drum-cell');
      if (!cell || cell.closest(`#seq-grid-${id}`) !== grid) return;
      const row    = Number(cell.dataset['row']), col = Number(cell.dataset['step']);
      const curVel = (this.registry.modules.get(id)?.params[`step-${row}-${col}`] as number) ?? 0;
      const key    = row * 1000 + col;
      if (dragVel === 0) {
        if (curVel > 0) this.registry.setParam(id, `step-${row}-${col}`, 0);
      } else {
        if (curVel === 0) {
          this.registry.setParam(id, `step-${row}-${col}`, dragVel);
          stepLastPainted.set(key, Date.now());
        }
      }
    });
    grid.addEventListener('pointerup',    () => { dragActive = false; });
    grid.addEventListener('pointercancel',() => { dragActive = false; });
  }

  private _rebuildSeqCvGrid(id: string, panel: HTMLElement): void {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const bars = (mod.params['bars'] as number) ?? 1;
    panel.querySelector<HTMLElement>('.seq-bars-btn')!.textContent = `BARS:${bars}`;
    this._fillSeqCvGrid(id, panel, mod.params, bars);
  }

  private _rebuildSeqDrumGrid(id: string, panel: HTMLElement): void {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const bars = (mod.params['bars'] as number) ?? 1;
    panel.querySelector<HTMLElement>('.seq-bars-btn')!.textContent = `BARS:${bars}`;
    this._fillDrumGrid(id, panel, mod.params, bars);
  }

  private _refreshSeqCvGrid(id: string, panel: HTMLElement): void {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const rootPC = NOTE_NAMES.indexOf(this._rootKey as NoteName);
    panel.querySelectorAll<HTMLElement>('.seq-cell').forEach(cell => {
      const col     = parseInt(cell.dataset['step']!), row = parseInt(cell.dataset['row']!);
      const pc      = ((rootPC + row - 12) % 12 + 12) % 12;
      const isTonic = (row === 0 || row === 12 || row === 24);
      const activeRow = (mod.params[`step-${col}-note`] as number) ?? 12;
      const vel       = (mod.params[`step-${col}-vel`]  as number) ?? 0;
      cell.className = 'seq-cell';
      if (isTonic) cell.classList.add('tonic-row');
      cell.style.setProperty('--ph', String(noteHue(pc)));
      if (activeRow === row && vel > 0) cell.classList.add(`vel-${vel}`);
    });
  }

  // ── Port rendering ───────────────────────────────────────────

  private _renderModulePorts(id: string, panel: HTMLElement): void {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const def = getModuleDef(mod.type);
    if (!def) return;

    for (const port of def.inputPorts ?? []) {
      this._createJack(panel, id, port.name, false, this._portClass(port));
    }
    for (const port of def.outputPorts ?? []) {
      this._createJack(panel, id, port.name, true, this._portClass(port));
    }

    this._updatePluggedStates(id, panel);
    this._registerJacks(id, panel);
  }

  private _portClass(port: { signal?: string; name: string }): string {
    if (port.signal === 'note') return 'note';
    if (port.name.startsWith('send-') || port.name.startsWith('return-')) return 'send';
    return '';
  }

  private _createJack(panel: HTMLElement, modId: string, port: string, isOut: boolean, portClass: string): void {
    const el = document.createElement('div');
    el.className = `port-jack ${isOut ? 'port-out' : 'port-in'}${portClass ? ` port-${portClass}` : ''}`;
    el.dataset['module'] = modId;
    el.dataset['port']   = port;
    el.title = port;
    // return-* inputs live on the right side (they receive signal coming back from a send)
    const isReturnIn = !isOut && port.startsWith('return-');
    const strip = panel.querySelector<HTMLElement>((isOut || isReturnIn) ? '.jacks-r' : '.jacks-l') ?? panel;
    strip.appendChild(el);
  }

  private _updatePluggedStates(id: string, panel: HTMLElement): void {
    panel.querySelectorAll<HTMLElement>(`[data-module="${id}"][data-port]`).forEach(el => {
      const port   = el.dataset['port']!;
      const isOut  = el.classList.contains('port-out');
      const plugged = isOut
        ? this.registry.patchesFrom(id).some(p => p.fromPort === port)
        : this.registry.patchesTo(id).some(p => p.toPort === port);
      el.classList.toggle('plugged', plugged);
    });
  }

  private _registerJacks(modId: string, panel: HTMLElement): void {
    panel.querySelectorAll<HTMLElement>('[data-module][data-port]').forEach(el => {
      const port  = el.dataset['port']!;
      const isOut = el.classList.contains('port-out');
      this.patchSystem.registerJack(modId, port, isOut, el);
      // Wire interaction — only attach once (guard with dataset flag)
      if (!el.dataset['jackWired']) {
        el.dataset['jackWired'] = '1';
        el.addEventListener('pointerdown', e => {
          this.patchSystem.handleJackPointerDown(modId, port, isOut, e as PointerEvent);
        });
        el.addEventListener('contextmenu', e => e.preventDefault());
      }
    });
  }

  // ── Knob helpers ─────────────────────────────────────────────

  private _buildKnobRows(id: string, params: Record<string, ParamValue>, def: ModuleDef, only?: string[], bipolar?: Set<string>): string {
    const entries = only
      ? only.map(k => [k, def.paramDefs[k]] as [string, typeof def.paramDefs[string]])
      : Object.entries(def.paramDefs);
    return entries.filter(([, pdef]) => pdef).map(([param, pdef]) => {
      const val = (params[param] as number) ?? pdef.min;
      const bp  = bipolar?.has(param) ? ' data-bipolar="1"' : '';
      return `<div class="synth-control">
        <label>${pdef.label}</label>
        <canvas class="knob-canvas" data-module="${id}" data-param="${param}"${bp} width="34" height="34"></canvas>
        <span class="val" data-val="${param}">${pdef.format(val)}</span>
      </div>`;
    }).join('');
  }

  private _initKnobs(parent: HTMLElement, moduleId: string): void {
    parent.querySelectorAll<HTMLCanvasElement>('.knob-canvas[data-param]').forEach(knobEl => {
      knobEl.addEventListener('mousedown', e => {
        const param = knobEl.dataset['param']!;
        if ((window as unknown as Record<string, unknown>).__midiLearnActive) {
          window.dispatchEvent(new CustomEvent('midi-learn-select', { detail: { moduleId, param } }));
          e.preventDefault();
          return;
        }
        const mod   = this.registry.modules.get(moduleId);
        if (!mod) return;
        const def   = getModuleDef(mod.type);
        const pdef  = def?.paramDefs?.[param] ?? { min: 0, max: 1 };
        this._knobDrag = { moduleId, param, pdef, startY: e.clientY, startVal: (mod.params[param] as number) ?? 0 };
        e.preventDefault();
      });
      knobEl.addEventListener('dblclick', e => {
        const param = knobEl.dataset['param']!;
        const mod   = this.registry.modules.get(moduleId);
        if (!mod) return;
        const def   = getModuleDef(mod.type);
        const defaultVal = def?.defaultParams?.[param];
        if (defaultVal === undefined) return;
        this.registry.setParam(moduleId, param, defaultVal as number);
        e.preventDefault();
      });
    });
  }

  private _redrawAllKnobs(panel: HTMLElement, id: string, params: Record<string, ParamValue>, def: ModuleDef): void {
    const hue = def?.hue ?? 200;
    panel.querySelectorAll<HTMLCanvasElement>('.knob-canvas[data-param]').forEach(knobEl => {
      const param = knobEl.dataset['param']!;
      const pdef  = def?.paramDefs?.[param];
      // Fall back to 0–1 range for params not in paramDefs (e.g. mixer send knobs)
      const pmin  = pdef?.min ?? 0;
      const pmax  = pdef?.max ?? 1;
      const val   = (params[param] as number) ?? pmin;
      const v01   = pmax > pmin ? (val - pmin) / (pmax - pmin) : 0;
      if (knobEl.classList.contains('fader-canvas'))  drawFader(knobEl, v01, hue);
      else if (knobEl.dataset['bipolar'])              drawBipolarKnob(knobEl, v01, hue);
      else                                             drawKnob(knobEl, v01, hue);
    });
  }

  private _updateWavePreview(panel: HTMLElement, id: string, type: string): void {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const canvas = panel.querySelector<HTMLCanvasElement>(`#wave-prev-${id}`);
    if (!canvas) return;
    const WF_NORM: Record<string, string> = { saw: 'sawtooth', tri: 'triangle', sq: 'square' };
    const raw = type === 'osc'
      ? (mod.params['waveform'] as string) ?? 'sine'
      : type.replace('osc-', '');
    const wfType = WF_NORM[raw] ?? raw;
    const p1 = (mod.params['fold'] ?? mod.params['drive'] ?? mod.params['slope'] ?? mod.params['width'] ?? mod.params['waveParam'] ?? 0) as number;
    drawWavePreview(canvas, wfType, p1);
    // Sync wf-btn active state for multiosc
    if (type === 'osc') {
      const curWf = (mod.params['waveform'] as string) ?? 'sine';
      panel.querySelectorAll<HTMLElement>('.wf-btn').forEach(btn => {
        btn.classList.toggle('wf-active', btn.dataset['wf'] === curWf);
      });
    }
  }

  // ── Panel positioning & drag ─────────────────────────────────

  private _positionPanel(id: string, type: string, panel: HTMLElement): void {
    const saved = this.positions[id];
    if (saved) { panel.style.left = saved.left + 'px'; panel.style.top = saved.top + 'px'; return; }
    const w = panel.offsetWidth  || 148;
    const h = panel.offsetHeight || 180;
    const W = window.innerWidth;
    const cat = getModuleDef(type)?.category;
    const isNoteRouter = type === 'chord' || type === 'note-merge';
    const zone = isNoteRouter                               ? { min: 0,        max: W * 0.25 }
               : cat === 'osc'                              ? { min: W * 0.25, max: W * 0.50 }
               : (cat === 'processor' || cat === 'utility') ? { min: W * 0.50, max: W * 0.75 }
               : (cat === 'sequencer' || cat === 'drum')    ? { min: W * 0.20, max: W * 0.80 }
               : type === 'audio-out'                       ? { min: W * 0.75, max: W }
               : null;
    const pos = findClearSpot(w, h, zone);
    panel.style.left = pos.left + 'px';
    panel.style.top  = pos.top  + 'px';
  }

  private _initDrag(panel: HTMLElement): void {
    panel.addEventListener('mousedown', () => { panel.style.zIndex = String(++this.panelTopZ); }, true);
    const handle = panel.querySelector<HTMLElement>('.panel-title');
    if (!handle) return;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const id = panel.id.replace('panel-', '');

      if (e.shiftKey) {
        // Shift-click: toggle this panel in/out of selection
        if (this._selectedIds.has(id)) this._selectedIds.delete(id);
        else                           this._selectedIds.add(id);
        panel.classList.toggle('is-selected', this._selectedIds.has(id));
        e.preventDefault(); e.stopPropagation();
        return;
      }

      // If clicking an unselected panel, clear selection and start fresh with just this one
      if (!this._selectedIds.has(id)) {
        this._clearSelection();
        this._selectedIds.add(id);
        panel.classList.add('is-selected');
      }

      // Build drag payload from all selected panels
      const panels = [...this._selectedIds].map(sid => {
        const el = this.panelMap.get(sid)!;
        el.classList.add('is-dragging');
        el.style.zIndex = String(++this.panelTopZ);
        return { el, id: sid, startLeft: parseFloat(el.style.left) || 0, startTop: parseFloat(el.style.top) || 0 };
      });
      this._panelDrag = { panels, startMouseX: e.clientX, startMouseY: e.clientY };
      e.preventDefault(); e.stopPropagation();
    });
  }

  private _clearSelection(): void {
    for (const sid of this._selectedIds) {
      this.panelMap.get(sid)?.classList.remove('is-selected');
    }
    this._selectedIds.clear();
  }

  // ── Global mouse handlers ────────────────────────────────────

  private _initGlobalHandlers(): void {
    // Rubber-band selection — listen on window so background visuals don't block it.
    // Only skip clicks that land on actual UI elements.
    const UI_SELECTOR = '.panel-box, #hud, #challenge, #game-controls, #dev-console, #clock-panel, #shop-panel, #menu-panel, #confirm-overlay';
    window.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(UI_SELECTOR)) return;
      if (!e.shiftKey) this._clearSelection();
      const containerRect = this.container.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'selection-rect';
      el.style.left = (e.clientX - containerRect.left) + 'px';
      el.style.top  = (e.clientY - containerRect.top)  + 'px';
      this.container.appendChild(el);
      this._selectionRect = { startX: e.clientX, startY: e.clientY, el };
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (this._panelDrag) {
        const dx = e.clientX - this._panelDrag.startMouseX;
        const dy = e.clientY - this._panelDrag.startMouseY;
        for (const { el, id, startLeft, startTop } of this._panelDrag.panels) {
          el.style.left = (startLeft + dx) + 'px';
          el.style.top  = (startTop  + dy) + 'px';
          this.patchSystem.updateJackPositions(id);
        }
        // Only show sell target when dragging a single panel
        if (this._panelDrag.panels.length === 1) {
          const shopEl = document.getElementById('shop-panel');
          if (shopEl) {
            const r = shopEl.getBoundingClientRect();
            const over = e.clientX >= r.left && e.clientX <= r.right
                      && e.clientY >= r.top  && e.clientY <= r.bottom;
            shopEl.classList.toggle('sell-drop-target', over);
          }
        }
      }

      if (this._selectionRect) {
        const { startX, startY, el } = this._selectionRect;
        const containerRect = this.container.getBoundingClientRect();
        const x = Math.min(e.clientX, startX) - containerRect.left;
        const y = Math.min(e.clientY, startY) - containerRect.top;
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        el.style.left   = x + 'px';
        el.style.top    = y + 'px';
        el.style.width  = w + 'px';
        el.style.height = h + 'px';
      }

      if (this._knobDrag) {
        const { moduleId, param, pdef, startY, startVal } = this._knobDrag;
        const range = pdef.max - pdef.min;
        const delta = (startY - e.clientY) / 180 * range;
        const newVal = Math.max(pdef.min, Math.min(pdef.max, startVal + delta));
        this.registry.setParam(moduleId, param, newVal);
      }
    });

    window.addEventListener('mouseup', e => {
      if (this._panelDrag) {
        const shopEl = document.getElementById('shop-panel');
        shopEl?.classList.remove('sell-drop-target');
        const shopRect = shopEl?.getBoundingClientRect();

        const onShop = this._panelDrag.panels.length === 1 && !!shopRect
          && e.clientX >= shopRect.left && e.clientX <= shopRect.right
          && e.clientY >= shopRect.top  && e.clientY <= shopRect.bottom;
        for (const { el, id } of this._panelDrag.panels) {
          el.classList.remove('is-dragging');
          if (onShop) {
            window.dispatchEvent(new CustomEvent('module-sell', { detail: { id } }));
          } else {
            this.positions[id] = { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
          }
        }
        this._panelDrag = null;
      }

      if (this._selectionRect) {
        const { startX, startY, el } = this._selectionRect;
        const selLeft   = Math.min(e.clientX, startX);
        const selTop    = Math.min(e.clientY, startY);
        const selRight  = Math.max(e.clientX, startX);
        const selBottom = Math.max(e.clientY, startY);
        // Only select if the user actually dragged (not just a click)
        if (selRight - selLeft > 4 || selBottom - selTop > 4) {
          for (const [id, panel] of this.panelMap) {
            const r = panel.getBoundingClientRect();
            const intersects = r.left < selRight && r.right > selLeft
                            && r.top  < selBottom && r.bottom > selTop;
            if (intersects) {
              this._selectedIds.add(id);
              panel.classList.add('is-selected');
            }
          }
          this._suppressNextClick = true; // prevent the following click from clearing selection
        }
        el.remove();
        this._selectionRect = null;
      }

      this._knobDrag = null;
    });

    // Click on empty background (no drag) clears selection
    window.addEventListener('click', e => {
      if (this._suppressNextClick) { this._suppressNextClick = false; return; }
      if ((e.target as HTMLElement).closest(UI_SELECTOR)) return;
      this._clearSelection();
    });
  }

  // ── Chain hover highlight ────────────────────────────────────

  /** BFS over patches to find the discrete signal chain. Mixers are included but not traversed through. */
  private _getChainIds(modId: string): Set<string> {
    const BOUNDARY_TYPES = new Set(['mixer', 'audio-out']);
    const visited = new Set<string>();
    const queue = [modId];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const type = this.registry.modules.get(id)?.type;
      if (type && BOUNDARY_TYPES.has(type) && id !== modId) continue; // include but don't traverse through
      for (const p of this.registry.patches) {
        if (p.fromId === id && !visited.has(p.toId))   queue.push(p.toId);
        if (p.toId   === id && !visited.has(p.fromId)) queue.push(p.fromId);
      }
    }
    return visited;
  }

  private _applyChainHover(modId: string): void {
    const chain = this._getChainIds(modId);
    for (const [id, panel] of this.panelMap) {
      panel.classList.toggle('chain-hover', chain.has(id));
    }
  }

  private _clearChainHover(): void {
    for (const panel of this.panelMap.values()) panel.classList.remove('chain-hover');
  }

  // ── Note glow ────────────────────────────────────────────────

  /** Circular mean of hues (degrees) to handle 0/360 wraparound correctly. */
  private _blendNoteHue(notes: Set<number>): number {
    let sx = 0, sy = 0;
    for (const midi of notes) {
      const rad = (noteHue(midi) * Math.PI) / 180;
      sx += Math.cos(rad);
      sy += Math.sin(rad);
    }
    const deg = (Math.atan2(sy, sx) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }

  private _applyNoteGlow(modId: string, notes: Set<number>): void {
    const panel = this.panelMap.get(modId);
    if (!panel) return;
    const hue = Math.round(this._blendNoteHue(notes));
    panel.style.setProperty('--nh', String(hue));
    for (const jack of panel.querySelectorAll<HTMLElement>('.port-jack.plugged')) {
      jack.classList.add('note-active');
    }
  }

  private _clearNoteGlow(modId: string): void {
    const panel = this.panelMap.get(modId);
    if (!panel) return;
    for (const jack of panel.querySelectorAll<HTMLElement>('.port-jack.note-active')) {
      jack.classList.remove('note-active');
    }
  }

  // ── Misc ─────────────────────────────────────────────────────

  private _injectRivets(_panel: HTMLElement): void { /* replaced by CSS top-border accent */ }

  pulsePanels(hue: number): void {
    for (const panel of this.panelMap.values()) {
      if (!panel.classList.contains('unlocked')) continue;
      panel.style.setProperty('--ph', String(hue));
      panel.classList.remove('chord-hit');
      requestAnimationFrame(() => panel.classList.add('chord-hit'));
    }
  }

  setRootKey(key: string): void {
    this._rootKey = key;
    for (const [id, mod] of this.registry.modules) {
      if (mod.type !== 'noteSeq') continue;
      const panel = this.panelMap.get(id);
      if (panel) this._rebuildSeqCvGrid(id, panel);
    }
  }

  setJackLighting(enabled: boolean): void {
    document.body.classList.toggle('no-jack-lighting', !enabled);
  }

  setScaleType(scale: string): void {
    this._scaleType = scale;
    for (const [id, mod] of this.registry.modules) {
      if (mod.type !== 'noteSeq') continue;
      const panel = this.panelMap.get(id);
      if (panel) this._rebuildSeqCvGrid(id, panel);
    }
  }

  setSeqPlayhead(id: string, step: number, _row: number): void {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    panel.querySelectorAll('.seq-cell.playhead, .drum-cell.playhead').forEach(c => c.classList.remove('playhead'));
    if (mod.type === 'noteSeq') {
      panel.querySelectorAll<HTMLElement>(`.seq-cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
    } else if (mod.type === 'drumSeq') {
      panel.querySelectorAll<HTMLElement>(`.drum-cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
    }
  }

  beatPulse(): void {
    document.querySelectorAll('.panel-box.unlocked').forEach(p => {
      p.classList.remove('beat-pulse');
      requestAnimationFrame(() => p.classList.add('beat-pulse'));
    });
  }

  // ── Style injection ───────────────────────────────────────────

  private _injectStyles(): void {
    if (this._stylesInjected || document.getElementById('ui-renderer-styles')) return;
    this._stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'ui-renderer-styles';
    style.textContent = `
      .panel-box {
        position: absolute;
        background: rgba(255, 255, 255, 0.09);
        backdrop-filter: blur(7.8px);
        -webkit-backdrop-filter: blur(7.8px);
        border: 1px solid rgba(255, 255, 255, 0.22);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 30px rgba(0,0,0,0.45);
        border-radius: 16px;
        padding: 0;
        min-width: 80px;
        font-family: 'Courier New', monospace;
        font-size: 10px;
        color: rgba(255,255,255,0.75);
        user-select: none;
        opacity: 0;
        transform: scale(0.93);
        transition: opacity 0.25s, transform 0.25s, box-shadow 0.15s;
        z-index: 5;
        pointer-events: all;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        overflow: visible;
      }
      .panel-body {
        flex: 1;
        padding: 10px 10px 12px;
        min-width: 0;
      }
      .jacks-l, .jacks-r {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        padding: 22px 3px 8px;
        min-width: 20px;
        position: relative;
      }
      .jacks-l { border-right: 1px solid rgba(255,255,255,0.09); }
      .jacks-r { border-left:  1px solid rgba(255,255,255,0.09); }
      .panel-box.unlocked { opacity: 1; transform: scale(1); }
      .panel-box.is-dragging { box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), inset 1px 0 0 rgba(255,255,255,0.05), 0 14px 44px rgba(0,0,0,0.65); }
      .panel-box.is-selected { outline: 1px solid hsla(var(--ph,200),70%,65%,0.7); outline-offset: 2px; }
      .selection-rect { position: absolute; pointer-events: none; border: 1px solid rgba(120,180,255,0.7); background: rgba(80,140,255,0.08); border-radius: 2px; z-index: 9999; }
      .panel-box.chord-hit { box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), inset 1px 0 0 rgba(255,255,255,0.05), 0 0 20px hsla(var(--ph,200),75%,55%,0.45); }
      .panel-box.chain-hover { box-shadow: 0 0 18px 5px hsla(var(--ph,200),72%,58%,0.4), inset 0 0 8px 1px hsla(var(--ph,200),60%,45%,0.15); border-top-color: hsla(var(--ph,200),68%,68%,0.8); }
      .panel-box { --nh: 200; }
      .panel-box.beat-pulse { animation: beat-pulse 0.12s ease-out; }
      @keyframes beat-pulse { 0%{box-shadow:inset 0 1px 0 rgba(255,255,255,0.10),inset 1px 0 0 rgba(255,255,255,0.05),0 0 0 0 hsla(var(--ph,200),65%,55%,0.4)} 100%{box-shadow:inset 0 1px 0 rgba(255,255,255,0.10),inset 1px 0 0 rgba(255,255,255,0.05),0 0 16px 0 transparent} }

      .panel-title {
        display: block;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: hsla(var(--ph,200),60%,72%,0.9);
        margin-bottom: 7px;
        cursor: grab;
      }
      .panel-title:active { cursor: grabbing; }

      .panel-box { border-top: 2px solid hsla(var(--ph,200), 60%, 65%, 0.5); }

      .synth-hgroup { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
      .synth-control { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .synth-control label { font-size: 8px; color: rgba(255,255,255,0.4); letter-spacing: 0.06em; }
      .val { font-size: 8px; color: rgba(255,255,255,0.5); margin-top: 1px; }

      .knob-canvas { cursor: ns-resize; display: block; }

      .port-jack {
        width: 12px; height: 12px; border-radius: 50%;
        background: rgba(8,8,14,0.9);
        border: 1.5px solid rgba(210,55,55,0.6);
        cursor: crosshair;
        transition: border-color 0.1s, background 0.1s, box-shadow 0.5s;
        box-sizing: border-box;
        display: block;
        flex-shrink: 0;
      }
      .port-jack.plugged {
        background: radial-gradient(circle at center, rgba(255,255,255,1) 8%, rgba(210,210,210,0.5) 40%, rgba(8,8,14,0.5) 82%);
        border-color: rgba(210,55,55,0.95);
        box-shadow: 0 0 5px 2px rgba(200,200,200,0.35);
      }
      .port-jack.port-note.plugged  { border-color: rgba(255,200,80,0.95); }
      .port-jack.port-send.plugged  { border-color: rgba(255,138,40,0.95); }
      .port-jack.port-note {
        border-radius: 0; transform: rotate(45deg);
        border-color: rgba(255,200,80,0.6); width: 10px; height: 10px;
      }
      .port-jack.port-note.plugged { background: radial-gradient(circle at center, rgba(255,255,255,1) 8%, rgba(210,210,210,0.5) 40%, rgba(8,8,14,0.5) 82%); box-shadow: 0 0 5px 2px rgba(200,200,200,0.35); }
      .port-jack.port-send {
        border-radius: 1px;
        border-color: rgba(255,138,40,0.6); width: 10px; height: 10px;
      }
      .port-jack.port-send.plugged { background: radial-gradient(circle at center, rgba(255,255,255,1) 8%, rgba(210,210,210,0.5) 40%, rgba(8,8,14,0.5) 82%); box-shadow: 0 0 5px 2px rgba(200,200,200,0.35); }
      .port-jack.port-empty { opacity: 0.4; }
      @keyframes jack-pulse { 0% { box-shadow: 0 0 11px 5px rgba(255,255,255,0.7); } 100% { box-shadow: 0 0 5px 2px rgba(200,200,200,0.35); } }
      .panel-box.beat-pulse .port-jack.plugged { animation: jack-pulse 0.3s ease-out forwards; }
      body.no-jack-lighting .port-jack { box-shadow: none !important; animation: none !important; }
      .port-jack.plugged.note-active { background: radial-gradient(circle at center, hsla(var(--nh),88%,74%,1) 10%, hsla(var(--nh),78%,52%,0.65) 52%, hsla(var(--nh),60%,22%,0.12) 100%) !important; border-color: hsla(var(--nh),75%,72%,0.95) !important; box-shadow: 0 0 8px 3px hsla(var(--nh),78%,55%,0.6) !important; transition: background 60ms, border-color 60ms, box-shadow 60ms; }
      .port-jack.plugged:not(.note-active) { transition: background 0.18s, border-color 0.18s, box-shadow 0.18s; }

      .ports-in-list, .ports-out-list { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 4px; }
      .port-in-row, .port-out-row { display: flex; align-items: center; }

      .synth-control.dim { opacity: 0.38; }
      .chord-panel .jacks-l, .chord-panel .jacks-r { display: none; }
      .chord-panel .panel-body { padding: 10px 0 12px; display: flex; flex-direction: column; }
      .chord-header { padding: 0 10px; display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
      .chord-header .panel-title { margin-bottom: 0; flex: 1; }
      .chord-main { flex: 1; display: flex; min-height: 0; }
      .chord-strip-l, .chord-strip-r { display: flex; flex-direction: column; align-items: center; min-width: 20px; padding: 0 3px; }
      .chord-strip-l { border-right: 1px solid rgba(255,255,255,0.09); justify-content: center; }
      .chord-strip-r { border-left:  1px solid rgba(255,255,255,0.09); justify-content: space-evenly; }
      .chord-content { flex: 1; padding: 0 10px; display: flex; flex-direction: column; justify-content: space-evenly; }
      .chord-row { display: flex; align-items: center; gap: 5px; }
      .chord-note-light { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); flex-shrink: 0; transition: background 0.5s, box-shadow 0.5s; }
      .chord-note-light.chord-voice-active { background: hsla(var(--lh,42),72%,58%,0.9); box-shadow: 0 0 5px 2px hsla(var(--lh,42),70%,55%,0.5); transition: none; }
      .chord-split-btn { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.55); padding: 1px 6px; cursor: pointer; border-radius: 2px; font-size: 8px; font-family: inherit; white-space: nowrap; }
      .chord-split-btn.active { background: rgba(255,175,40,0.18); color: rgba(255,200,80,0.95); border-color: rgba(255,175,40,0.45); }
      .seq-gate-ctrl { display: flex; flex-direction: column; align-items: center; gap: 1px; }
      .seq-gate-ctrl label { font-size: 7px; color: rgba(255,255,255,0.4); letter-spacing: 0.05em; }
      .seq-gate-ctrl .val { font-size: 7px; color: rgba(255,255,255,0.5); }
      .seq-footer { display: flex; gap: 4px; margin-top: 5px; }

      .voice-toggle-btn { display: block; width: 100%; margin-top: 5px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); padding: 2px 0; cursor: pointer; border-radius: 2px; font-size: 8px; font-family: inherit; letter-spacing: 0.1em; }
      .voice-toggle-btn::after { content: ' ▸'; }
      .panel-box.voice-open .voice-toggle-btn { color: rgba(255,255,255,0.6); border-color: rgba(255,255,255,0.2); }
      .panel-box.voice-open .voice-toggle-btn::after { content: ' ▾'; }
      .voice-panel { display: none; border-left: 1px solid rgba(255,255,255,0.09); padding: 22px 8px 8px; flex-direction: column; justify-content: flex-start; }
      .panel-box.voice-open .voice-panel { display: flex; }
      .voice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }

      .osc-body { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .wave-preview { display: block; margin-bottom: 5px; opacity: 0.8; }
      .oct-switch { display: flex; gap: 3px; margin: 5px 0; }
      .oct-btn { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); padding: 2px 6px; cursor: pointer; border-radius: 2px; font-size: 9px; font-family: inherit; }
      .oct-btn.oct-active { background: rgba(255,255,255,0.2); color: rgba(255,255,255,0.95); border-color: rgba(255,255,255,0.35); }
      .osc-special { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-top: 4px; }
      .osc-special label { font-size: 8px; color: rgba(255,255,255,0.35); }

      .filter-type-row { display: flex; gap: 3px; margin-bottom: 6px; }
      .filter-type-btn { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.55); padding: 2px 6px; cursor: pointer; border-radius: 2px; font-size: 9px; font-family: inherit; }
      .filter-type-btn.active { background: rgba(255,255,255,0.2); color: rgba(255,255,255,0.95); border-color: rgba(255,255,255,0.35); }

      .seq-panel { min-width: 220px; }
      .seq-toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
      .seq-rate-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
      .seq-rate-btn { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.13); color: rgba(255,255,255,0.5); padding: 2px 0; cursor: pointer; border-radius: 2px; font-size: 8px; font-family: inherit; text-align: center; }
      .seq-rate-btn.active { background: rgba(255,255,255,0.2); color: rgba(255,255,255,0.95); border-color: rgba(255,255,255,0.32); }
      .seq-bars-btn, .seq-collapse-btn, .seq-fold-btn { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.55); padding: 2px 5px; cursor: pointer; border-radius: 2px; font-size: 8px; font-family: inherit; }
      .seq-fold-btn.active { background: rgba(120,220,160,0.18); border-color: rgba(120,220,160,0.5); color: rgba(140,240,180,1); }
      .seq-grid-wrap.collapsed { display: none; }
      .seq-grid { display: grid; gap: 0; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); }
      .note-seq-grid { grid-template-columns: repeat(var(--seq-cols,16), 1fr); }
      .drum-seq-grid { grid-template-columns: repeat(var(--drum-cols,16), 1fr); }
      .seq-cell { width: 15px; height: 9px; background: hsla(var(--ph,180),35%,14%,0.6); cursor: pointer; border-radius: 0; box-sizing: border-box; position: relative; border-right: 1px solid rgba(0,0,0,0.4); border-bottom: 1px solid rgba(0,0,0,0.4); }
      .seq-cell.vel-1 { background: hsla(var(--ph,180),65%,45%,0.55); }
      .seq-cell.vel-2 { background: hsla(var(--ph,180),80%,58%,0.88); }
      .seq-cell.vel-3 { background: hsla(var(--ph,180),90%,74%,1); }
      .seq-cell.tonic-row { border-bottom: 1px solid hsla(var(--ph,180),55%,50%,0.45); }

      .seq-cell.playhead, .drum-cell.playhead { outline: 1px solid rgba(255,255,255,0.85); outline-offset: -1px; }
      .drum-cell { width: 15px; height: 14px; background: rgba(255,255,255,0.05); cursor: pointer; border-radius: 0; box-sizing: border-box; border-right: 1px solid rgba(0,0,0,0.4); border-bottom: 1px solid rgba(0,0,0,0.4); }
      .drum-cell.vel-1 { background: hsla(var(--ph,300),65%,42%,0.55); }
      .drum-cell.vel-2 { background: hsla(var(--ph,300),70%,55%,0.88); }
      .drum-cell.vel-3 { background: hsla(var(--ph,300),85%,70%,1); }

      .jacks-l .port-jack:not(.port-send) + .port-send,
      .jacks-r .port-jack:not(.port-send) + .port-send { margin-top: auto; }
      .mix-strips { display: flex; gap: 4px; align-items: flex-end; }
      .fader-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .mix-master-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; border-left: 1px solid rgba(255,255,255,0.08); padding-left: 5px; margin-left: 1px; }
      .mix-master-lbl { font-size: 7px; color: rgba(255,255,255,0.3); letter-spacing: 0.06em; }
      .mix-send-col { display: flex; flex-direction: column; gap: 2px; }
      .mix-send-knob { display: block; }
    `;
    document.head.appendChild(style);
  }

}
