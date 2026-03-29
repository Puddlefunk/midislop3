import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { GameState }      from '../game/GameState';
import type { NoteRouter }     from '../input/NoteRouter';
import type { AudioGraph }     from '../audio/AudioGraph';
import { SHOP_DEFS, getModuleDef } from '../config/modules';
import { GAME_CONFIG } from '../config/game';

// ─────────────────────────────────────────────────────────────
// ShopSystem — floating shop panel.
// Instantiated in main.ts; toggled via shopSystem.toggle().
// ─────────────────────────────────────────────────────────────

const TABS = [
  { id: 'generators', label: 'GEN'   },
  { id: 'voices',     label: 'VOICE' },
  { id: 'note',       label: 'NOTE'  },
  { id: 'drums',      label: 'DRUM'  },
  { id: 'fx',         label: 'FX'    },
] as const;

type TabId = typeof TABS[number]['id'];

export class ShopSystem {
  private registry:   ModuleRegistry;
  private gameState:  GameState;
  private router:     NoteRouter;
  private audioGraph: AudioGraph;

  private panel:     HTMLElement;
  private itemsEl:   HTMLElement;
  private balEl:     HTMLElement;
  private activeTab: TabId = 'generators';
  private _isOpen = false;

  // Drag state
  private _drag: { ox: number; oy: number } | null = null;
  private _onSave: (() => void) | null = null;

  constructor(
    registry:   ModuleRegistry,
    gameState:  GameState,
    router:     NoteRouter,
    audioGraph: AudioGraph,
    onSave?: () => void,
  ) {
    this.registry   = registry;
    this.gameState  = gameState;
    this.router     = router;
    this.audioGraph = audioGraph;
    this._onSave    = onSave ?? null;

    this._injectStyles();
    this.panel    = this._buildPanel();
    this.itemsEl  = this.panel.querySelector<HTMLElement>('.shop-items')!;
    this.balEl    = this.panel.querySelector<HTMLElement>('.shop-balance')!;

    document.body.appendChild(this.panel);
    this._initDrag();
    this._initTabs();

    window.addEventListener('module-sell', (e: Event) => {
      this._sell((e as CustomEvent<{ id: string }>).detail.id);
    });
  }

  // ── Public API ───────────────────────────────────────────────

  toggle(): void { this._isOpen ? this.close() : this.open(); }

  open(): void {
    if (!this._isOpen) {
      const W = window.innerWidth;
      this.panel.style.right = '12px';
      this.panel.style.left  = 'auto';
      this.panel.style.top   = '56px';
      this.panel.classList.add('shop-open');
      this._isOpen = true;
    }
    this._render();
  }

  close(): void {
    this.panel.classList.remove('shop-open');
    this._isOpen = false;
  }

  // Call when score changes externally (e.g. cheat codes) to refresh affordability
  refresh(): void { if (this._isOpen) this._render(); }

  // ── Panel construction ───────────────────────────────────────

  private _buildPanel(): HTMLElement {
    const el = document.createElement('div');
    el.id        = 'shop-panel';
    el.className = 'shop-panel';
    el.innerHTML = `
      <div class="shop-header">
        <span class="shop-title">SHOP</span>
        <span class="shop-balance">0 pts</span>
        <button class="shop-close-btn" title="Close">✕</button>
      </div>
      <div class="shop-tabs">
        ${TABS.map((t, i) => `<button class="shop-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="shop-items"></div>`;
    el.querySelector('.shop-close-btn')!.addEventListener('click', () => this.close());
    return el;
  }

  private _initTabs(): void {
    this.panel.querySelectorAll<HTMLElement>('.shop-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset['tab'] as TabId;
        this.panel.querySelectorAll('.shop-tab').forEach(t => t.classList.toggle('active', t === btn));
        this._render();
      });
    });
  }

  private _initDrag(): void {
    const header = this.panel.querySelector<HTMLElement>('.shop-header')!;
    header.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = this.panel.getBoundingClientRect();
      this._drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!this._drag) return;
      this.panel.style.left  = (e.clientX - this._drag.ox) + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.top   = (e.clientY - this._drag.oy) + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (this._drag) { header.style.cursor = ''; this._drag = null; }
    });
  }

  // ── Render ───────────────────────────────────────────────────

  private _render(): void {
    const score = this.gameState.score;
    this.balEl.textContent = score.toLocaleString() + ' pts';
    this.itemsEl.innerHTML = '';

    if (this.activeTab === 'generators') {
      this._renderGenerators(score);
    } else {
      this._renderModules(score);
    }
  }

  private _renderModules(score: number): void {
    const tab = this.activeTab;
    for (const def of SHOP_DEFS) {
      if (def.tab !== tab) continue;
      const modDef = getModuleDef(def.type);
      const price  = GAME_CONFIG.modulePrices[def.type] ?? 0;
      const afford = score >= price;
      const qty    = this.registry.countModules(def.type);
      const hue    = modDef?.hue ?? 200;

      const item = document.createElement('div');
      item.className = 'shop-item' + (afford ? ' affordable' : '');
      item.innerHTML = `
        <div class="shop-item-name" style="color:hsla(${hue},68%,68%,0.9)">
          ${def.name}${qty > 0 ? `<span class="shop-item-qty">×${qty}</span>` : ''}
        </div>
        <div class="shop-item-desc">${def.desc}</div>
        <div class="shop-item-footer">
          <span class="shop-item-price">${price === 0 ? 'FREE' : price.toLocaleString() + ' pts'}</span>
          <button class="shop-buy-btn" ${afford ? '' : 'disabled'} data-type="${def.type}">
            ${price === 0 && qty === 0 ? 'CLAIM' : 'BUY'}
          </button>
        </div>`;
      this.itemsEl.appendChild(item);
    }

    this.itemsEl.querySelectorAll<HTMLButtonElement>('.shop-buy-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => this._buy(btn.dataset['type']!));
    });
  }

  private _renderGenerators(score: number): void {
    // Sequencers section
    this._sectionLabel('SEQUENCERS');
    for (const def of SHOP_DEFS) {
      if (def.tab !== 'generators') continue;
      const price  = GAME_CONFIG.modulePrices[def.type] ?? 0;
      const afford = score >= price;
      const qty    = this.registry.countModules(def.type);
      const hue    = getModuleDef(def.type)?.hue ?? 200;

      const item = document.createElement('div');
      item.className = 'shop-item' + (afford ? ' affordable' : '');
      item.innerHTML = `
        <div class="shop-item-name" style="color:hsla(${hue},68%,68%,0.9)">
          ${def.name}${qty > 0 ? `<span class="shop-item-qty">×${qty}</span>` : ''}
        </div>
        <div class="shop-item-desc">${def.desc}</div>
        <div class="shop-item-footer">
          <span class="shop-item-price">${price === 0 ? 'FREE' : price.toLocaleString() + ' pts'}</span>
          <button class="shop-buy-btn" ${afford ? '' : 'disabled'} data-type="${def.type}">BUY</button>
        </div>`;
      this.itemsEl.appendChild(item);
    }

    this.itemsEl.querySelectorAll<HTMLButtonElement>('.shop-buy-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => this._buy(btn.dataset['type']!));
    });

    // MIDI Inputs section
    this._sectionLabel('MIDI INPUTS');

    // midi-all row
    const allMod      = this.registry.getModulesByType('midi-all')[0];
    const allDeployed = !!allMod;
    this._midiRow(
      '♬ ALL MIDI + QWERTY',
      'Routes all MIDI and keyboard input',
      allDeployed,
      () => {
        if (allDeployed && allMod) { this.registry.removeModule(allMod.id); }
        else                       { this.registry.addModule('midi-all'); this.audioGraph.ensure(); }
        this._onSave?.();
        this._render();
      }
    );

    // Per-device rows
    if (this.router.devices.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'shop-gen-empty';
      empty.textContent = 'No MIDI devices connected';
      this.itemsEl.appendChild(empty);
    } else {
      for (const [devId, dev] of this.router.devices) {
        const devMod   = [...this.registry.modules.values()].find(m => m.type === 'midi-in' && m.params['deviceId'] === devId);
        const deployed = !!devMod;
        this._midiRow(
          `♩ ${dev.name}`,
          'Per-device MIDI generator',
          deployed,
          () => {
            if (deployed && devMod) { this.registry.removeModule(devMod.id); }
            else { this.registry.addModule('midi-in', { deviceId: devId, deviceName: dev.name }); this.audioGraph.ensure(); }
            this._onSave?.();
            this._render();
          }
        );
      }
    }
  }

  private _sectionLabel(text: string): void {
    const el = document.createElement('div');
    el.className = 'shop-section-label';
    el.textContent = text;
    this.itemsEl.appendChild(el);
  }

  private _midiRow(name: string, desc: string, deployed: boolean, onClick: () => void): void {
    const row = document.createElement('div');
    row.className = 'shop-item shop-gen-row';
    row.innerHTML = `
      <div class="shop-item-name" style="color:hsla(42,68%,68%,0.9)">${name}</div>
      <div class="shop-item-desc">${desc}</div>
      <div class="shop-item-footer">
        <button class="shop-buy-btn${deployed ? ' gen-deployed' : ''}">${deployed ? 'DEPLOYED' : 'ADD'}</button>
      </div>`;
    row.querySelector<HTMLButtonElement>('.shop-buy-btn')!.addEventListener('click', onClick);
    this.itemsEl.appendChild(row);
  }

  private _sell(id: string): void {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const price = GAME_CONFIG.modulePrices[mod.type] ?? 0;
    if (price === 0) return; // free modules (midi-all, midi-in) cannot be sold
    const refund = Math.floor(price / 2);
    this.gameState.score += refund;
    this.registry.removeModule(id);
    this._onSave?.();
    this._render();
    this.balEl.classList.add('sell-flash');
    setTimeout(() => this.balEl.classList.remove('sell-flash'), 500);
  }

  private _buy(type: string): void {
    const price = GAME_CONFIG.modulePrices[type] ?? 0;
    if (this.gameState.score < price) return;
    this.gameState.score -= price;
    this.registry.addModule(type);
    this.audioGraph.ensure();
    this._onSave?.();
    window.dispatchEvent(new CustomEvent('shop-purchase', { detail: { type, score: this.gameState.score } }));
    this._render();
  }

  // ── Styles ───────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('shop-styles')) return;
    const s = document.createElement('style');
    s.id = 'shop-styles';
    s.textContent = `
      .shop-panel {
        position: fixed;
        top: 56px; right: 12px;
        width: 260px;
        background: rgba(12,11,18,0.97);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 5px;
        font-family: 'Courier New', monospace;
        font-size: 10px;
        color: rgba(255,255,255,0.75);
        z-index: 300;
        display: none;
        flex-direction: column;
        max-height: calc(100vh - 80px);
        user-select: none;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      }
      .shop-panel.shop-open { display: flex; }
      .shop-panel.sell-drop-target {
        outline: 2px solid hsl(120,60%,55%);
        box-shadow: 0 0 24px hsla(120,60%,45%,0.35), 0 8px 32px rgba(0,0,0,0.6);
      }
      .shop-balance.sell-flash {
        color: hsl(120,65%,65%) !important;
        transition: color 0.05s;
      }

      .shop-header {
        display: flex; align-items: center; gap: 8px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        cursor: grab;
      }
      .shop-title { font-weight: 700; letter-spacing: 0.12em; color: rgba(255,255,255,0.8); flex: 1; }
      .shop-balance { font-size: 9px; color: rgba(255,255,255,0.4); }
      .shop-close-btn {
        background: none; border: none; color: rgba(255,255,255,0.3);
        cursor: pointer; font-size: 11px; padding: 0 2px; line-height: 1;
      }
      .shop-close-btn:hover { color: rgba(255,255,255,0.7); }

      .shop-tabs {
        display: flex; gap: 2px;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .shop-tab {
        flex: 1; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.45);
        padding: 3px 0; border-radius: 2px;
        cursor: pointer; font-family: inherit;
        font-size: 8px; font-weight: 600; letter-spacing: 0.05em;
      }
      .shop-tab:hover { background: rgba(255,255,255,0.09); }
      .shop-tab.active { background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.9); border-color: rgba(255,255,255,0.22); }

      .shop-items {
        overflow-y: auto; padding: 6px 8px;
        display: flex; flex-direction: column; gap: 4px;
      }
      .shop-items::-webkit-scrollbar { width: 3px; }
      .shop-items::-webkit-scrollbar-track { background: transparent; }
      .shop-items::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

      .shop-section-label {
        font-size: 8px; letter-spacing: 0.12em;
        color: rgba(255,255,255,0.25);
        padding: 6px 2px 2px; margin-top: 2px;
      }
      .shop-gen-empty { font-size: 9px; color: rgba(255,255,255,0.25); padding: 4px 2px; }

      .shop-item {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 3px; padding: 6px 8px;
        opacity: 0.55; transition: opacity 0.1s, border-color 0.1s;
      }
      .shop-item.affordable { opacity: 1; }
      .shop-item.affordable:hover { border-color: rgba(255,255,255,0.16); }

      .shop-item-name {
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        margin-bottom: 2px;
      }
      .shop-item-qty {
        font-size: 8px; color: rgba(255,255,255,0.35);
        margin-left: 5px; font-weight: 400;
      }
      .shop-item-desc {
        font-size: 8px; color: rgba(255,255,255,0.35);
        line-height: 1.4; margin-bottom: 5px;
      }
      .shop-item-footer { display: flex; align-items: center; justify-content: space-between; }
      .shop-item-price { font-size: 9px; color: rgba(255,255,255,0.4); }

      .shop-buy-btn {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.18);
        color: rgba(255,255,255,0.8);
        padding: 3px 10px; border-radius: 2px;
        cursor: pointer; font-family: inherit;
        font-size: 9px; font-weight: 600; letter-spacing: 0.06em;
      }
      .shop-buy-btn:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
      .shop-buy-btn:disabled { opacity: 0.3; cursor: default; }
      .shop-buy-btn.gen-deployed {
        color: rgba(100,255,140,0.7);
        border-color: rgba(100,255,140,0.3);
        background: rgba(100,255,140,0.06);
      }
    `;
    document.head.appendChild(s);
  }
}
