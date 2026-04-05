import type { ModuleDef, ModuleCategory, Port } from '../types';

export interface ShopDef {
  type: string;
  name: string;
  desc: string;
  tab: string;
  price?: number;
}

// ─────────────────────────────────────────────────────────────
// Port helpers — used only for CATEGORY_PORT_DEFAULTS below
// ─────────────────────────────────────────────────────────────

const audioIn  = (name = 'audio',    label = 'IN')       => ({ name, signal: 'audio' as const, label });
const audioOut = (name = 'audio',    label = 'OUT')      => ({ name, signal: 'audio' as const, label, multi: true });
const noteIn   = (name = 'note-in',  label = 'NOTE IN')  => ({ name, signal: 'note'  as const, label });
const noteOut  = (name = 'note-out', label = 'NOTE OUT') => ({ name, signal: 'note'  as const, label, multi: true });

// ─────────────────────────────────────────────────────────────
// Category-level port defaults
// Modules that omit inputPorts / outputPorts inherit these.
// ─────────────────────────────────────────────────────────────

const CATEGORY_PORT_DEFAULTS: Partial<Record<ModuleCategory, { inputPorts: Port[]; outputPorts: Port[] }>> = {
  osc:       { inputPorts: [noteIn()],   outputPorts: [audioOut()] },
  drum:      { inputPorts: [noteIn()],   outputPorts: [audioOut()] },
  processor: { inputPorts: [audioIn()],  outputPorts: [audioOut()] },
};

// ─────────────────────────────────────────────────────────────
// Module registry — populated from moduleSpecs/ at build time
// ─────────────────────────────────────────────────────────────

let MODULE_DEFS: Record<string, ModuleDef> = {};

export function getModuleDef(type: string): ModuleDef | undefined {
  const base = MODULE_DEFS[type];
  if (!base) return undefined;
  const catDef = CATEGORY_PORT_DEFAULTS[base.category];
  if (!catDef) return base;
  return {
    ...base,
    inputPorts:  base.inputPorts  ?? catDef.inputPorts,
    outputPorts: base.outputPorts ?? catDef.outputPorts,
  };
}

export function getRuntimeType(type: string): string {
  return getModuleDef(type)?.runtimeType ?? type;
}

// ─────────────────────────────────────────────────────────────
// Discovery — import all spec files and build MODULE_DEFS +
// SHOP_DEFS in one pass
// ─────────────────────────────────────────────────────────────

const _specEntries = import.meta.glob('../moduleSpecs/**/*.ts', { eager: true }) as Record<string, { spec?: ModuleDef }>;
const _shopDefs: ShopDef[] = [];

for (const [path, entry] of Object.entries(_specEntries)) {
  const spec = entry.spec;
  if (!spec?.label) continue;

  const inferredTab = path.split('/').slice(-2, -1)[0] ?? 'misc';
  const shop = spec.shop ? { ...spec.shop, tab: spec.shop.tab ?? inferredTab } : undefined;
  const type = spec.type ?? spec.label.toLowerCase();

  MODULE_DEFS[type] = { ...spec, shop };

  if (shop) {
    _shopDefs.push({ type, name: shop.name, desc: shop.desc, tab: shop.tab, price: shop.price });
  }
}

export const SHOP_DEFS: ShopDef[] = _shopDefs;
