/**
 * Pure, host-independent helpers shared between the TypeScript build (panel.ts)
 * and the unit-test suite (test/unit.ts).  No vscode or DOM dependencies.
 *
 * The webview-inlined copies of `groupEdges` and `stateLines` inside the
 * `<script>` template in panel.ts mirror these implementations exactly.
 */

export interface GroupedEdge {
  from: string;
  to: string;
  conditions: string[];
  isSelf: boolean;
}

/** HTML-escape a plain string for safe insertion into attribute values or text. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Group a flat transition list into directed edges, merging parallel transitions
 * (same from→to) into a single edge with multiple conditions.  De-duplicates
 * identical condition strings within a group.
 */
export function groupEdges(
  transitions: Array<{ from: string; to: string; condition: string }>,
): GroupedEdge[] {
  const map = new Map<string, GroupedEdge>();
  for (const tr of transitions) {
    const key = tr.from + '|||' + tr.to;
    if (!map.has(key)) {
      map.set(key, { from: tr.from, to: tr.to, conditions: [], isSelf: tr.from === tr.to });
    }
    const g = map.get(key)!;
    if (!g.conditions.includes(tr.condition)) g.conditions.push(tr.condition);
  }
  return Array.from(map.values());
}

/**
 * Split a state name into 1–3 display lines for the SVG label.
 * Names ≤14 chars → 1 line; 15–20 chars → 2 lines (split on `_`);
 * >20 chars → 3 lines.  Mirrors the `stateLines` function in the webview script.
 */
export function stateLines(name: string): string[] {
  if (name.length > 20) {
    const p = name.split('_');
    const t = Math.ceil(p.length / 3);
    return [
      p.slice(0, t).join('_'),
      p.slice(t, t * 2).join('_'),
      p.slice(t * 2).join('_'),
    ].filter(s => s);
  }
  if (name.length > 14) {
    const p = name.split('_');
    const h = Math.ceil(p.length / 2);
    return [p.slice(0, h).join('_'), p.slice(h).join('_')].filter(s => s);
  }
  return [name];
}
