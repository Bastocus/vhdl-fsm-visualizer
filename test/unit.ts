/**
 * Unit tests for pure helpers in src/panelHelpers.ts.
 * Run with: npx tsx test/unit.ts  (or npm run test:unit)
 */
import { escapeHtml, groupEdges, stateLines } from '../src/panelHelpers';

let passed = 0;
let failed = 0;

function assert(description: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${description}`);
    passed++;
  } else {
    console.log(`  FAIL  ${description}`);
    console.log(`        expected: ${e}`);
    console.log(`        actual:   ${a}`);
    failed++;
  }
}

// ── escapeHtml ────────────────────────────────────────────────────────────────
console.log('\nescapeHtml');
assert('& → &amp;',   escapeHtml('a & b'),             'a &amp; b');
assert('< → &lt;',    escapeHtml('a < b'),             'a &lt; b');
assert('>  → &gt;',   escapeHtml('a > b'),             'a &gt; b');
assert('" → &quot;',  escapeHtml('say "hi"'),          'say &quot;hi&quot;');
assert('all four',    escapeHtml('<a href="x">b&c</a>'), '&lt;a href=&quot;x&quot;&gt;b&amp;c&lt;/a&gt;');
assert('safe string', escapeHtml('hello world'),        'hello world');
assert('empty string',escapeHtml(''),                   '');

// ── groupEdges ────────────────────────────────────────────────────────────────
console.log('\ngroupEdges');

assert('empty input produces empty output',
  groupEdges([]),
  [],
);

assert('single transition becomes one edge',
  groupEdges([{ from: 'a', to: 'b', condition: 'x' }]),
  [{ from: 'a', to: 'b', conditions: ['x'], isSelf: false }],
);

assert('parallel transitions (same from→to) merge into one edge with both conditions',
  groupEdges([
    { from: 'a', to: 'b', condition: 'x' },
    { from: 'a', to: 'b', condition: 'y' },
  ]),
  [{ from: 'a', to: 'b', conditions: ['x', 'y'], isSelf: false }],
);

assert('duplicate condition within same edge is de-duped',
  groupEdges([
    { from: 'a', to: 'b', condition: 'x' },
    { from: 'a', to: 'b', condition: 'x' },
  ]),
  [{ from: 'a', to: 'b', conditions: ['x'], isSelf: false }],
);

assert('different edges kept separate',
  groupEdges([
    { from: 'a', to: 'b', condition: 'x' },
    { from: 'b', to: 'a', condition: 'y' },
  ]),
  [
    { from: 'a', to: 'b', conditions: ['x'], isSelf: false },
    { from: 'b', to: 'a', conditions: ['y'], isSelf: false },
  ],
);

assert('self-loop flagged with isSelf=true',
  groupEdges([{ from: 'a', to: 'a', condition: 'z' }]),
  [{ from: 'a', to: 'a', conditions: ['z'], isSelf: true }],
);

// ── stateLines ────────────────────────────────────────────────────────────────
console.log('\nstateLines');

assert('short name (≤14) → 1 line',
  stateLines('idle'),
  ['idle'],
);

assert('exactly 14 chars → 1 line',
  stateLines('state_running_'), // 14 chars
  ['state_running_'],
);

assert('15-char name → 2 lines split on underscore',
  stateLines('wait_for_enable'),  // 15 chars, 3 parts
  ['wait_for', 'enable'],
);

assert('20-char name → 2 lines',
  stateLines('waiting_for_enable_'), // 19 chars
  ['waiting_for', 'enable_'],
);

assert('>20-char name → 3 lines',
  stateLines('state_a_waiting_for_en'), // 22 chars, 5 parts
  ['state_a', 'waiting_for', 'en'],
);

assert('no underscore in long name → single chunk per line (best-effort)',
  stateLines('averylongstatenamehere'), // 22 chars, no underscore
  ['averylongstatenamehere'],          // split produces ['','',''] filtered to just the original
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`Summary: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
