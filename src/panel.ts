import * as vscode from 'vscode';
import { ParsedFsm } from './parser';

export class FsmPanel {
  public static currentPanel: FsmPanel | undefined;
  private static _savedTheme: boolean | null = null;
  private static readonly viewType = 'vhdlFsmDiagram';
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _docUri: vscode.Uri | undefined;
  private _lightTheme: boolean | null = null;
  public locked: boolean = false;

  public static createOrShow(extensionUri: vscode.Uri, fsms: ParsedFsm[], title: string, docUri?: vscode.Uri, preserveFocus = false): void {
    const col = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    if (FsmPanel.currentPanel && !FsmPanel.currentPanel.locked) {
      FsmPanel.currentPanel._panel.reveal(col, preserveFocus);
      FsmPanel.currentPanel._docUri = docUri;
      FsmPanel.currentPanel._update(fsms, title);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      FsmPanel.viewType, 'FSM Diagram', { viewColumn: col, preserveFocus },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    FsmPanel.currentPanel = new FsmPanel(panel, extensionUri);
    FsmPanel.currentPanel._lightTheme = FsmPanel._savedTheme;
    FsmPanel.currentPanel._docUri = docUri;
    FsmPanel.currentPanel._update(fsms, title);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.command === 'goToLine' && typeof msg.line === 'number') {
        await this._goToLine(msg.line);
      }
      if (msg.type === 'themeChange' && typeof msg.isLight === 'boolean') {
        this._lightTheme = msg.isLight;
        FsmPanel._savedTheme = msg.isLight;
      }
      if (msg.type === 'lockChange' && typeof msg.locked === 'boolean') {
        this.locked = msg.locked;
      }
    }, null, this._disposables);
  }

  private async _goToLine(line1Based: number): Promise<void> {
    if (!this._docUri) return;
    const line = Math.max(0, line1Based - 1);
    const range = new vscode.Range(line, 0, line, 0);

    const visible = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === this._docUri!.toString()
    );
    const editor = visible ?? await vscode.window.showTextDocument(this._docUri, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
  }

  public update(fsms: ParsedFsm[], title: string, docUri?: vscode.Uri): void {
    if (docUri) this._docUri = docUri;
    if (this._panel.visible) this._update(fsms, title);
  }

  private _update(fsms: ParsedFsm[], title: string): void {
    this._panel.title = `FSM: ${title}`;
    this._panel.webview.html = this._getHtml(fsms, title);
  }

  public dispose(): void {
    FsmPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { const d = this._disposables.pop(); if (d) d.dispose(); }
  }

  private _getHtml(fsms: ParsedFsm[], title: string): string {
    const themeHint = this._lightTheme === null ? 'auto'
                    : this._lightTheme ? 'light' : 'dark';
    const fsmData       = JSON.stringify(fsms);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>FSM Diagram</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f1117;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;
  height:100vh;display:flex;flex-direction:column;overflow:hidden;}
body.light{background:#fef7f0;color:#3d3229;}

.header{display:flex;align-items:center;gap:12px;padding:10px 16px;
  background:#1a1d27;border-bottom:1px solid #2e3350;flex-shrink:0;}
body.light .header{background:#fff;border-color:#e8dccf;}
.header-icon{width:28px;height:28px;border-radius:6px;
  background:linear-gradient(135deg,#4f9cf9,#a78bfa);
  display:flex;align-items:center;justify-content:center;font-size:15px;}
body.light .header-icon{background:linear-gradient(135deg,#d97706,#f97316);}
.header-title{font-size:13px;font-weight:600;flex:1;}
.header-file{font-size:11px;color:#8892a4;font-family:monospace;}
body.light .header-file{color:#8b7355;}

.tab-bar{display:flex;background:#1a1d27;border-bottom:1px solid #2e3350;
  padding:0 16px;flex-shrink:0;}
body.light .tab-bar{background:#fff;border-color:#e8dccf;}
.tab{padding:7px 16px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;
  color:#8892a4;transition:color .15s;user-select:none;}
.tab:hover{color:#e2e8f0;}
body.light .tab:hover{color:#3d3229;}
.tab.active{color:#4f9cf9;border-bottom-color:#4f9cf9;}
body.light .tab.active{color:#d97706;border-bottom-color:#d97706;}

.toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;
  background:#1a1d27;border-bottom:1px solid #2e3350;flex-shrink:0;}
body.light .toolbar{background:#fff;border-color:#e8dccf;}
.btn{padding:4px 10px;border-radius:5px;border:1px solid #2e3350;
  background:#22263a;color:#e2e8f0;font-size:11px;cursor:pointer;
  transition:all .15s;display:flex;align-items:center;gap:5px;}
body.light .btn{border-color:#e8dccf;background:#fef0e4;color:#3d3229;}
.btn:hover{border-color:#4f9cf9;color:#4f9cf9;}
body.light .btn:hover{border-color:#d97706;color:#d97706;}
.btn svg{width:13px;height:13px;}
.sep{width:1px;height:20px;background:#2e3350;margin:0 2px;}
body.light .sep{background:#e8dccf;}
.zoom-lbl{font-size:11px;color:#8892a4;font-family:monospace;min-width:42px;text-align:center;}
.hint{margin-left:auto;font-size:11px;color:#8892a4;}
body.light .hint{color:#8b7355;}

.canvas-wrap{flex:1;position:relative;overflow:hidden;cursor:grab;}
.canvas-wrap.grabbing{cursor:grabbing;}
#diagram-svg{position:absolute;top:0;left:0;width:100%;height:100%;}

/* Tooltip — fixed position, pointer-events:none so it never intercepts clicks */
#tt{
  position:fixed;z-index:200;pointer-events:none;display:none;
  background:#161b2e;border:1px solid #4f9cf9;border-radius:8px;
  padding:9px 13px;font-size:11.5px;font-family:monospace;
  color:#e2e8f0;max-width:400px;word-break:break-word;line-height:1.7;
  box-shadow:0 6px 24px rgba(0,0,0,.6);
}
body.light #tt{background:#fff;border-color:#d97706;color:#3d3229;box-shadow:0 4px 18px rgba(0,0,0,.12);}
#tt .tt-header{font-weight:700;color:#4f9cf9;margin-bottom:5px;font-size:12px;}
body.light #tt .tt-header{color:#d97706;}
#tt .tt-row{padding:1px 0;}
#tt .tt-row:before{content:'→  ';color:#94a3b8;}
body.light #tt .tt-row:before{color:#9a6b48;}
#tt .tt-single{padding:1px 0;}

.info-panel{position:absolute;bottom:14px;right:14px;
  background:#1a1d27;border:1px solid #2e3350;border-radius:10px;
  padding:12px 14px;min-width:180px;font-size:11px;z-index:5;}
body.light .info-panel{background:#fff;border-color:#e8dccf;}
.info-panel h4{font-size:11px;font-weight:600;color:#8892a4;
  text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
body.light .info-panel h4{color:#8b7355;}
.info-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0;}
.info-row .v{color:#4f9cf9;font-family:monospace;font-weight:600;}
body.light .info-row .v{color:#d97706;}
.info-note{margin-top:6px;color:#8892a4;font-size:10px;}

.empty{flex:1;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;color:#8892a4;}
.empty-icon{font-size:48px;opacity:.4;}
.empty h3{font-size:16px;color:#e2e8f0;}
body.light .empty h3{color:#3d3229;}
.empty p{font-size:13px;max-width:360px;text-align:center;line-height:1.5;}
.empty code{font-family:monospace;background:#22263a;padding:1px 5px;border-radius:3px;color:#4f9cf9;}
body.light .empty code{background:#fef0e4;color:#d97706;}

.transitions-panel{flex-shrink:0;display:flex;flex-direction:column;
  background:#1a1d27;border-top:1px solid #2e3350;}
body.light .transitions-panel{background:#fff;border-color:#e8dccf;}
.tp-resize{height:6px;flex-shrink:0;cursor:row-resize;}
.tp-resize:hover{background:rgba(79,156,249,0.25);}
body.light .tp-resize:hover{background:rgba(217,119,6,0.18);}
.tp-header{display:flex;align-items:center;gap:8px;padding:8px 14px;
  cursor:pointer;user-select:none;font-size:12px;font-weight:600;
  color:#8892a4;flex-shrink:0;}
.tp-header:hover{color:#e2e8f0;}
body.light .tp-header{color:#8b7355;}
body.light .tp-header:hover{color:#3d3229;}
.tp-chevron{font-size:10px;display:inline-block;transition:transform .15s;}
.tp-chevron.collapsed{transform:rotate(-90deg);}
.tp-body{flex:1;min-height:0;overflow-y:auto;border-top:1px solid #2e3350;}
body.light .tp-body{border-color:#e8dccf;}
.tp-table{width:100%;border-collapse:collapse;font-size:11.5px;}
.tp-table th{position:sticky;top:0;text-align:left;padding:6px 10px;
  background:#1a1d27;color:#8892a4;font-weight:600;
  border-bottom:1px solid #2e3350;}
body.light .tp-table th{background:#fff;color:#8b7355;border-color:#e8dccf;}
.tp-table td{padding:5px 10px;border-bottom:1px solid #22263a;white-space:nowrap;}
body.light .tp-table td{border-color:#fef0e4;}
.tp-table tr.tp-row:hover{background:rgba(79,156,249,0.12);}
body.light .tp-table tr.tp-row:hover{background:rgba(217,119,6,0.07);}
.tp-cond{font-family:Consolas,'Cascadia Code','Fira Code',monospace;
  color:#8892a4;white-space:normal;word-break:break-word;}
body.light .tp-cond{color:#8b7355;}
.tp-line{font-family:Consolas,'Cascadia Code','Fira Code',monospace;
  color:#8892a4;text-align:left;}
body.light .tp-line{color:#8b7355;}
.tp-line-link{cursor:pointer;color:#4f9cf9;text-decoration:none;user-select:none;}
body.light .tp-line-link{color:#d97706;}
.tp-line-link:hover{text-decoration:underline;color:#6eb3ff;}
body.light .tp-line-link:hover{color:#b45309;}

.info-link{cursor:pointer;text-decoration:none;}
.info-link:hover{text-decoration:underline;}
</style>
</head>
<body>

<div class="header">
  <div class="header-icon">&#11041;</div>
  <div class="header-title">FSM Visualizer</div>
  <div class="header-file">${esc(title)}</div>
</div>
<div id="tab-bar" class="tab-bar"></div>
<div id="toolbar" class="toolbar" style="display:none">
  <button class="btn" onclick="zoomIn()">
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 1a6.5 6.5 0 100 13A6.5 6.5 0 007.5 1zm0 1a5.5 5.5 0 110 11A5.5 5.5 0 017.5 2zM7 4.5v2.5H4.5v1H7V10.5h1V8h2.5V7H8V4.5H7z"/><path d="M11.646 11.646l3 3 .708-.707-3-3-.708.707z"/></svg>
    Zoom In
  </button>
  <button class="btn" onclick="zoomOut()">
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 1a6.5 6.5 0 100 13A6.5 6.5 0 007.5 1zm0 1a5.5 5.5 0 110 11A5.5 5.5 0 017.5 2zM4.5 7h6v1h-6z"/><path d="M11.646 11.646l3 3 .708-.707-3-3-.708.707z"/></svg>
    Zoom Out
  </button>
  <span class="zoom-lbl" id="zoom-display">100%</span>
  <div class="sep"></div>
  <button class="btn" onclick="fitToView()">
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h4v1H2v3.5H1V1.5A.5.5 0 011.5 1zm9 0h4a.5.5 0 01.5.5V5h-1V2h-3.5V1zM1 10.5h1V14h3.5v1H1.5a.5.5 0 01-.5-.5v-4zm13 0v4a.5.5 0 01-.5.5H10v-1h3.5v-3.5h1z"/></svg>
    Fit
  </button>
  <button class="btn" onclick="resetZoom()">Reset</button>
  <div class="sep"></div>
  <button class="btn" onclick="exportSvg()">Export SVG</button>
  <div class="sep"></div>
  <button class="btn" id="theme-btn" onclick="toggleTheme()">
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1v12a6 6 0 000-12z"/></svg>
    Theme
  </button>
  <div class="sep"></div>
  <button class="btn" id="lock-btn" onclick="toggleLock()" title="Lock diagram (disable auto-updates)">
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 7H5V5a3 3 0 016 0v2zm1 0V5A4 4 0 004 5v2H3v7h10V7h-1z"/></svg>
    Lock
  </button>
  <span class="hint">Scroll=zoom &middot; Drag=pan &middot; Click state or label for details &middot; Ctrl+Click to go to source</span>
</div>

<!-- Floating tooltip (pointer-events:none — never blocks mouse) -->
<div id="tt"></div>

<div id="main-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>

<script>
/* ==========================================================================
   All SVG colours are plain hex strings in the C{} object.
   No CSS var() is used inside SVG attribute values.
   ========================================================================== */

const vscodeApi = acquireVsCodeApi();
const FSM_DATA     = ${fsmData};
const THEME_SETTING= "${themeHint}";

let isLight = THEME_SETTING==='light' ||
  (THEME_SETTING==='auto' && window.matchMedia('(prefers-color-scheme:light)').matches);
if (isLight) document.body.classList.add('light');

function buildC(light) {
  return light ? {
    bg:'#fef7f0', stateFill:'#fce7d8', stateStroke:'#d97706',
    stateSelFill:'#d97706', stateShadow:'rgba(217,119,6,0.25)',
    text:'#3d3229', textMuted:'#8b7355',
    accent:'#d97706', accent2:'#b45309',
    edgeColor:'#9a6b48', edgeDim:'#e8dccf',
    labelBg:'#ffffff', labelBorder:'#e8dccf', labelHlBorder:'#d97706',
    labelText:'#9a6b48', labelTextHl:'#d97706',
    initialColor:'#059669',
  } : {
    bg:'#0f1117', stateFill:'#1e2235', stateStroke:'#4f9cf9',
    stateSelFill:'#4f9cf9', stateShadow:'rgba(79,156,249,0.30)',
    text:'#e2e8f0', textMuted:'#8892a4',
    accent:'#4f9cf9', accent2:'#a78bfa',
    edgeColor:'#94a3b8', edgeDim:'#2e3350',
    labelBg:'#1a1d27', labelBorder:'#2e3350', labelHlBorder:'#4f9cf9',
    labelText:'#8892a4', labelTextHl:'#4f9cf9',
    initialColor:'#34d399',
  };
}

let C = buildC(isLight);

function toggleTheme(){
  isLight=!isLight;
  if(isLight) document.body.classList.add('light');
  else document.body.classList.remove('light');
  C=buildC(isLight);
  const btn=document.getElementById('theme-btn');
  if(btn) btn.title=isLight?'Switch to dark theme':'Switch to light theme';
  render();
  vscodeApi.postMessage({type:'themeChange',isLight});
}

let isLocked=false;
function toggleLock(){
  isLocked=!isLocked;
  const btn=document.getElementById('lock-btn');
  if(btn){
    btn.title=isLocked?'Unlock diagram (enable auto-updates)':'Lock diagram (disable auto-updates)';
    btn.style.color=isLocked?C.accent:'';
  }
  vscodeApi.postMessage({type:'lockChange',locked:isLocked});
}

let currentFsm=0, zoom=1, panX=0, panY=0;
let panning=false, px0=0, py0=0;
let selected=null, didFit=false;
// focusMode (only meaningful while a state is selected):
//   0 = show neighbors in both directions (default focus view)
//   1 = show only outgoing neighbors (states selected points to)
//   2 = show only incoming neighbors (states pointing to selected)
// Cycling past 2 deselects. A neighbor with an edge in the *kept* direction is
// never dimmed, even if it also has an edge in the filtered-out direction.
let focusMode=0;
// Transitions table row hover — directed edge to highlight, or null.
let tableHoverEdge=null;
// A directed edge's pill/arrow was clicked — filters the transitions table
// to just that edge WITHOUT dimming the graph (mutually exclusive with 'selected').
let tableFilterEdge=null;
// Pill hover-tooltip state: shared across all pills (only one hovered at a time).
let pillHoverTimer=null, pillHoverShowing=false, pillHoverX=0, pillHoverY=0;
let transitionsCollapsed=true;
let transitionsHeight=260;
// Geometry + DOM refs for the currently-drawn edges, kept around so table
// hover can re-style edges in place without a full render() (see
// applyEdgeHighlight). Rebuilt every render().
let edgeGeomsRef=[];
// Detect click vs drag on empty space: record mousedown, check distance on mouseup
let emptyClickStart=null;
// Set while panning actually moves the view; suppresses the document-level
// click handler that would otherwise hide the tooltip after a drag-release.
let dragOccurred=false;

// Is this specific edge highlighted under the current focusMode? Unlike
// isKeptNeighbor (which can keep a *state* visible via a different edge),
// an edge is only highlighted if it matches the mode's own direction.
//   0: edge touches selected (either direction)
//   1: outgoing only - edge.from === selected
//   2: incoming only - edge.to === selected
function isEdgeHL(edge){
  if(focusMode===1) return edge.from===selected;
  if(focusMode===2) return edge.to===selected;
  return edge.from===selected||edge.to===selected;
}

function edgeMatches(edge,target){
  return !!target && edge.from===target.from && edge.to===target.to;
}

// Transitions visible in the table for the current selection state:
//   - a clicked edge (pill/arrow) filters to just that directed from/to pair
//   - a selected state filters to whatever isEdgeHL keeps highlighted
//     (taking focusMode's outgoing/incoming/both into account)
//   - otherwise, everything
function getVisibleTransitions(fsm){
  if(tableFilterEdge) return fsm.transitions.filter(tr=>tr.from===tableFilterEdge.from&&tr.to===tableFilterEdge.to);
  if(selected)    return fsm.transitions.filter(tr=>isEdgeHL(tr));
  return fsm.transitions;
}

// Re-style edges/labels in place to reflect 'selected'/'tableHoverEdge'
// without rebuilding the DOM (a full render() would detach the table row
// under the mouse and break mouseenter/mouseleave tracking).
// Note: tableFilterEdge doesn't cause dimming, only table filtering.
function applyEdgeHighlight(){
  edgeGeomsRef.forEach(geo=>{
    const {edge,isSelf,pathEl,lbgEl,ltxtEl}=geo;
    if(!pathEl) return;

    const isHL =(selected&&isEdgeHL(edge))||edgeMatches(edge,tableHoverEdge)||edgeMatches(edge,tableFilterEdge);
    const isDim=(selected||tableHoverEdge)&&!isHL;

    const stroke=isDim?C.edgeDim:isSelf?C.accent2:isHL?C.accent:C.edgeColor;
    const aId  =isDim?'a-d':isSelf?'a-s':isHL?'a-h':'a-n';
    const sw   =isHL?'2.5':'1.8';
    const op   =isDim?'0.2':'1';
    pathEl.setAttribute('stroke',stroke);
    pathEl.setAttribute('stroke-width',sw);
    pathEl.setAttribute('marker-end','url(#'+aId+')');
    pathEl.setAttribute('opacity',op);

    const labelStroke=isDim?C.edgeDim:isSelf?C.accent2:isHL?C.labelHlBorder:C.labelBorder;
    const labelFill  =isDim?C.textMuted:isSelf?C.accent2:isHL?C.labelTextHl:C.labelText;
    lbgEl.setAttribute('stroke',labelStroke);
    lbgEl.setAttribute('opacity',op);
    ltxtEl.setAttribute('fill',labelFill);
    ltxtEl.setAttribute('opacity',op);
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────
function buildTabs(){
  const bar=document.getElementById('tab-bar');
  bar.innerHTML='';
  FSM_DATA.forEach((fsm,i)=>{
    const t=document.createElement('div');
    t.className='tab'+(i===currentFsm?' active':'');
    t.textContent=fsm.signalName+' : '+fsm.typeName;
    t.onclick=()=>{currentFsm=i;selected=null;tableHoverEdge=null;tableFilterEdge=null;didFit=false;buildTabs();render();};
    bar.appendChild(t);
  });
}

// ── Circular layout ───────────────────────────────────────────────────────
function layout(states){
  const n=states.length, pos={};
  if(!n) return pos;
  const cx=450,cy=340;
  const r=n<=2?150:n<=4?200:n<=7?250:n<=10?300:Math.min(360,80+n*32);
  states.forEach((s,i)=>{
    const a=2*Math.PI*i/n - Math.PI/2;
    pos[s.name]={x:cx+r*Math.cos(a), y:cy+r*Math.sin(a)};
  });
  return pos;
}

// ── SVG helpers ───────────────────────────────────────────────────────────
const NS='http://www.w3.org/2000/svg';

function el(tag,attrs){
  const e=document.createElementNS(NS,tag);
  if(attrs) for(const [k,v] of Object.entries(attrs)) e.setAttribute(k,String(v));
  return e;
}

/** Point on circle boundary of (cx,cy,r) towards (tx,ty) */
function edgePt(cx,cy,r,tx,ty){
  const dx=tx-cx, dy=ty-cy, d=Math.sqrt(dx*dx+dy*dy)||1;
  return [cx+dx/d*(r+2), cy+dy/d*(r+2)];
}

/** Point on a quadratic bezier at parameter t (0..1) */
function bezierPoint(x1,y1,cpx,cpy,x2,y2,t){
  const mt=1-t;
  return [mt*mt*x1+2*mt*t*cpx+t*t*x2, mt*mt*y1+2*mt*t*cpy+t*t*y2];
}

/** Sample n+1 evenly-spaced points along a quadratic bezier (for collision tests) */
function sampleBezier(x1,y1,cpx,cpy,x2,y2,n){
  const pts=[];
  for(let i=0;i<=n;i++) pts.push(bezierPoint(x1,y1,cpx,cpy,x2,y2,i/n));
  return pts;
}

// ── Rect collision helpers (for "..." label placement) ────────────────────
function rectsOverlap(a,b){
  return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
}
function rectCircleOverlap(r,cx,cy,rad){
  const nx=Math.max(r.x,Math.min(cx,r.x+r.w));
  const ny=Math.max(r.y,Math.min(cy,r.y+r.h));
  const dx=cx-nx, dy=cy-ny;
  return dx*dx+dy*dy<rad*rad;
}
function segCross(o,a,b){ return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); }
function segIntersect(ax,ay,bx,by,cx,cy,dx,dy){
  const A=[ax,ay],B=[bx,by],Cc=[cx,cy],D=[dx,dy];
  const d1=segCross(Cc,D,A), d2=segCross(Cc,D,B);
  const d3=segCross(A,B,Cc), d4=segCross(A,B,D);
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function rectSegOverlap(r,x1,y1,x2,y2){
  const minx=Math.min(x1,x2), maxx=Math.max(x1,x2);
  const miny=Math.min(y1,y2), maxy=Math.max(y1,y2);
  if(maxx<r.x||minx>r.x+r.w||maxy<r.y||miny>r.y+r.h) return false;
  if(x1>=r.x&&x1<=r.x+r.w&&y1>=r.y&&y1<=r.y+r.h) return true;
  if(x2>=r.x&&x2<=r.x+r.w&&y2>=r.y&&y2<=r.y+r.h) return true;
  const cs=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]];
  for(let i=0;i<4;i++){
    const [ax,ay]=cs[i], [bx,by]=cs[(i+1)%4];
    if(segIntersect(x1,y1,x2,y2,ax,ay,bx,by)) return true;
  }
  return false;
}

// ── Edge grouping ─────────────────────────────────────────────────────────
/**
 * Collapses all transitions with the same from→to direction into one edge.
 * Direction is preserved: A→B and B→A remain separate arrows.
 *
 * Returns an array of grouped edges:
 *   { from, to, conditions: string[], isSelf: bool }
 */
function groupEdges(transitions){
  const map=new Map();
  transitions.forEach(tr=>{
    const key=tr.from+'|||'+tr.to;
    if(!map.has(key)) map.set(key,{from:tr.from,to:tr.to,conditions:[],isSelf:tr.from===tr.to});
    const g=map.get(key);
    if(!g.conditions.includes(tr.condition)) g.conditions.push(tr.condition);
  });
  return Array.from(map.values());
}

// ── Main render ───────────────────────────────────────────────────────────
function render(){
  const main   =document.getElementById('main-content');
  const toolbar=document.getElementById('toolbar');
  hideTooltip();
  clearTimeout(pillHoverTimer); pillHoverTimer=null; pillHoverShowing=false;

  const prevTpBody=document.getElementById('tp-body');
  const prevTpScroll=prevTpBody?prevTpBody.scrollTop:0;

  if(!FSM_DATA.length){
    toolbar.style.display='none';
    main.innerHTML=
      '<div class="empty">'+
      '<div class="empty-icon">&#11041;</div>'+
      '<h3>No FSM detected</h3>'+
      '<p>Open a VHDL file containing a <code>type t_xxx is (s1, s2, ...);</code> '+
      'enum and a <code>case</code> statement on a signal of that type.</p>'+
      '</div>';
    return;
  }

  toolbar.style.display='flex';
  const fsm=FSM_DATA[currentFsm];
  function stateLines(name){
    if(name.length>20){const p=name.split('_'),t=Math.ceil(p.length/3);return[p.slice(0,t).join('_'),p.slice(t,t*2).join('_'),p.slice(t*2).join('_')].filter(s=>s);}
    if(name.length>14){const p=name.split('_'),h=Math.ceil(p.length/2);return[p.slice(0,h).join('_'),p.slice(h).join('_')].filter(s=>s);}
    return[name];
  }
  const maxLineLen=fsm.states.length?Math.max(...fsm.states.map(s=>Math.max(...stateLines(s.name).map(l=>l.length)))):8;
  const R=maxLineLen<=8?48:maxLineLen<=12?56:maxLineLen<=16?64:Math.min(80,32+maxLineLen*2.5);
  main.innerHTML='';

  const wrap=document.createElement('div');
  wrap.className='canvas-wrap'; wrap.id='canvas-wrap';

  const svg=document.createElementNS(NS,'svg');
  svg.id='diagram-svg'; svg.setAttribute('xmlns',NS);

  // Solid background — required in VS Code webviews (no CSS inheritance into SVG)
  svg.appendChild(el('rect',{x:'-9999',y:'-9999',width:'19998',height:'19998',fill:C.bg}));

  // ── Defs ──────────────────────────────────────────────────────────────
  const defs=el('defs');
  function arrow(id,color){
    const m=el('marker',{id,markerWidth:'10',markerHeight:'7',refX:'9',refY:'3.5',orient:'auto'});
    m.appendChild(el('path',{d:'M 0 0 L 10 3.5 L 0 7 z',fill:color}));
    return m;
  }
  defs.appendChild(arrow('a-n',C.edgeColor));
  defs.appendChild(arrow('a-h',C.accent));
  defs.appendChild(arrow('a-s',C.accent2));
  defs.appendChild(arrow('a-d',C.edgeDim));

  const filt=el('filter',{id:'glow',x:'-50%',y:'-50%',width:'200%',height:'200%'});
  filt.appendChild(el('feGaussianBlur',{in:'SourceGraphic',stdDeviation:'7',result:'b'}));
  filt.appendChild(el('feComposite',  {in:'b',in2:'SourceGraphic',operator:'over'}));
  defs.appendChild(filt);
  svg.appendChild(defs);

  const g=el('g',{id:'dg'});
  svg.appendChild(g);

  const pos=layout(fsm.states);

  // ── Pre-process edges ────────────────────────────────────────────────
  // Group A→B transitions into one arrow per direction.
  const grouped=groupEdges(fsm.transitions);

  // Build a set of directed keys so we can detect bidirectional pairs.
  const directedSet=new Set(grouped.map(e=>e.from+'|||'+e.to));

  // Is "name" a kept neighbor (state circle stays undimmed) of "selected"
  // under the current focusMode?
  //   0: any edge between selected and name (either direction)
  //   1: outgoing only - selected -> name
  //   2: incoming only - name -> selected
  function isKeptNeighbor(name){
    if(focusMode===1) return directedSet.has(selected+'|||'+name);
    if(focusMode===2) return directedSet.has(name+'|||'+selected);
    return directedSet.has(selected+'|||'+name)||directedSet.has(name+'|||'+selected);
  }

  // ── Draw edges ───────────────────────────────────────────────────────
  const eGrp=el('g');

  // Pass 1: compute curve geometry for every edge — both the rendered path
  // and a quadratic-bezier "label track" (for self-loops this is a virtual
  // curve whose midpoint matches the original fixed label spot above the arc).
  const edgeGeoms=grouped.map(edge=>{
    const fp=pos[edge.from], tp=pos[edge.to];
    if(!fp) return null;
    const isSelf=edge.isSelf;
    let x1,y1,cpx,cpy,x2,y2,pathD;

    if(isSelf){
      // Arc looping above the state node
      x1=fp.x-22; y1=fp.y-R; x2=fp.x+22; y2=fp.y-R;
      cpx=fp.x; cpy=fp.y-R-64;
      pathD='M '+x1+' '+y1+' A 40 30 0 1 1 '+x2+' '+y2;
    } else {
      // Check if the reverse direction also has an arrow
      const hasReverse=directedSet.has(edge.to+'|||'+edge.from);
      // Both directions use the same positive curveFactor; because the
      // perpendicular flips sign when direction is reversed, they bow opposite ways.
      const cf=hasReverse?0.26:0.09;
      [x1,y1]=edgePt(fp.x,fp.y,R,tp.x,tp.y);
      [x2,y2]=edgePt(tp.x,tp.y,R,fp.x,fp.y);
      const dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
      const nx=-dy/len, ny=dx/len;          // left-perpendicular unit vector
      const offset=cf*len;                  // control-point displacement
      cpx=(x1+x2)/2+nx*offset; cpy=(y1+y2)/2+ny*offset;
      pathD='M '+x1+' '+y1+' Q '+cpx+' '+cpy+' '+x2+' '+y2;
    }

    return {edge,isSelf,pathD,x1,y1,cpx,cpy,x2,y2,
      poly:sampleBezier(x1,y1,cpx,cpy,x2,y2,16)};
  }).filter(Boolean);

  // Pass 2: place each "..." label. It defaults to its curve's midpoint, but
  // if that spot collides with another label, another edge's curve, or a
  // state circle, slide it along its own curve (away from the midpoint)
  // until a free spot is found. If none is free, fall back to the midpoint.
  const LW=34, LH=17, LPAD=2;
  const T_OFFSETS=[0,0.12,-0.12,0.24,-0.24,0.34,-0.34];
  const stateCircles=fsm.states.map(s=>({cx:pos[s.name].x,cy:pos[s.name].y,r:R}));
  const placedLabelRects=[];

  edgeGeoms.forEach(geo=>{
    let best=null;
    for(const off of T_OFFSETS){
      const t=0.5+off;
      if(t<0.12||t>0.88) continue;
      const [px,py]=bezierPoint(geo.x1,geo.y1,geo.cpx,geo.cpy,geo.x2,geo.y2,t);
      const rect={x:px-LW/2-LPAD,y:py-LH/2-LPAD,w:LW+2*LPAD,h:LH+2*LPAD};
      let collide=stateCircles.some(c=>rectCircleOverlap(rect,c.cx,c.cy,c.r));
      if(!collide) collide=placedLabelRects.some(pl=>rectsOverlap(rect,pl));
      if(!collide) collide=edgeGeoms.some(other=>{
        if(other===geo) return false;
        const p=other.poly;
        for(let i=0;i<p.length-1;i++){
          if(rectSegOverlap(rect,p[i][0],p[i][1],p[i+1][0],p[i+1][1])) return true;
        }
        return false;
      });
      if(!collide){ best={px,py,rect}; break; }
    }
    if(!best){
      // No collision-free spot found along the curve — keep the midpoint.
      const [px,py]=bezierPoint(geo.x1,geo.y1,geo.cpx,geo.cpy,geo.x2,geo.y2,0.5);
      best={px,py,rect:{x:px-LW/2-LPAD,y:py-LH/2-LPAD,w:LW+2*LPAD,h:LH+2*LPAD}};
    }
    geo.lx=best.px; geo.ly=best.py;
    placedLabelRects.push(best.rect);
  });

  // Pass 3: draw each edge's path and its "..." label at the placed position.
  edgeGeoms.forEach(geo=>{
    const {edge,isSelf,pathD,lx,ly}=geo;

    const isHL =(selected&&isEdgeHL(edge))||edgeMatches(edge,tableHoverEdge)||edgeMatches(edge,tableFilterEdge);
    const isDim=(selected||tableHoverEdge)&&!isHL;

    const stroke=isDim?C.edgeDim:isSelf?C.accent2:isHL?C.accent:C.edgeColor;
    const aId  =isDim?'a-d':isSelf?'a-s':isHL?'a-h':'a-n';
    const sw   =isHL?2.5:1.8;
    const op   =isDim?'0.2':'1';

    const pathEl=el('path',{
      d:pathD,fill:'none',stroke,'stroke-width':sw,
      'marker-end':'url(#'+aId+')','stroke-linecap':'round',
      opacity:op,
    });
    // Click on arrow/pill → toggle filter. The "..." pill also shows the
    // conditions popup; clicking the arrow itself only filters the table.
    const isFilteredEdge=tableFilterEdge&&edge.from===tableFilterEdge.from&&edge.to===tableFilterEdge.to;
    const toggleEdgeFilter=(showPopup)=>(ev)=>{
      ev.stopPropagation();
      // Preserve the state selection when clicking a highlighted edge (one connected to the selected state).
      // Only clear the selection if the clicked edge is unrelated to the current highlight.
      if(!(selected && isEdgeHL(edge))){ selected=null; focusMode=0; }
      if(isFilteredEdge){
        // Already filtered to this edge → clear the filter and close the popup
        tableFilterEdge=null;
        render();
      } else {
        // Filter to this edge, optionally showing the popup
        tableFilterEdge={from:edge.from,to:edge.to};
        render();
        if(showPopup) showEdgeTooltip(ev.clientX, ev.clientY, edge);
      }
    };

    eGrp.appendChild(pathEl);
    pathEl.setAttribute('cursor','pointer');
    pathEl.addEventListener('click',toggleEdgeFilter(false));
    geo.pathEl=pathEl;

    // Invisible wider hit-area on top of the (thin) visible path, so the
    // arrow is much easier to click without changing its drawn weight.
    const hitEl=el('path',{
      d:pathD,fill:'none',stroke:'transparent','stroke-width':12,cursor:'pointer',
    });
    eGrp.appendChild(hitEl);
    hitEl.addEventListener('click',toggleEdgeFilter(false));

    // ── Label: always shows "..." ──────────────────────────────────────
    // Clicking it reveals the condition(s) in a tooltip and filters the table.
    const labelStroke=isDim?C.edgeDim:isSelf?C.accent2:isHL?C.labelHlBorder:C.labelBorder;
    const labelFill  =isDim?C.textMuted:isSelf?C.accent2:isHL?C.labelTextHl:C.labelText;

    // Fixed-width pill for "..."
    const lbg=el('rect',{
      x:lx-LW/2,y:ly-9,width:LW,height:17,rx:4,ry:4,
      fill:C.labelBg,stroke:labelStroke,'stroke-width':'1',
      opacity:op,cursor:'pointer',
    });
    const ltxt=el('text',{
      x:lx,y:ly+3,
      'text-anchor':'middle','dominant-baseline':'middle',
      fill:labelFill,'font-size':'10',
      'font-family':"Consolas,'Cascadia Code','Fira Code',monospace",
      opacity:op,cursor:'pointer',
    });
    ltxt.textContent='...';

    lbg.addEventListener('click',toggleEdgeFilter(true));
    ltxt.addEventListener('click',toggleEdgeFilter(true));
    // Store title text for SVG export (injected as <title> in the clone, not live DOM)
    lbg.setAttribute('data-pill-title',edge.from+' → '+edge.to+': '+edge.conditions.join(', '));

    // ── Pill hover: show tooltip after 0.5s of stillness ──────────────
    const pillGrp=el('g');
    pillGrp.appendChild(lbg);
    pillGrp.appendChild(ltxt);
    pillGrp.addEventListener('mouseenter',e=>{
      pillHoverX=e.clientX; pillHoverY=e.clientY;
      pillHoverTimer=setTimeout(()=>{
        pillHoverShowing=true;
        showEdgeTooltip(pillHoverX,pillHoverY,edge);
      },500);
    });
    pillGrp.addEventListener('mousemove',e=>{
      pillHoverX=e.clientX; pillHoverY=e.clientY;
      if(pillHoverShowing){ hideTooltip(); pillHoverShowing=false; }
      clearTimeout(pillHoverTimer);
      pillHoverTimer=setTimeout(()=>{
        pillHoverShowing=true;
        showEdgeTooltip(pillHoverX,pillHoverY,edge);
      },500);
    });
    pillGrp.addEventListener('mouseleave',()=>{
      clearTimeout(pillHoverTimer); pillHoverTimer=null;
      if(pillHoverShowing){ hideTooltip(); pillHoverShowing=false; }
    });
    eGrp.appendChild(pillGrp);
    geo.lbgEl=lbg;
    geo.ltxtEl=ltxt;
  });

  edgeGeomsRef=edgeGeoms;
  g.appendChild(eGrp);

  // ── Draw states ───────────────────────────────────────────────────────
  const sGrp=el('g');

  fsm.states.forEach((state,i)=>{
    const p=pos[state.name];
    if(!p) return;

    const isSel =selected===state.name;
    const isConn=selected&&!isSel&&isKeptNeighbor(state.name);
    const isDim =selected&&!isSel&&!isConn;

    const sg=el('g',{cursor:'pointer',opacity:isDim?'0.22':'1'});
    sg.dataset.state=state.name;
    sg.appendChild(el('title')).textContent='Ctrl+Click to go to source';

    if(isSel){
      sg.appendChild(el('circle',{cx:p.x,cy:p.y,r:R+14,fill:C.stateShadow,filter:'url(#glow)'}));
    }

    // Initial state: dashed outer ring + entry arrow
    if(i===0){
      sg.appendChild(el('circle',{cx:p.x,cy:p.y,r:R+9,fill:'none',
        stroke:C.initialColor,'stroke-width':'1.5','stroke-dasharray':'4 3'}));
      const ay=p.y-R-9;
      sg.appendChild(el('line',{x1:p.x,y1:ay-32,x2:p.x,y2:ay,
        stroke:C.initialColor,'stroke-width':'1.8'}));
      sg.appendChild(el('circle',{cx:p.x,cy:ay-36,r:5,fill:C.initialColor}));
    }

    sg.appendChild(el('circle',{
      cx:p.x,cy:p.y,r:R,
      fill:isSel?C.stateSelFill:C.stateFill,
      stroke:isSel?C.stateSelFill:C.stateStroke,
      'stroke-width':isSel?'3':'1.8',
    }));

    // State name — original case preserved from parser
    const name=state.name;
    const lines=stateLines(name);
    const mll=Math.max(...lines.map(l=>l.length));
    const fs=mll>16?'11':mll>12?'12':mll>8?'14':mll>6?'15':'16';
    const lbl=el('text',{
      x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle',
      fill:isSel?'#ffffff':C.text,
      'font-family':"Consolas,'Cascadia Code','Fira Code',monospace",
      'font-size':fs,'font-weight':'500',
    });
    if(lines.length===3){
      const t1=el('tspan',{x:p.x,dy:'-1.2em'}); t1.textContent=lines[0];
      const t2=el('tspan',{x:p.x,dy:'1.2em'});  t2.textContent=lines[1];
      const t3=el('tspan',{x:p.x,dy:'1.2em'});  t3.textContent=lines[2];
      lbl.appendChild(t1); lbl.appendChild(t2); lbl.appendChild(t3);
    } else if(lines.length===2){
      const t1=el('tspan',{x:p.x,dy:'-0.6em'}); t1.textContent=lines[0];
      const t2=el('tspan',{x:p.x,dy:'1.2em'});  t2.textContent=lines[1];
      lbl.appendChild(t1); lbl.appendChild(t2);
    } else { lbl.textContent=name; }
    sg.appendChild(lbl);

    if(i===0){
      const badge=el('text',{x:p.x,y:p.y+R+15,'text-anchor':'middle',
        fill:C.initialColor,'font-size':'9',
        'font-family':"'Segoe UI',system-ui,sans-serif",opacity:'0.85'});
      badge.textContent='initial'; sg.appendChild(badge);
    }

    sg.addEventListener('click',e=>{
      e.stopPropagation(); hideTooltip();
      if(e.ctrlKey||e.metaKey){ goToLine(state.line); return; }
      tableFilterEdge=null;
      if(selected===state.name){
        focusMode++;
        if(focusMode>2){ selected=null; focusMode=0; }
      } else {
        if(selected===null) focusMode=0;
        selected=state.name;
      }
      render();
    });
    sGrp.appendChild(sg);
  });

  g.appendChild(sGrp);
  wrap.appendChild(svg);

  const info=document.createElement('div');
  info.className='info-panel'; info.id='info-panel';
  info.innerHTML=infoHtml(fsm);
  wrap.appendChild(info);

  main.appendChild(wrap);
  main.appendChild(buildTransitionsPanel(fsm));
  applyT(); attachEvents(wrap);
  if(!didFit){didFit=true;requestAnimationFrame(fitToView);}

  const tpBody=document.getElementById('tp-body');
  if(tpBody) tpBody.scrollTop=prevTpScroll;
}

// ── Transitions table ────────────────────────────────────────────────────
function buildTransitionsPanel(fsm){
  const panel=document.createElement('div');
  panel.className='transitions-panel';

  const visible=getVisibleTransitions(fsm);
  const total=fsm.transitions.length;

  const header=document.createElement('div');
  header.className='tp-header';
  const chev=document.createElement('span');
  chev.className='tp-chevron'+(transitionsCollapsed?' collapsed':'');
  chev.textContent='▾';
  const title=document.createElement('span');
  title.textContent=visible.length===total
    ?'Transitions ('+total+')'
    :'Transitions ('+visible.length+' of '+total+')';
  header.appendChild(chev);
  header.appendChild(title);
  header.addEventListener('click',()=>{
    transitionsCollapsed=!transitionsCollapsed;
    render();
  });

  if(!transitionsCollapsed){
    panel.style.height=transitionsHeight+'px';

    // Drag the top edge to resize the panel vertically.
    const resize=document.createElement('div');
    resize.className='tp-resize';
    resize.addEventListener('mousedown',e=>{
      e.preventDefault();
      const startY=e.clientY, startHeight=transitionsHeight;
      const onMove=(ev)=>{
        const h=Math.max(80,Math.min(window.innerHeight-150,startHeight+(startY-ev.clientY)));
        transitionsHeight=h;
        panel.style.height=h+'px';
      };
      const onUp=()=>{
        window.removeEventListener('mousemove',onMove);
        window.removeEventListener('mouseup',onUp);
      };
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp);
    });
    panel.appendChild(resize);
  }

  panel.appendChild(header);

  if(!transitionsCollapsed){
    const body=document.createElement('div');
    body.className='tp-body'; body.id='tp-body';
    body.addEventListener('wheel',e=>{
      body.scrollTop+=e.deltaY;
      e.preventDefault(); e.stopPropagation();
    },{passive:false});

    const table=document.createElement('table');
    table.className='tp-table';
    const thead=document.createElement('thead');
    thead.innerHTML='<tr><th>From</th><th>To</th><th>Condition</th><th>Line</th></tr>';
    table.appendChild(thead);

    const tbody=document.createElement('tbody');
    visible.forEach(tr=>{
      const row=document.createElement('tr');
      row.className='tp-row';

      const tdFrom=document.createElement('td'); tdFrom.textContent=tr.from;
      const tdTo  =document.createElement('td'); tdTo.textContent=tr.to;
      const tdCond=document.createElement('td'); tdCond.className='tp-cond'; tdCond.textContent=tr.condition;
      const tdLine=document.createElement('td'); tdLine.className='tp-line';
      const lineLink=document.createElement('span');
      lineLink.className='tp-line-link';
      lineLink.title='Ctrl+Click to go to source';
      lineLink.textContent=String(tr.line);
      lineLink.onclick=(ev)=>{
        ev.stopPropagation();
        goToLineOnModClick(ev,tr.line);
      };
      tdLine.appendChild(lineLink);
      row.appendChild(tdFrom); row.appendChild(tdTo); row.appendChild(tdCond); row.appendChild(tdLine);

      // Hover highlights the matching edge in place (no re-render, so
      // mouseleave still fires on this same element afterwards).
      row.addEventListener('mouseenter',()=>{ tableHoverEdge={from:tr.from,to:tr.to}; applyEdgeHighlight(); });
      row.addEventListener('mouseleave',()=>{ tableHoverEdge=null; applyEdgeHighlight(); });

      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    panel.appendChild(body);
  }

  return panel;
}

// ── Tooltip ───────────────────────────────────────────────────────────────
function showEdgeTooltip(mx, my, edge){
  const tt=document.getElementById('tt');
  tt.innerHTML='';

  // Header: "from → to"
  const hdr=document.createElement('div');
  hdr.className='tt-header';
  hdr.textContent=edge.from+' → '+edge.to;
  tt.appendChild(hdr);

  // One row per condition
  edge.conditions.forEach(c=>{
    const row=document.createElement('div');
    row.className=edge.conditions.length>1?'tt-row':'tt-single';
    row.textContent=c;
    tt.appendChild(row);
  });

  positionTooltip(tt, mx, my);
}

function positionTooltip(tt, mx, my){
  tt.style.display='block';
  // Measure then reposition to stay in viewport
  const vw=window.innerWidth, vh=window.innerHeight;
  const tw=tt.offsetWidth||220, th=tt.offsetHeight||60;
  let tx=mx+14, ty=my-10;
  if(tx+tw>vw-8) tx=mx-tw-14;
  if(ty+th>vh-8) ty=vh-th-8;
  if(ty<8) ty=8;
  tt.style.left=tx+'px'; tt.style.top=ty+'px';
}

function hideTooltip(){
  document.getElementById('tt').style.display='none';
}

document.addEventListener('click', ()=>{
  if(dragOccurred){ dragOccurred=false; return; }
  hideTooltip();
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideTooltip(); });

function goToLine(line){
  vscodeApi.postMessage({command:'goToLine',line});
}

// Navigate to a line only when Ctrl/Cmd is held; used by all "go to source" links.
function goToLineOnModClick(ev,line){
  if(!(ev.ctrlKey||ev.metaKey)) return;
  ev.stopPropagation();
  goToLine(line);
}

function infoHtml(fsm){
  const f=fsm||FSM_DATA[currentFsm];
  // Count unique directed edges (grouped)
  const grouped=groupEdges(f.transitions);
  const cnt=selected
    ?grouped.filter(e=>e.from===selected||e.to===selected).length
    :grouped.length;
  const modeLabel=focusMode===1?', outgoing only':focusMode===2?', incoming only':'';
  return '<h4>'+(selected?'&#9711; '+selected+modeLabel:'FSM Info')+'</h4>'+
    '<div class="info-row"><span>Signal</span><span class="v info-link" title="Ctrl+Click to go to source" onclick="goToLineOnModClick(event,'+f.caseLine+')">'+f.signalName+'</span></div>'+
    '<div class="info-row"><span>Type</span><span class="v info-link" title="Ctrl+Click to go to source" onclick="goToLineOnModClick(event,'+f.typeLine+')">'+f.typeName+'</span></div>'+
    '<div class="info-row"><span>States</span><span class="v">'+f.states.length+'</span></div>'+
    '<div class="info-row"><span>Arrows</span><span class="v">'+cnt+'</span></div>'+
    (selected?'<div class="info-note">Click again to cycle focus, click elsewhere to deselect</div>':'');
}

// ── Pan & Zoom ────────────────────────────────────────────────────────────
function attachEvents(wrap){
  wrap.addEventListener('mousedown',e=>{
    if(e.target.closest('[data-state]')||e.target.closest('#info-panel')) return;
    panning=true; px0=e.clientX-panX; py0=e.clientY-panY;
    dragOccurred=false;
    wrap.classList.add('grabbing');
  });
  window.addEventListener('mousemove',e=>{
    if(!panning) return;
    dragOccurred=true;
    panX=e.clientX-px0; panY=e.clientY-py0; applyT();
  });
  window.addEventListener('mouseup',()=>{
    panning=false;
    document.getElementById('canvas-wrap')?.classList.remove('grabbing');
  });
  wrap.addEventListener('wheel',e=>{
    e.preventDefault();
    const rc=wrap.getBoundingClientRect();
    const mx=e.clientX-rc.left, my=e.clientY-rc.top;
    const f=e.deltaY>0?0.9:1.1;
    const nz=Math.max(0.12,Math.min(6,zoom*f));
    panX=mx-(mx-panX)*(nz/zoom); panY=my-(my-panY)*(nz/zoom);
    zoom=nz; applyT();
  },{passive:false});
  // Click on empty space clears selections, but dragging (panning) should not.
  // Track mousedown position and only clear on mouseup if distance < 5px (click, not drag).
  wrap.addEventListener('mousedown',e=>{
    if(!e.target.closest('[data-state]')&&!e.target.closest('[cursor="pointer"]')&&!e.target.closest('#info-panel')){
      emptyClickStart={x:e.clientX,y:e.clientY};
    }
  });
  wrap.addEventListener('mousemove',e=>{
    if(emptyClickStart){
      const dx=e.clientX-emptyClickStart.x, dy=e.clientY-emptyClickStart.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist>5) emptyClickStart=null;
    }
  });
  wrap.addEventListener('mouseup',e=>{
    if(emptyClickStart){
      selected=null; tableFilterEdge=null; render();
    }
    emptyClickStart=null;
  });
}

function applyT(){
  const g=document.getElementById('dg');
  if(g) g.setAttribute('transform','translate('+panX+','+panY+') scale('+zoom+')');
  const d=document.getElementById('zoom-display');
  if(d) d.textContent=Math.round(zoom*100)+'%';
}
function zoomIn()    {zoom=Math.min(6,zoom*1.2);   applyT();}
function zoomOut()   {zoom=Math.max(0.12,zoom/1.2); applyT();}
function resetZoom() {zoom=1;panX=0;panY=0;applyT();}

function fitToView(){
  const svg=document.getElementById('diagram-svg');
  const g  =document.getElementById('dg');
  if(!svg||!g) return;
  g.setAttribute('transform','translate(0,0) scale(1)');
  const b=g.getBBox();
  if(!b.width||!b.height) return;
  const w=svg.clientWidth||900, h=svg.clientHeight||600, pad=70;
  zoom=Math.min((w-pad*2)/b.width,(h-pad*2)/b.height,2.5);
  panX=(w-b.width*zoom)/2-b.x*zoom;
  panY=(h-b.height*zoom)/2-b.y*zoom;
  applyT();
}

function exportSvg(){
  const svg=document.getElementById('diagram-svg');
  if(!svg) return;

  // Clone the SVG
  const clone=svg.cloneNode(true);

  // Reset transform on the content group to get accurate measurements
  const gClone=clone.querySelector('#dg');
  if(gClone) {
    gClone.setAttribute('transform','translate(0,0) scale(1)');
  }

  // Remove the large background rect
  const bgRect=clone.querySelector('rect[x="-9999"]');
  if(bgRect) {
    bgRect.remove();
  }

  // Inject <title> elements into pill rects for native SVG tooltips in exported file
  clone.querySelectorAll('[data-pill-title]').forEach(rect=>{
    const t=document.createElementNS('http://www.w3.org/2000/svg','title');
    t.textContent=rect.getAttribute('data-pill-title');
    rect.removeAttribute('data-pill-title');
    rect.insertBefore(t,rect.firstChild);
  });

  // Temporarily add to DOM to calculate bounding box
  clone.style.position='absolute';
  clone.style.left='-9999px';
  clone.style.visibility='hidden';
  document.body.appendChild(clone);

  let bbox={x:0, y:0, width:900, height:650};
  if(gClone) {
    try{
      bbox=gClone.getBBox();
    }catch(e){
      // Fallback if getBBox fails
    }
  }

  // Remove clone from DOM
  document.body.removeChild(clone);

  // Calculate dimensions with padding
  const padding=40;
  const viewBoxX=bbox.x-padding;
  const viewBoxY=bbox.y-padding;
  const viewBoxW=Math.max(1, bbox.width+padding*2);
  const viewBoxH=Math.max(1, bbox.height+padding*2);

  // Set viewBox for proper scaling
  clone.setAttribute('viewBox', viewBoxX+' '+viewBoxY+' '+viewBoxW+' '+viewBoxH);

  // Calculate export dimensions (fit to max size while maintaining aspect ratio)
  const maxSize=1000;
  const aspectRatio=viewBoxW/viewBoxH;
  let exportWidth=maxSize;
  let exportHeight=maxSize;
  if(aspectRatio>1){
    exportHeight=Math.round(maxSize/aspectRatio);
  }else{
    exportWidth=Math.round(maxSize*aspectRatio);
  }

  clone.setAttribute('width',String(exportWidth));
  clone.setAttribute('height',String(exportHeight));

  // Clean up style attributes
  clone.removeAttribute('style');

  // Create and download
  const blob=new Blob([clone.outerHTML],{type:'image/svg+xml'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='fsm_diagram.svg';
  link.click();
  URL.revokeObjectURL(url);
}

buildTabs();
render();
(()=>{ const b=document.getElementById('theme-btn'); if(b) b.title=isLight?'Switch to dark theme':'Switch to light theme'; })();
</script>
</body>
</html>`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
