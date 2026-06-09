/**
 * Parser regression runner.
 *
 * Reads every test/fixtures/*.vhd, parses it with VhdlFsmParser, and compares the
 * produced transitions against the fixture's own `-- EXPECT` header lines:
 *
 *     -- EXPECT <from> -> <to> | <condition>
 *     -- EXPECT <from> -> <to>            (condition ignored)
 *     -- EXPECT <from> -> <to> | *        (condition ignored)
 *
 * Comparison is whitespace-normalised and case-insensitive. A fixture passes when
 * every expected transition is produced AND no extra transition is produced
 * (extras are matched leniently against `*`/condition-less expectations).
 *
 * KNOWN_FAILS lists fixtures whose corner case isn't fixed yet. They are allowed to
 * fail without breaking the build; remove a name from the list as its phase lands.
 * Run with: npm test
 */
import * as fs from 'fs';
import * as path from 'path';
import { VhdlFsmParser, FsmTransition } from '../src/parser';

// Fixtures not yet supported — updated as each phase lands.
// Phase 1 (recursive parser) landed: nested_if, if_elsif_else, nested_case and
// nested_if_in_case now pass and have been removed from this list.
// Phase 2 (two-process FSMs / group signals by enum type) landed: two_process passes.
const KNOWN_FAILS = new Set<string>([
  'when_others',        // Phase 3: expand `when others` to uncovered states
  'when_multi_label',   // Phase 3: expand `when a | b` to per-label transitions
  'variable_assign',    // Phase 3: recognise `:=` assignments
]);

interface Expected { from: string; to: string; cond: string | null; }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function parseExpectations(source: string): Expected[] {
  const out: Expected[] = [];
  const re = /--\s*EXPECT\s+(.+?)\s*->\s*([^|\n]+?)\s*(?:\|\s*(.*))?$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const cond = m[3] !== undefined ? m[3].trim() : null;
    out.push({
      from: m[1].trim(),
      to: m[2].trim(),
      cond: cond === null || cond === '*' || cond === '' ? null : cond,
    });
  }
  return out;
}

function matches(exp: Expected, tr: FsmTransition): boolean {
  if (norm(exp.from) !== norm(tr.from)) return false;
  if (norm(exp.to) !== norm(tr.to)) return false;
  if (exp.cond === null) return true;            // wildcard condition
  return norm(exp.cond) === norm(tr.condition);
}

interface Diff { missing: Expected[]; extra: FsmTransition[]; }

function diff(expected: Expected[], actual: FsmTransition[]): Diff {
  const missing = expected.filter(e => !actual.some(a => matches(e, a)));
  const extra = actual.filter(a => !expected.some(e => matches(e, a)));
  return { missing, extra };
}

function fmtTr(t: FsmTransition): string {
  return `${t.from} -> ${t.to} | ${t.condition}`;
}
function fmtExp(e: Expected): string {
  return `${e.from} -> ${e.to} | ${e.cond ?? '*'}`;
}

function main(): void {
  const dir = path.join(__dirname, 'fixtures');
  if (!fs.existsSync(dir)) {
    console.error(`No fixtures directory at ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.vhd')).sort();

  let realFails = 0;
  let passed = 0;
  const unexpectedPasses: string[] = [];

  for (const file of files) {
    const base = file.replace(/\.vhd$/, '');
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const expected = parseExpectations(source);

    const result = new VhdlFsmParser().parse(source);
    const actual = result.fsms.flatMap(f => f.transitions);

    const { missing, extra } = diff(expected, actual);
    const ok = missing.length === 0 && extra.length === 0 && result.errors.length === 0;
    const known = KNOWN_FAILS.has(base);

    if (ok) {
      passed++;
      if (known) {
        unexpectedPasses.push(base);
        console.log(`  PASS* ${file}  (was known-fail — remove from KNOWN_FAILS)`);
      } else {
        console.log(`  PASS  ${file}  (${actual.length} transitions)`);
      }
      continue;
    }

    const tag = known ? 'XFAIL' : 'FAIL ';
    console.log(`  ${tag} ${file}`);
    if (result.errors.length) console.log(`        errors: ${result.errors.join('; ')}`);
    for (const e of missing) console.log(`        missing: ${fmtExp(e)}`);
    for (const x of extra)   console.log(`        extra:   ${fmtTr(x)}`);
    if (!known) realFails++;
  }

  console.log('');
  console.log(`Summary: ${passed} passed, ${realFails} failed` +
    (KNOWN_FAILS.size ? `, ${KNOWN_FAILS.size} known-fail` : ''));
  if (unexpectedPasses.length) {
    console.log(`Note: now-passing known-fails: ${unexpectedPasses.join(', ')}`);
  }
  process.exit(realFails > 0 ? 1 : 0);
}

main();
