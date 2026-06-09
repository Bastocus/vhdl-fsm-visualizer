/**
 * VHDL FSM Parser  v0.3  (Phase 1 — recursive block parser)
 *
 * Changes vs v0.2:
 *  - The flatten-and-walk machinery (tokeniseBlock / walkTokens / flat Token list)
 *    is replaced by a recursive-descent walker, `parseStatements`, that descends
 *    into nested `if/elsif/else` and nested `case` constructs.
 *  - Conditions are now full AND-chains accumulated down the nesting, with explicit
 *    negation for `elsif`/`else` branches (`if a` → `a`; `elsif b` → `not (a) and b`;
 *    `else` → `not (a) and not (b)`).
 *  - Nested `case <sel> is` contributes selector conditions (`sel = V`); a nested
 *    `when others` contributes the negation chain of the arm's sibling labels.
 *  - Condition / identifier text is always sliced from `originalSource` at the matched
 *    offsets so the original source case is preserved.
 *
 * Unchanged front-end (kept from v0.2): normalisation/comment-padding, enum & signal
 * extraction, entity/architecture names, `findMatchingEndCase`, and the various helpers.
 *
 * Two-process FSMs (Part B), top-level `when others` / multi-label expansion and `:=`
 * (Part C) are intentionally NOT handled here — they land in Phases 2 and 3.
 */

export interface FsmState      { name: string; line: number; }
export interface FsmTransition { from: string; to: string; condition: string; line: number; }
export interface FsmSignal     { name: string; typeName: string; states: string[]; line: number; }

export interface ParsedFsm {
  signalName: string;
  typeName: string;
  states: FsmState[];
  transitions: FsmTransition[];
  entityName: string;
  architectureName: string;
}

export interface ParseResult { fsms: ParsedFsm[]; errors: string[]; }

/** Immutable, per-FSM context threaded through the recursive walker. */
interface FsmCtx {
  assignSigs:  Set<string>;          // lowercase signal names that count as a state assignment
  knownStates: Set<string>;          // lowercase enum state names
  stateOrig:   Map<string, string>;  // lowercase → original-case state name
  out:         FsmTransition[];
}

/** One `when` arm of a case statement, located inside the normalised source. */
interface CaseArm {
  labelStart: number;   // absolute offset of the label text (after "when ")
  labelLen:   number;   // length of the label text (up to, excluding "=>")
  bodyStart:  number;   // absolute offset right after "=>"
  bodyEnd:    number;   // absolute offset of the next arm / end case
}

// ── Parser ───────────────────────────────────────────────────────────────────
export class VhdlFsmParser {
  private normalised     = '';
  private originalSource = '';
  private rawLines:  string[] = [];

  parse(source: string): ParseResult {
    this.originalSource = source;
    this.rawLines       = source.split('\n');
    this.normalised     = this.buildNormalised(source);

    const result: ParseResult = { fsms: [], errors: [] };
    try {
      const entityName       = this.extractEntityName();
      const architectureName = this.extractArchitectureName();
      const enumTypes        = this.extractEnumTypes();
      const fsmSignals       = this.extractFsmSignals(enumTypes);

      for (const sig of fsmSignals) {
        const transitions = this.extractTransitions(sig);
        // A signal that is never *assigned* a state (only read as a `case` selector,
        // e.g. an enum used purely to pick a branch) yields no transitions and is not
        // a state machine — skip it so it doesn't show up as an empty FSM tab.
        if (transitions.length === 0) continue;

        const states: FsmState[] = sig.states.map(s => ({
          name: s,
          line: this.findStateLine(s),
        }));
        result.fsms.push({
          signalName: sig.name,
          typeName:   sig.typeName,
          states,
          transitions,
          entityName,
          architectureName,
        });
      }
    } catch (err) {
      result.errors.push(`Parse error: ${err}`);
    }
    return result;
  }

  // ── Normalisation: lowercase + pad comments with spaces ──────────────────
  // Padding (not stripping) preserves character offsets so that
  // normalised[i] === originalSource[i].toLowerCase() for code chars,
  // making it safe to use match.index to slice from originalSource.
  private buildNormalised(source: string): string {
    return source
      .split('\n')
      .map(line => {
        const ci = line.indexOf('--');
        if (ci >= 0) {
          return line.slice(0, ci).toLowerCase() + ' '.repeat(line.length - ci);
        }
        return line.toLowerCase();
      })
      .join('\n');
  }

  // ── Entity / architecture names ──────────────────────────────────────────
  private extractEntityName(): string {
    const m = this.normalised.match(/\bentity\s+(\w+)\s+is\b/);
    return m ? this.originalAt(m.index! + m[0].indexOf(m[1]), m[1].length) : 'unknown';
  }

  private extractArchitectureName(): string {
    const m = this.normalised.match(/\barchitecture\s+(\w+)\s+of\s+\w+\s+is\b/);
    return m ? this.originalAt(m.index! + m[0].indexOf(m[1]), m[1].length) : 'rtl';
  }

  // ── Enum types ────────────────────────────────────────────────────────────
  // Run the regex on originalSource with 'gi' so captured groups are original-case.
  // Store in map as lowercase-key → original-case-values.
  private extractEnumTypes(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const re = /\btype\s+(\w+)\s+is\s*\(([^)]+)\)\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.originalSource)) !== null) {
      const typeName = m[1].trim();
      const states   = m[2].split(',').map(s => s.trim()).filter(Boolean);
      if (states.length >= 2) {
        result.set(typeName.toLowerCase(), states);   // key=lower, value=original
      }
    }
    return result;
  }

  // ── FSM signals ───────────────────────────────────────────────────────────
  private extractFsmSignals(enumTypes: Map<string, string[]>): FsmSignal[] {
    const signals: FsmSignal[] = [];
    const re = /\bsignal\s+(\w+)\s*:\s*(\w+)(?:\s*:=\s*\w+)?\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.originalSource)) !== null) {
      const sigName  = m[1].trim();
      const typeName = m[2].trim();
      if (enumTypes.has(typeName.toLowerCase())) {
        signals.push({
          name:     sigName,
          typeName,
          states:   enumTypes.get(typeName.toLowerCase())!,
          line:     this.offsetToLine(m.index),
        });
      }
    }
    return signals;
  }

  // ── Transition extraction (outer driver) ─────────────────────────────────
  // For each `case <fsmSignal> is`, split the top-level `when` arms to establish the
  // from-state, then recurse into each arm body with an empty condition stack.
  private extractTransitions(sig: FsmSignal): FsmTransition[] {
    const ctx: FsmCtx = {
      assignSigs:  new Set([sig.name.toLowerCase()]),
      knownStates: new Set(sig.states.map(s => s.toLowerCase())),
      stateOrig:   new Map(sig.states.map(s => [s.toLowerCase(), s])),
      out:         [],
    };

    const headerRe = new RegExp(`\\bcase\\s+${escapeRegex(sig.name.toLowerCase())}\\s+is\\b`, 'g');
    let hm: RegExpExecArray | null;
    while ((hm = headerRe.exec(this.normalised)) !== null) {
      const bodyStart = hm.index + hm[0].length;
      const bodyEnd   = this.findMatchingEndCase(bodyStart);
      if (bodyEnd < 0) continue;
      this.parseTopCase(bodyStart, bodyEnd, ctx);
    }
    return ctx.out;
  }

  /**
   * Top-level FSM case: each `when` arm's label is the *from-state*. Recurse into
   * the arm body with an empty condition stack. (Top-level `when others` and
   * multi-label arms are expanded in Phase 3 — for now only concrete single-state
   * labels are processed.)
   */
  private parseTopCase(bodyStart: number, bodyEnd: number, ctx: FsmCtx): void {
    for (const arm of this.splitCaseArms(bodyStart, bodyEnd)) {
      const labelLower = this.normalised.slice(arm.labelStart, arm.labelStart + arm.labelLen).trim();
      if (!ctx.knownStates.has(labelLower)) continue;   // others / multi-label → Phase 3
      const fromState = ctx.stateOrig.get(labelLower)!;
      this.parseStatements(arm.bodyStart, arm.bodyEnd, [], fromState, ctx);
    }
  }

  // ── Recursive statement walker ────────────────────────────────────────────
  /**
   * Walk the region [start, end) of the normalised source at one nesting level,
   * dispatching on the next control construct found at that level:
   *   - `if … then … [elsif … then …] [else …] end if`
   *   - `case … is … when … => … end case`
   *   - `<sig> <= <state> ;` assignment
   * Each `if`/`case` is consumed whole (up to its matching `end`), so the loop only
   * ever sees constructs at the current depth; nested ones are handled by recursion.
   */
  private parseStatements(
    start:     number,
    end:       number,
    conds:     string[],
    fromState: string,
    ctx:       FsmCtx,
  ): void {
    const sigAlt = [...ctx.assignSigs].map(escapeRegex).join('|');
    const re = new RegExp(
      `\\bif\\b\\s+([\\s\\S]*?)\\s+\\bthen\\b` +
      `|\\bcase\\b\\s+([\\s\\S]*?)\\s+\\bis\\b` +
      `|\\b(?:${sigAlt})\\s*<=\\s*(\\w+)\\s*;`,
      'g',
    );
    re.lastIndex = start;

    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null && m.index < end) {
      if (/^if\b/.test(m[0])) {
        // ── if / elsif / else ──
        const cond = this.fmtCond(this.sliceCond(m, /^if\s+/, m[1].length));
        const thenEnd  = m.index + m[0].length;
        const endIf    = this.findMatchingEndIf(thenEnd);
        const stop     = endIf < 0 ? end : endIf;
        this.parseIf(cond, thenEnd, stop, conds, fromState, ctx);
        re.lastIndex = this.tokenEnd(stop, /\bend\s+if\b/);
      } else if (/^case\b/.test(m[0])) {
        // ── case ──
        const selStart = m.index + /^case\s+/.exec(m[0])![0].length;
        const headEnd  = m.index + m[0].length;
        const endCase  = this.findMatchingEndCase(headEnd);
        const stop     = endCase < 0 ? end : endCase;
        this.parseCase(selStart, m[2].length, headEnd, stop, conds, fromState, ctx);
        re.lastIndex = this.tokenEnd(stop, /\bend\s+case\b/);
      } else {
        // ── assignment ──
        const targetLower = m[3].toLowerCase();
        if (ctx.knownStates.has(targetLower)) {
          this.emit(fromState, ctx.stateOrig.get(targetLower)!, conds, m.index, ctx);
        }
      }
    }
  }

  /**
   * Parse an `if … end if`. The region [thenEnd, endIf) is split at depth-0 `elsif`
   * and `else` into branches; each branch is recursed with the appropriate guard:
   *   if c0        → conds + [c0]
   *   elsif ck     → conds + [not(c0) … not(c_{k-1}), ck]
   *   else         → conds + [not(c0) … not(c_last)]
   */
  private parseIf(
    c0: string,
    thenEnd: number,
    endIf: number,
    conds: string[],
    fromState: string,
    ctx: FsmCtx,
  ): void {
    interface Seg { kind: 'if' | 'elsif' | 'else'; cond?: string; bodyStart: number; bodyEnd: number; }
    const segs: Seg[] = [{ kind: 'if', cond: c0, bodyStart: thenEnd, bodyEnd: endIf }];

    const re = /\bend\s+if\b|\bend\s+case\b|\belsif\b\s+([\s\S]*?)\s+\bthen\b|\belse\b|\bif\b|\bcase\b/g;
    re.lastIndex = thenEnd;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null && m.index < endIf) {
      const t = m[0];
      if (/^end/.test(t))                       { depth--; continue; }
      if (/^if\b/.test(t) || /^case\b/.test(t)) { depth++; continue; }
      if (depth !== 0) continue;                // elsif/else belonging to a nested if

      segs[segs.length - 1].bodyEnd = m.index;  // close the previous branch
      if (/^elsif/.test(t)) {
        const cond = this.fmtCond(this.sliceCond(m, /^elsif\s+/, m[1].length));
        segs.push({ kind: 'elsif', cond, bodyStart: m.index + t.length, bodyEnd: endIf });
      } else {
        segs.push({ kind: 'else', bodyStart: m.index + t.length, bodyEnd: endIf });
      }
    }

    const prior: string[] = [];   // conditions of preceding branches, for negation
    for (const seg of segs) {
      let guard: string[];
      if (seg.kind === 'if') {
        guard = [seg.cond!];
        prior.push(seg.cond!);
      } else if (seg.kind === 'elsif') {
        guard = [...prior.map(c => this.negate(c)), seg.cond!];
        prior.push(seg.cond!);
      } else {
        guard = prior.map(c => this.negate(c));
      }
      this.parseStatements(seg.bodyStart, seg.bodyEnd, conds.concat(guard), fromState, ctx);
    }
  }

  /**
   * Parse a `case … end case`. Each arm contributes a selector condition:
   *   `when V`        → `sel = V`
   *   `when V1 | V2`  → `(sel = V1 or sel = V2)`
   *   `when others`   → `not (sel = A) and not (sel = B) …` over sibling labels
   * The from-state is inherited from the enclosing FSM arm (a nested case never
   * changes the from-state).
   */
  private parseCase(
    selStart: number,
    selLen: number,
    bodyStart: number,
    bodyEnd: number,
    conds: string[],
    fromState: string,
    ctx: FsmCtx,
  ): void {
    const sel  = this.fmtCond(this.originalAt(selStart, selLen));
    const arms = this.splitCaseArms(bodyStart, bodyEnd);

    // Sibling concrete labels, used to build the `others` negation chain.
    const covered: string[] = [];
    for (const a of arms) {
      const lower = this.normalised.slice(a.labelStart, a.labelStart + a.labelLen).trim();
      if (lower === 'others') continue;
      const orig = this.originalAt(a.labelStart, a.labelLen).trim();
      for (const part of orig.split('|')) covered.push(part.trim());
    }

    for (const a of arms) {
      const lower = this.normalised.slice(a.labelStart, a.labelStart + a.labelLen).trim();
      let selConds: string[];
      if (lower === 'others') {
        selConds = covered.map(v => this.negate(`${sel} = ${v}`));
      } else {
        const parts = this.originalAt(a.labelStart, a.labelLen).trim()
          .split('|').map(s => s.trim()).filter(Boolean);
        selConds = parts.length === 1
          ? [`${sel} = ${parts[0]}`]
          : ['(' + parts.map(v => `${sel} = ${v}`).join(' or ') + ')'];
      }
      this.parseStatements(a.bodyStart, a.bodyEnd, conds.concat(selConds), fromState, ctx);
    }
  }

  // ── Emit a transition (with de-dup on from|to|condition) ──────────────────
  private emit(from: string, to: string, conds: string[], offset: number, ctx: FsmCtx): void {
    const condition = this.joinConds(conds);
    const line      = this.offsetToLine(offset);
    const dup = ctx.out.some(t => t.from === from && t.to === to && t.condition === condition);
    if (!dup) ctx.out.push({ from, to, condition, line });
  }

  // ── Case-arm splitter (depth-aware) ───────────────────────────────────────
  /**
   * Split the case body [start, end) into its top-level `when` arms. Nested
   * `if`/`case` increment a depth counter so their inner `when`s are skipped.
   */
  private splitCaseArms(start: number, end: number): CaseArm[] {
    const re = /\bend\s+case\b|\bend\s+if\b|\bcase\b|\bif\b|\bwhen\b\s+([\s\S]*?)\s*=>/g;
    re.lastIndex = start;
    let depth = 0;
    const arms: CaseArm[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null && m.index < end) {
      const t = m[0];
      if (/^end/.test(t))                       { depth--; continue; }
      if (/^case\b/.test(t) || /^if\b/.test(t)) { depth++; continue; }
      if (depth !== 0) continue;                // `when` of a nested case

      const labelStart = m.index + /^when\s+/.exec(t)![0].length;
      if (arms.length) arms[arms.length - 1].bodyEnd = m.index;
      arms.push({ labelStart, labelLen: m[1].length, bodyStart: m.index + t.length, bodyEnd: end });
    }
    if (arms.length) arms[arms.length - 1].bodyEnd = end;
    return arms;
  }

  // ── Block-matching helpers ────────────────────────────────────────────────
  /**
   * Walk forward from `from` in normalised, tracking `case` depth, and
   * return the index of the `end case` that closes depth 1.
   */
  private findMatchingEndCase(from: number): number {
    const re = /\bend\s+case\b|\bcase\b/g;
    re.lastIndex = from;
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null) {
      if (/^end\s+case/.test(m[0])) { if (--depth === 0) return m.index; }
      else                          { depth++; }
    }
    return -1;
  }

  /** Mirror of findMatchingEndCase for `if` / `end if` (elsif does not nest). */
  private findMatchingEndIf(from: number): number {
    const re = /\bend\s+if\b|\bif\b/g;
    re.lastIndex = from;
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null) {
      if (/^end\s+if/.test(m[0])) { if (--depth === 0) return m.index; }
      else                        { depth++; }
    }
    return -1;
  }

  /** Length-aware end of a closing token (`end if` / `end case`) starting at `idx`. */
  private tokenEnd(idx: number, token: RegExp): number {
    const re = new RegExp(token.source, 'y');
    re.lastIndex = idx;
    const m = re.exec(this.normalised);
    return m ? idx + m[0].length : idx;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Slice the captured group of `m` from originalSource, given the match's prefix. */
  private sliceCond(m: RegExpExecArray, prefix: RegExp, len: number): string {
    const start = m.index + prefix.exec(m[0])![0].length;
    return this.originalAt(start, len);
  }

  /** Negate a single condition. `x = '1'` → `not (x)`; anything else → `not (cond)`. */
  private negate(cond: string): string {
    const m = /^(.+?)\s*=\s*'1'$/.exec(cond);
    return m ? `not (${m[1].trim()})` : `not (${cond})`;
  }

  /** Join an AND-chain of conditions; empty chain → "(always)". */
  private joinConds(conds: string[]): string {
    const parts = conds.filter(Boolean);
    return parts.length ? parts.join(' and ') : '(always)';
  }

  /** Normalise whitespace in a condition string; preserve original case. */
  private fmtCond(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
  }

  /** Extract text from originalSource at [offset, offset+length). */
  private originalAt(offset: number, length: number): string {
    return this.originalSource.slice(offset, offset + length);
  }

  /** Convert a byte offset in normalised/originalSource to a 1-based line number. */
  private offsetToLine(offset: number): number {
    return this.normalised.slice(0, offset).split('\n').length;
  }

  /** Find the first line containing stateName (original case, case-insensitive). */
  private findStateLine(name: string): number {
    const lo = name.toLowerCase();
    for (let i = 0; i < this.rawLines.length; i++) {
      const ci = this.rawLines[i].indexOf('--');
      const line = ci >= 0 ? this.rawLines[i].slice(0, ci) : this.rawLines[i];
      if (line.toLowerCase().includes(lo)) return i + 1;
    }
    return 1;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
