// ─────────────────────────────────────────────────────────────
// Panel placement helper — extracted from UIRenderer.ts
// ─────────────────────────────────────────────────────────────

export function findClearSpot(
  panelW: number,
  panelH: number,
  xZone: { min: number; max: number } | null
): { left: number; top: number } {
  const margin = 12, pad = 10;
  const W = window.innerWidth, H = window.innerHeight;
  const topBound = 60, botBound = H - 240;
  const occupied = [...document.querySelectorAll('#panels-container .panel-box')]
    .map(p => p.getBoundingClientRect()).filter(r => r.width > 0);

  const search = (lft: number, rgt: number): { left: number; top: number } | null => {
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
