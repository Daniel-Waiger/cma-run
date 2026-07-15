// CMA live dashboard — read-only mission control for a running (or finished)
// CMA execute workflow. Tails the newest wf_* run journal + agent transcripts
// under ~/.claude/projects and serves a self-refreshing page on localhost.
//
// Usage (from the project repo, so the task graph is auto-found):
//   node %USERPROFILE%\.claude\cma\tools\cma-dashboard.js [taskGraph.json] [port]
// Then open http://localhost:47613 (auto-increments if the port is busy).
//
// Zero-config: picks the run with the most recently written journal across ALL
// projects/sessions; task titles come from the executor prompts themselves
// ("TASK Tn: <title>"), and the full task list/batches from the newest
// docs/plans/*task-graph*.json under the current working directory if present.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const GRAPH_ARG = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
const PORT = Number(process.argv[3]) || 47613;

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function newestRunDir() {
  let best = null;
  let slugs = [];
  try { slugs = fs.readdirSync(PROJECTS); } catch (e) { return null; }
  for (const slug of slugs) {
    let sessions = [];
    try { sessions = fs.readdirSync(path.join(PROJECTS, slug)); } catch (e) { continue; }
    for (const sess of sessions) {
      const wfRoot = path.join(PROJECTS, slug, sess, 'subagents', 'workflows');
      let dirs = [];
      try { dirs = fs.readdirSync(wfRoot); } catch (e) { continue; }
      for (const d of dirs) {
        if (!d.startsWith('wf_')) continue;
        try {
          const t = fs.statSync(path.join(wfRoot, d, 'journal.jsonl')).mtimeMs;
          if (!best || t > best.t) best = { dir: path.join(wfRoot, d), t };
        } catch (e) { /* run without a journal yet */ }
      }
    }
  }
  return best && best.dir;
}

function findGraphPath() {
  if (GRAPH_ARG) return GRAPH_ARG;
  const plans = path.join(process.cwd(), 'docs', 'plans');
  try {
    const cands = fs.readdirSync(plans)
      .filter(f => /task-graph.*\.json$/i.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(plans, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return cands.length ? path.join(plans, cands[0].f) : null;
  } catch (e) { return null; }
}

function loadGraph() {
  const p = findGraphPath();
  const out = { titles: {}, batches: [], ids: [], source: p ? path.basename(p) : null };
  if (!p) return out;
  try {
    const g = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
    (g.tasks || []).forEach(t => { out.titles[t.id] = t.title; out.ids.push(t.id); });
    out.batches = g.batches || [];
  } catch (e) { /* titles stay empty */ }
  return out;
}

function walk(o, fn) {
  if (!o || typeof o !== 'object') return;
  fn(o);
  if (Array.isArray(o)) { o.forEach(x => walk(x, fn)); return; }
  for (const k in o) walk(o[k], fn);
}

// Task id, role, and title straight from the agent's prompt head ("TASK Tn: title").
function agentHead(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(20000);
    const n = fs.readSync(fd, buf, 0, 20000, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString('utf8').replace(/\\n/g, '\n').replace(/\\"/g, '"');
    const m = head.match(/TASK (T\d+): ([^\n]{1,160})/);
    return {
      task: m ? m[1] : '?',
      title: m ? m[2].trim() : '',
      role: /verif/i.test(head) ? 'verify' : 'execute',
    };
  } catch (e) { return { task: '?', title: '', role: '?' }; }
}

// Recent tool calls + latest text snippet from a live agent transcript.
function agentActivity(file, maxLines) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return { tools: [], note: '' }; }
  const lines = txt.trim().split('\n');
  const tools = [];
  let note = '';
  for (let i = Math.max(0, lines.length - (maxLines || 40)); i < lines.length; i++) {
    const j = safeParse(lines[i]);
    if (!j) continue;
    walk(j, o => {
      if (o.type === 'tool_use' && o.name) {
        const inp = o.input || {};
        const detail = inp.description || inp.file_path || inp.pattern ||
          (typeof inp.command === 'string' ? inp.command.slice(0, 100) : '') || '';
        tools.push({ name: o.name, detail: String(detail).slice(0, 120) });
      }
      if (o.type === 'text' && typeof o.text === 'string' && o.text.trim()) {
        note = o.text.trim().slice(0, 300);
      }
    });
  }
  return { tools: tools.slice(-8), lineCount: lines.length, note };
}

function buildState() {
  const runDir = newestRunDir();
  const graph = loadGraph();
  const state = {
    runDir: runDir ? path.basename(runDir) : null,
    graphSource: graph.source,
    now: new Date().toISOString(),
    tasks: {}, batches: graph.batches, problems: [], running: [], retries: 0,
  };
  graph.ids.forEach(id => {
    state.tasks[id] = { id, title: graph.titles[id] || '', status: 'pending', evidence: '', execSummary: '' };
  });
  if (!runDir) return state;

  let journal = [];
  try { journal = fs.readFileSync(path.join(runDir, 'journal.jsonl'), 'utf8').trim().split('\n'); }
  catch (e) { return state; }

  const started = [];
  const finished = {};
  const execSeen = {};
  const ensure = id => {
    if (!state.tasks[id]) state.tasks[id] = { id, title: '', status: 'pending', evidence: '', execSummary: '' };
    return state.tasks[id];
  };

  for (const line of journal) {
    const j = safeParse(line);
    if (!j) continue;
    if (j.type === 'started' && j.agentId) started.push(j.agentId);
    if (j.type === 'result') {
      if (j.agentId) finished[j.agentId] = true;
      let r = j.result;
      if (typeof r === 'string') r = safeParse(r) || {};
      if (!r || typeof r !== 'object' || !r.task_id) continue;
      const t = ensure(r.task_id);
      if ('outcome' in r) { // executor
        execSeen[r.task_id] = (execSeen[r.task_id] || 0) + 1;
        if (execSeen[r.task_id] > 1) state.retries++;
        t.status = r.outcome === 'done' ? 'awaiting-verify' : 'blocked';
        t.execSummary = (r.changes || []).map(c =>
          path.basename(String(c.file || '')) + ': ' + String(c.summary || '').slice(0, 90)
        ).join(' | ').slice(0, 400);
      } else if ('pass' in r) { // verifier
        t.status = r.pass ? 'pass' : 'retrying';
        t.evidence = String(r.evidence || '').slice(0, 500);
        (Array.isArray(r.problems) ? r.problems : []).forEach(p =>
          state.problems.push({ task: r.task_id, text: String(p).slice(0, 400) }));
      }
    }
  }

  // Titles + live-agent panel from transcripts (all agents for titles, live for activity).
  for (const id of started) {
    const f = path.join(runDir, 'agent-' + id + '.jsonl');
    if (!fs.existsSync(f)) continue;
    const h = agentHead(f);
    if (h.task !== '?' && h.title) {
      const t = ensure(h.task);
      if (!t.title) t.title = h.title;
    }
    if (finished[id]) continue;
    const act = agentActivity(f);
    const mtime = fs.statSync(f).mtimeMs;
    state.running.push({
      agent: id.slice(0, 8), task: h.task, role: h.role,
      idleSec: Math.round((Date.now() - mtime) / 1000),
      lines: act.lineCount, tools: act.tools, note: act.note,
    });
    const t = state.tasks[h.task];
    if (t && t.status !== 'pass') t.status = h.role === 'verify' ? 'verifying' : 'executing';
  }

  const vals = Object.values(state.tasks);
  state.passCount = vals.filter(t => t.status === 'pass').length;
  state.total = vals.length;
  state.knownTotal = graph.ids.length > 0;
  state.allDone = state.knownTotal && state.passCount === state.total && state.total > 0;
  return state;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>CMA live</title>
<style>
body{background:#0d1117;color:#c9d1d9;font-family:Consolas,monospace;margin:0;padding:24px;max-width:1100px}
h1{font-size:18px;color:#e6edf3} .dim{color:#8b949e}
.bar{height:14px;background:#21262d;border-radius:7px;overflow:hidden;margin:12px 0}
.bar>div{height:100%;background:linear-gradient(90deg,#238636,#2ea043);transition:width .8s}
.task{border:1px solid #30363d;border-radius:8px;padding:10px 14px;margin:8px 0;background:#161b22}
.task.pass{border-color:#238636}.task.executing,.task.verifying{border-color:#d29922;box-shadow:0 0 8px #d2992233}
.task.retrying,.task.blocked{border-color:#f85149}
.pill{display:inline-block;padding:1px 10px;border-radius:10px;font-size:11px;margin-left:8px;vertical-align:middle}
.p-pass{background:#238636;color:#fff}.p-pending{background:#30363d;color:#8b949e}
.p-executing,.p-verifying{background:#d29922;color:#000}.p-awaiting-verify{background:#1f6feb;color:#fff}
.p-retrying,.p-blocked{background:#f85149;color:#fff}
.spin{display:inline-block;animation:sp 1.1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
details{margin-top:6px}summary{cursor:pointer;color:#58a6ff;font-size:12px}
.ev{font-size:11px;color:#8b949e;white-space:pre-wrap;margin-top:4px}
.live{border:1px solid #d29922;border-radius:8px;padding:10px 14px;margin:14px 0;background:#1c1a12}
.tool{font-size:12px;margin:2px 0}.tool b{color:#79c0ff}
.prob{border-left:3px solid #d29922;padding:4px 10px;margin:6px 0;font-size:12px;background:#161b22}
.banner{padding:14px;border-radius:8px;text-align:center;font-size:16px;margin:14px 0}
.b-done{background:#238636;color:#fff}.b-run{background:#161b22;border:1px solid #30363d}
</style></head><body>
<h1>&#128640; CMA live — run <span id="run" class="dim"></span> <span id="graph" class="dim" style="font-size:12px"></span></h1>
<div id="banner" class="banner b-run">loading…</div>
<div class="bar"><div id="prog" style="width:0%"></div></div>
<div id="tasks"></div>
<div id="live"></div>
<h1>&#9888;&#65039; Verifier problems (non-blocking notes included)</h1>
<div id="probs" class="dim">none yet</div>
<p class="dim" id="ts"></p>
<script>
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function tick(){
 try{
  const s=await(await fetch('/state')).json();
  document.getElementById('run').textContent=s.runDir||'(no run found)';
  document.getElementById('graph').textContent=s.graphSource?('plan: '+s.graphSource):'(no task graph — tasks appear as agents start)';
  document.getElementById('prog').style.width=(100*s.passCount/(s.total||1))+'%';
  document.getElementById('banner').className='banner '+(s.allDone?'b-done':'b-run');
  document.getElementById('banner').innerHTML=s.allDone
    ?'&#127881; ALL '+s.total+' TASKS VERIFIED — orchestrator will deploy + commit next'
    :'<span class="spin">&#9881;&#65039;</span> '+s.passCount+' / '+(s.knownTotal?s.total:'?')+' verified'
      +(s.retries?' · '+s.retries+' retry':'')+' · '+s.running.length+' agent(s) live';
  document.getElementById('tasks').innerHTML=Object.values(s.tasks).map(t=>
   '<div class="task '+t.status+'"><b>'+t.id+'</b> '+esc(t.title)
   +'<span class="pill p-'+t.status+'">'+t.status+'</span>'
   +(t.execSummary?'<details><summary>executor changes</summary><div class="ev">'+esc(t.execSummary)+'</div></details>':'')
   +(t.evidence?'<details><summary>verifier evidence</summary><div class="ev">'+esc(t.evidence)+'…</div></details>':'')
   +'</div>').join('');
  document.getElementById('live').innerHTML=s.running.map(a=>
   '<div class="live"><b><span class="spin">&#128300;</span> '+a.task+' — '+a.role+'</b>'
   +' <span class="dim">(agent '+a.agent+', '+a.lines+' transcript lines, last write '+a.idleSec+'s ago)</span>'
   +(a.note?'<div class="ev">&#128173; '+esc(a.note)+'</div>':'')
   +'<div style="margin-top:6px">'+a.tools.map(t=>'<div class="tool"><b>'+esc(t.name)+'</b> <span class="dim">'+esc(t.detail)+'</span></div>').join('')+'</div></div>').join('');
  document.getElementById('probs').innerHTML=s.problems.length
    ? s.problems.map(p=>'<div class="prob"><b>'+p.task+'</b> '+esc(p.text)+'</div>').join('') : 'none yet';
  document.getElementById('ts').textContent='refreshed '+new Date().toLocaleTimeString()+' — auto-refresh 2s';
 }catch(e){document.getElementById('ts').textContent='refresh failed: '+e;}
}
tick();setInterval(tick,2000);
</script></body></html>`;

function serve(port, tries) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/state') {
      let body;
      try { body = JSON.stringify(buildState()); }
      catch (e) { body = JSON.stringify({ error: String(e) }); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    }
  });
  srv.on('error', e => {
    if (e.code === 'EADDRINUSE' && tries > 0) serve(port + 1, tries - 1);
    else { console.error('server error', e); process.exit(1); }
  });
  srv.listen(port, '127.0.0.1', () => console.log('DASHBOARD READY http://localhost:' + port));
}
serve(PORT, 5);
