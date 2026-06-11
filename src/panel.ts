import * as vscode from 'vscode';
import { ParsedFsm } from './parser';

export class FsmPanel {
  public static currentPanel: FsmPanel | undefined;
  private static readonly viewType = 'vhdlFsmDiagram';
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, fsms: ParsedFsm[], title: string): void {
    const col = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    if (FsmPanel.currentPanel) {
      FsmPanel.currentPanel._panel.reveal(col);
      FsmPanel.currentPanel._update(fsms, title);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      FsmPanel.viewType, 'FSM Diagram', col,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    FsmPanel.currentPanel = new FsmPanel(panel, extensionUri);
    FsmPanel.currentPanel._update(fsms, title);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public update(fsms: ParsedFsm[], title: string): void {
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
    const config        = vscode.workspace.getConfiguration('vhdl-fsm-visualizer');
    const themeSetting  = config.get<string>('theme', 'auto');
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
body.light{background:#f0f4ff;color:#1e2030;}

.header{display:flex;align-items:center;gap:12px;padding:10px 16px;
  background:#1a1d27;border-bottom:1px solid #2e3350;flex-shrink:0;}
body.light .header{background:#fff;border-color:#c5d0e8;}
.header-icon{width:28px;height:28px;border-radius:6px;
  background:linear-gradient(135deg,#4f9cf9,#a78bfa);
  display:flex;align-items:center;justify-content:center;font-size:15px;}
.header-title{font-size:13px;font-weight:600;flex:1;}
.header-file{font-size:11px;color:#8892a4;font-family:monospace;}
body.light .header-file{color:#5a6483;}

.tab-bar{display:flex;background:#1a1d27;border-bottom:1px solid #2e3350;
  padding:0 16px;flex-shrink:0;}
body.light .tab-bar{background:#fff;border-color:#c5d0e8;}
.tab{padding:7px 16px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;
  color:#8892a4;transition:color .15s;user-select:none;}
.tab:hover{color:#e2e8f0;}
body.light .tab:hover{color:#1e2030;}
.tab.active{color:#4f9cf9;border-bottom-color:#4f9cf9;}
body.light .tab.active{color:#2563eb;border-bottom-color:#2563eb;}

.toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;
  background:#1a1d27;border-bottom:1px solid #2e3350;flex-shrink:0;}
body.light .toolbar{background:#fff;border-color:#c5d0e8;}
.btn{padding:4px 10px;border-radius:5px;border:1px solid #2e3350;
  background:#22263a;color:#e2e8f0;font-size:11px;cursor:pointer;
  transition:all .15s;display:flex;align-items:center;gap:5px;}
body.light .btn{border-color:#c5d0e8;background:#e8edf8;color:#1e2030;}
.btn:hover{border-color:#4f9cf9;color:#4f9cf9;}
body.light .btn:hover{border-color:#2563eb;color:#2563eb;}
.btn svg{width:13px;height:13px;}
.sep{width:1px;height:20px;background:#2e3350;margin:0 2px;}
body.light .sep{background:#c5d0e8;}
.zoom-lbl{font-size:11px;color:#8892a4;font-family:monospace;min-width:42px;text-align:center;}
.hint{margin-left:auto;font-size:11px;color:#8892a4;}
body.light .hint{color:#5a6483;}

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
body.light #tt{background:#fff;border-color:#2563eb;color:#1e2030;box-shadow:0 4px 18px rgba(0,0,0,.2);}
#tt .tt-header{font-weight:700;color:#4f9cf9;margin-bottom:5px;font-size:12px;}
body.light #tt .tt-header{color:#2563eb;}
#tt .tt-row{padding:1px 0;}
#tt .tt-row:before{content:'→  ';color:#94a3b8;}
body.light #tt .tt-row:before{color:#64748b;}
#tt .tt-single{padding:1px 0;}

.info-panel{position:absolute;bottom:14px;right:14px;
  background:#1a1d27;border:1px solid #2e3350;border-radius:10px;
  padding:12px 14px;min-width:180px;font-size:11px;z-index:5;}
body.light .info-panel{background:#fff;border-color:#c5d0e8;}
.info-panel h4{font-size:11px;font-weight:600;color:#8892a4;
  text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
body.light .info-panel h4{color:#5a6483;}
.info-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0;}
.info-row .v{color:#4f9cf9;font-family:monospace;font-weight:600;}
body.light .info-row .v{color:#2563eb;}
.info-note{margin-top:6px;color:#8892a4;font-size:10px;}

.empty{flex:1;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;color:#8892a4;}
.empty-icon{font-size:48px;opacity:.4;}
.empty h3{font-size:16px;color:#e2e8f0;}
body.light .empty h3{color:#1e2030;}
.empty p{font-size:13px;max-width:360px;text-align:center;line-height:1.5;}
.empty code{font-family:monospace;background:#22263a;padding:1px 5px;border-radius:3px;color:#4f9cf9;}
body.light .empty code{background:#e8edf8;color:#2563eb;}
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
  <span class="hint">Scroll=zoom &middot; Drag=pan &middot; Click state or label for details</span>
</div>

<!-- Floating tooltip (pointer-events:none — never blocks mouse) -->
<div id="tt"></div>

<div id="main-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>

<script>
/* ==========================================================================
   All SVG colours are plain hex strings in the C{} object.
   No CSS var() is used inside SVG attribute values.
   ========================================================================== */

const FSM_DATA     = ${fsmData};
const THEME_SETTING= "${themeSetting}";

const IS_LIGHT = THEME_SETTING==='light' ||
  (THEME_SETTING==='auto' && window.matchMedia('(prefers-color-scheme:light)').matches);
if (IS_LIGHT) document.body.classList.add('light');

const C = IS_LIGHT ? {
  bg:'#f0f4ff', stateFill:'#dde8ff', stateStroke:'#2563eb',
  stateSelFill:'#2563eb', stateShadow:'rgba(37,99,235,0.30)',
  text:'#1e2030', textMuted:'#5a6483',
  accent:'#2563eb', accent2:'#7c3aed',
  edgeColor:'#64748b', edgeDim:'#c5d0e8',
  labelBg:'#ffffff', labelBorder:'#c5d0e8', labelHlBorder:'#2563eb',
  labelText:'#64748b', labelTextHl:'#2563eb',
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

// ── Tabs ──────────────────────────────────────────────────────────────────
function buildTabs(){
  const bar=document.getElementById('tab-bar');
  bar.innerHTML='';
  FSM_DATA.forEach((fsm,i)=>{
    const t=document.createElement('div');
    t.className='tab'+(i===currentFsm?' active':'');
    t.textContent=fsm.signalName+' : '+fsm.typeName;
    t.onclick=()=>{currentFsm=i;selected=null;didFit=false;buildTabs();render();};
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
const R=48;  // state circle radius

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

/** Mid-point of quadratic bezier */
function qMid(x1,y1,cpx,cpy,x2,y2){
  return [(x1+2*cpx+x2)/4, (y1+2*cpy+y2)/4];
}

/**
 * Compute a quadratic bezier edge between two state circles.
 *
 * curveFactor > 0 → control point displaced to the left of the direction vector.
 * Because the perpendicular of A→B is opposite to that of B→A, using the same
 * positive factor for both directions causes them to bow on opposite sides.
 *
 *   curveFactor=0.25  → visible bow (~25% of edge length)
 *   curveFactor=0.08  → slight bow for unidirectional single edges
 */
function edgePath(fx,fy,tx,ty,curveFactor){
  const [x1,y1]=edgePt(fx,fy,R,tx,ty);
  const [x2,y2]=edgePt(tx,ty,R,fx,fy);
  const dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
  const nx=-dy/len, ny=dx/len;          // left-perpendicular unit vector

  const offset=curveFactor*len;          // control-point displacement
  const cpx=(x1+x2)/2 + nx*offset;
  const cpy=(y1+y2)/2 + ny*offset;

  // Label positioned on the curve midpoint (Phase A: on-edge label)
  const [mx,my]=qMid(x1,y1,cpx,cpy,x2,y2);
  const lx=mx;
  const ly=my;

  return {d:'M '+x1+' '+y1+' Q '+cpx+' '+cpy+' '+x2+' '+y2, lx, ly};
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

  // ── Draw edges ───────────────────────────────────────────────────────
  const eGrp=el('g');

  grouped.forEach(edge=>{
    const fp=pos[edge.from], tp=pos[edge.to];
    if(!fp) return;

    const isHL =selected&&isEdgeHL(edge);
    const isDim=selected&&!isHL;

    const isSelf=edge.isSelf;
    const stroke=isDim?C.edgeDim:isSelf?C.accent2:isHL?C.accent:C.edgeColor;
    const aId  =isDim?'a-d':isSelf?'a-s':isHL?'a-h':'a-n';
    const sw   =isHL?2.5:1.8;
    const op   =isDim?'0.2':'1';

    let pathD, lx, ly;

    if(isSelf){
      // Arc looping above the state node
      const sx=fp.x-22, sy=fp.y-R;
      const ex=fp.x+22, ey=fp.y-R;
      pathD='M '+sx+' '+sy+' A 40 30 0 1 1 '+ex+' '+ey;
      // Phase A: label positioned on arc midpoint
      lx=fp.x; ly=fp.y-R-32;
    } else {
      // Check if the reverse direction also has an arrow
      const hasReverse=directedSet.has(edge.to+'|||'+edge.from);
      // Both directions use the same positive curveFactor; because the
      // perpendicular flips sign when direction is reversed, they bow opposite ways.
      const cf=hasReverse?0.26:0.09;
      const ep=edgePath(fp.x,fp.y,tp.x,tp.y,cf);
      pathD=ep.d; lx=ep.lx; ly=ep.ly;
    }

    eGrp.appendChild(el('path',{
      d:pathD,fill:'none',stroke,'stroke-width':sw,
      'marker-end':'url(#'+aId+')','stroke-linecap':'round',
      opacity:op,
    }));

    // ── Label: always shows "..." ──────────────────────────────────────
    // Clicking it reveals the condition(s) in a tooltip.
    const labelStroke=isDim?C.edgeDim:isSelf?C.accent2:isHL?C.labelHlBorder:C.labelBorder;
    const labelFill  =isDim?C.textMuted:isSelf?C.accent2:isHL?C.labelTextHl:C.labelText;

    // Fixed-width pill for "..."
    const lw=34;
    const lbg=el('rect',{
      x:lx-lw/2,y:ly-9,width:lw,height:17,rx:4,ry:4,
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

    // Click → show tooltip with all conditions for this directed edge
    const tooltipForEdge=(ev)=>{
      ev.stopPropagation();
      showEdgeTooltip(ev.clientX, ev.clientY, edge);
    };
    lbg.addEventListener('click',tooltipForEdge);
    ltxt.addEventListener('click',tooltipForEdge);

    eGrp.appendChild(lbg);
    eGrp.appendChild(ltxt);
  });

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
    const fs=name.length>12?'9':name.length>8?'10':'11';
    const lbl=el('text',{
      x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle',
      fill:isSel?'#ffffff':C.text,
      'font-family':"Consolas,'Cascadia Code','Fira Code',monospace",
      'font-size':fs,'font-weight':'500',
    });
    if(name.length>14){
      const parts=name.split('_'), h=Math.ceil(parts.length/2);
      const t1=el('tspan',{x:p.x,dy:'-0.6em'}); t1.textContent=parts.slice(0,h).join('_');
      const t2=el('tspan',{x:p.x,dy:'1.2em'});  t2.textContent=parts.slice(h).join('_');
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
  applyT(); attachEvents(wrap);
  if(!didFit){didFit=true;requestAnimationFrame(fitToView);}
}

// ── Tooltip ───────────────────────────────────────────────────────────────
function showEdgeTooltip(mx, my, edge){
  const tt=document.getElementById('tt');
  tt.innerHTML='';

  // Header: "from → to"
  const hdr=document.createElement('div');
  hdr.className='tt-header';
  hdr.textContent=edge.from+' \u2192 '+edge.to;
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

document.addEventListener('click', ()=>hideTooltip());
document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideTooltip(); });

function infoHtml(fsm){
  const f=fsm||FSM_DATA[currentFsm];
  // Count unique directed edges (grouped)
  const grouped=groupEdges(f.transitions);
  const cnt=selected
    ?grouped.filter(e=>e.from===selected||e.to===selected).length
    :grouped.length;
  const modeLabel=focusMode===1?', outgoing only':focusMode===2?', incoming only':'';
  return '<h4>'+(selected?'&#9711; '+selected+modeLabel:'FSM Info')+'</h4>'+
    '<div class="info-row"><span>Signal</span><span class="v">'+f.signalName+'</span></div>'+
    '<div class="info-row"><span>Type</span><span class="v">'+f.typeName+'</span></div>'+
    '<div class="info-row"><span>States</span><span class="v">'+f.states.length+'</span></div>'+
    '<div class="info-row"><span>Arrows</span><span class="v">'+cnt+'</span></div>'+
    (selected?'<div class="info-note">Click again to cycle focus, click elsewhere to deselect</div>':'');
}

// ── Pan & Zoom ────────────────────────────────────────────────────────────
function attachEvents(wrap){
  wrap.addEventListener('mousedown',e=>{
    if(e.target.closest('[data-state]')) return;
    panning=true; px0=e.clientX-panX; py0=e.clientY-panY;
    wrap.classList.add('grabbing');
  });
  window.addEventListener('mousemove',e=>{
    if(!panning) return;
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
  wrap.addEventListener('click',e=>{
    if(!e.target.closest('[data-state]')&&!e.target.closest('[cursor="pointer"]')){
      selected=null; render();
    }
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
  const clone=svg.cloneNode(true);
  clone.setAttribute('width','900'); clone.setAttribute('height','650');
  const blob=new Blob([clone.outerHTML],{type:'image/svg+xml'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='fsm_diagram.svg'; a.click();
  URL.revokeObjectURL(url);
}

buildTabs();
render();
</script>
</body>
</html>`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
