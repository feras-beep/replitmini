// ------------------ Utilities ------------------
function qs(sel){ return document.querySelector(sel); }
function appendLine(text, cls='log'){
  const consoleEl = document.getElementById('console');
  const div = document.createElement('div');
  div.className = `line ${cls}`;
  div.textContent = text;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function clearConsole(){ document.getElementById('console').innerHTML = ''; }
function setStatus(s){
  const statusPill = document.getElementById('statusPill');
  statusPill.textContent = s;
  const map = { idle:'#334155', running:'#3b82f6', error:'#ef4444', done:'#10b981', loading:'#f59e0b' };
  statusPill.style.borderColor = map[s] || '#334155';
  statusPill.style.color = '#e2e8f0';
}

// ------------------ Pyodide loader ------------------
let pyodide = null;
async function ensurePyodide() {
  if (pyodide) return pyodide;
  setStatus('loading');
  const urlCandidates = [
    'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js',
    'https://cdn.jsdelivr.net/npm/pyodide@0.25.0/pyodide.js'
  ];
  let loaded = false;
  for (const src of urlCandidates) {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res; s.onerror = () => rej(new Error('Pyodide load failed'));
        document.head.appendChild(s);
      });
      // global loadPyodide now defined
      // @ts-ignore
      pyodide = await loadPyodide({
        stdout: (s) => appendLine(String(s), 'log'),
        stderr: (s) => appendLine(String(s), 'err'),
      });
      loaded = true; break;
    } catch(e) { appendLine(String(e), 'warn'); }
  }
  if (!loaded) throw new Error('Unable to load Pyodide from any CDN');
  return pyodide;
}

// ------------------ Ace (or fallback) loader ------------------
const Editor = {
  isAce: false,
  elAce: null,
  elTA: null,
  inst: null,
  init: async function() {
    this.elAce = document.getElementById('editor-ace');
    this.elTA = document.getElementById('editor-ta');
    const ok = await this.tryLoadAce();
    if (ok && window.ace) {
      this.inst = window.ace.edit('editor-ace');
      this.inst.setTheme('ace/theme/monokai');
      this.inst.session.setMode('ace/mode/javascript');
      this.inst.setOptions({ fontSize:'14px', showPrintMargin:false, useSoftTabs:true, tabSize:2 });
      this.isAce = true;
      this.elAce.style.display = 'block';
      this.elTA.style.display = 'none';
    } else {
      // Fallback textarea editor
      this.isAce = false;
      this.elAce.style.display = 'none';
      this.elTA.style.display = 'block';
      // Simple tab support
      this.elTA.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); const start = e.target.selectionStart; const end = e.target.selectionEnd; const v = e.target.value; e.target.value = v.substring(0,start) + '  ' + v.substring(end); e.target.selectionStart = e.target.selectionEnd = start + 2; }
      });
    }
    this.bindShortcut();
  },
  tryLoadAce: async function() {
    const urls = [
      'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.0/ace.js',
      'https://cdn.jsdelivr.net/npm/ace-builds@1.32.0/src-min-noconflict/ace.js'
    ];
    for (const src of urls) {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Ace load failed'));
          document.head.appendChild(s);
        });
        if (window.ace) return true;
      } catch(e) { appendLine(String(e), 'warn'); }
    }
    return false;
  },
  setMode(mode){ if (this.isAce) this.inst.session.setMode(mode); /* no-op in fallback */ },
  setValue(v){ if (this.isAce) this.inst.session.setValue(v); else this.elTA.value = v; },
  getValue(){ return this.isAce ? this.inst.getValue() : this.elTA.value; },
  bindShortcut(handler){ /* overload below */ },
  bindShortcut(){
    const handler = window.runCurrent;
    if (this.isAce) {
      this.inst.commands.addCommand({ name:'run', bindKey:{win:'Ctrl-Enter', mac:'Command-Enter'}, exec: handler });
    } else {
      this.elTA.addEventListener('keydown', (e)=>{
        if ((e.ctrlKey||e.metaKey) && e.key === 'Enter') { e.preventDefault(); handler(); }
      });
    }
  }
};

// ------------------ Local storage helpers ------------------
function storageKey(lang){ return `mini-repl-code-${lang}`; }
function loadCode(lang){ return localStorage.getItem(storageKey(lang)); }
function saveCode(lang, code){ localStorage.setItem(storageKey(lang), code); }

// Generic VFS helpers (used by WebApp and Node modes)
function vfsKey(mode){ return mode === 'node' ? 'mini-repl-node-vfs' : 'mini-repl-vfs'; }
function defaultVFS(mode='webapp'){
  if (mode === 'node') {
    return {
      files: {
        'package.json': `{
  "name": "mini-node-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "start": "node server.js" }
}`,
        'server.js': `import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const port = process.env.PORT || 3000;
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};

const server = http.createServer((req,res)=>{
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = join('public', url);
  try {
    if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const data = readFileSync(filePath);
    res.writeHead(200, {'Content-Type': mime[extname(filePath)]||'text/plain'});
    res.end(data);
  } catch(e){ res.writeHead(500); res.end('Server error'); }
});
server.listen(port, ()=> console.log('Server listening on port', port));
`,
        'public/index.html': '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Node WebContainer App</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>Node WebContainer App</h1><p id="msg">Hello from Node on <code>WebContainers</code>.</p><button id="ping">Ping</button><pre id="out"></pre><script src="/app.js"></script></main></body></html>',
        'public/style.css': `body{font-family:ui-sans-serif,system-ui;margin:0;padding:2rem}main{max-width:680px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;padding:1rem 1.25rem}`,
        'public/app.js': `document.getElementById('ping').addEventListener('click',()=>{ const o=document.getElementById('out'); o.textContent+='\\nPONG ' + new Date().toLocaleTimeString(); console.log('PING'); });`
      },
      active: 'public/index.html'
    };
  }
  // webapp default
  return {
    files: {
      'index.html': `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mini Web App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Mini Web App</h1>
    <p id="msg">Counter: <span id="count">0</span></p>
    <button id="inc">Increment</button>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
      'style.css': `:root { --fg:#0f172a; --accent:#2563eb; }
*{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui; margin:0; padding:2rem; }
main{max-width:640px;margin:0 auto; padding:1rem 1.25rem; border:1px solid #e5e7eb; border-radius:12px;}
h1{color:var(--fg)}
button{padding:.5rem .75rem; border-radius:.5rem; border:1px solid #e5e7eb; background:#111827; color:#e5e7eb}
button:hover{filter:brightness(1.1)}
`,
      'script.js': `const el = (id)=>document.getElementById(id);
let n = 0;
el('inc').addEventListener('click', ()=>{ n++; el('count').textContent = String(n); console.log('counter', n); });
console.log('app boot');`
    },
    active: 'index.html'
  };
}
function loadVFS(mode='webapp'){
  try { return JSON.parse(localStorage.getItem(vfsKey(mode))) || defaultVFS(mode); }
  catch { return defaultVFS(mode); }
}
function saveVFS(v, mode='webapp'){ localStorage.setItem(vfsKey(mode), JSON.stringify(v)); }

const JS_EXAMPLE = `// JavaScript example\nfunction fib(n){ return n<2 ? n : fib(n-1)+fib(n-2); }\nconsole.log('Fibonacci:');\nfor (let i=0;i<10;i++){ console.log(i, fib(i)); }`;
const PY_EXAMPLE = `# Python example (Pyodide)\nimport math\nprint('Primes < 100:')\nfor n in range(2, 100):\n    if all(n % d for d in range(2, int(math.sqrt(n)) + 1)):\n        print(n)`;

function initContent(lang){
  const saved = loadCode(lang);
  if (saved) return saved;
  return lang === 'python' ? PY_EXAMPLE : JS_EXAMPLE;
}

// ------------------ Web App builder (static) ------------------
function inlineAssets(html, vfs){
  html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (m, href) => {
    if (vfs.files[href]) return `<style>\n${vfs.files[href]}\n</style>`; else return m;
  });
  html = html.replace(/<script([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (m, pre, src, post) => {
    if (vfs.files[src]) return `<script${pre}${post}>\n${vfs.files[src]}\n</script>`; else return m;
  });
  const bridge = `<script>(function(){
  const ol=console.log, ow=console.warn, oe=console.error;
  function send(t,...a){ try{ parent.postMessage({source:'mini-repl-preview', type:t, data:a.map(String).join(' ')}, '*'); }catch(e){} }
  console.log=(...a)=>{send('preview-log',...a); ol(...a);} ;
  console.warn=(...a)=>{send('preview-warn',...a); ow(...a);} ;
  console.error=(...a)=>{send('preview-err',...a); oe(...a);} ;
  window.addEventListener('error', e=>send('preview-err', e.message));
})();</script>`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m)=> m + '\n' + bridge);
  else html = bridge + html;
  return html;
}
function runWebApp(vfsOverride=null){
  const vfs = vfsOverride || loadVFS('webapp');
  const entry = vfs.files['index.html'] ? 'index.html' : Object.keys(vfs.files)[0];
  let html = vfs.files[entry] || '<!doctype html><html><body><h1>No index.html found</h1></body></html>';
  html = inlineAssets(html, vfs);
  const wrap = document.getElementById('previewWrap');
  const iframe = document.getElementById('preview');
  wrap.setAttribute('aria-hidden', 'false');
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
  iframe.srcdoc = html;
  setStatus('done');
  appendLine('— Web app built —', 'ok');
}

// ------------------ Node (WebContainers) ------------------
let wc = null; let nodeProc = null;
async function ensureWebContainers(){
  // Check cross-origin isolation (required)
  if (!self.crossOriginIsolated) {
    appendLine('WebContainers need COOP/COEP headers. Host this file with: COOP: same-origin, COEP: require-corp.', 'warn');
  }
  try {
    // Prefer dynamic import (ESM)
    try {
      return await import('https://cdn.jsdelivr.net/npm/@webcontainer/api/dist/index.js');
    } catch(e1){
      return await import('https://unpkg.com/@webcontainer/api/dist/index.js');
    }
  } catch(e) {
    appendLine('Failed to load @webcontainer/api from CDNs.', 'err');
    throw e;
  }
}
function vfsToTree(vfs){
  const tree = {};
  function setPath(obj, parts, content){
    const [head, ...rest] = parts;
    if (!head) return;
    if (rest.length === 0) {
      obj[head] = { file: { contents: content } };
    } else {
      obj[head] = obj[head] || { directory: {} };
      setPath(obj[head].directory, rest, content);
    }
  }
  for (const [path, content] of Object.entries(vfs.files)) {
    setPath(tree, path.split('/'), content);
  }
  return tree;
}
async function nodeMount(){
  const vfs = loadVFS('node');
  const { WebContainer } = await ensureWebContainers();
  if (!wc) wc = await WebContainer.boot();
  await wc.mount(vfsToTree(vfs));
  wc.on('server-ready', (port, url) => {
    appendLine(`Node server ready on ${url}`, 'ok');
    const wrap = document.getElementById('previewWrap');
    const iframe = document.getElementById('preview');
    wrap.setAttribute('aria-hidden', 'false');
    iframe.removeAttribute('sandbox'); // allow full preview
    iframe.src = url;
  });
  return wc;
}
function streamToConsole(stream){
  const reader = stream.getReader();
  const dec = new TextDecoder();
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        appendLine(dec.decode(value), 'log');
      }
    } catch(_){}
  })();
}
async function nodeInstall(){
  const wc = await nodeMount();
  appendLine('Installing dependencies (npm install)...', 'warn');
  const p = await wc.spawn('npm', ['install']);
  streamToConsole(p.output);
  const code = await p.exit;
  appendLine(`npm install exited with code ${code}`, code === 0 ? 'ok' : 'err');
}
async function nodeStart(){
  const wc = await nodeMount();
  appendLine('Starting server (npm start)...', 'warn');
  nodeProc = await wc.spawn('npm', ['run', 'start']);
  streamToConsole(nodeProc.output);
  nodeProc.exit.then((code)=>{ appendLine(`server exited (${code})`, code===0?'ok':'err'); });
}
function nodeStop(){ if (nodeProc) { nodeProc.kill(); nodeProc = null; appendLine('— Node process killed —', 'warn'); } }

// ------------------ Runners ------------------
let jsWorker = null;
function stopJS(){ if (jsWorker) { jsWorker.terminate(); jsWorker = null; setStatus('idle'); appendLine('— JS execution stopped —', 'warn'); } }
function runJS(code){
  return new Promise((resolve) => {
    stopJS(); setStatus('running');
    const blobSource = `self.onmessage = (ev) => {\n  const code = ev.data;\n  function send(t,d){ self.postMessage({ type:t, data:d }); }\n  const console = {\n    log: (...args) => send('log', args.map(a => typeof a==='object' ? JSON.stringify(a) : String(a)).join(' ')),\n    warn: (...args) => send('warn', args.join(' ')),\n    error: (...args) => send('error', args.join(' ')),\n  };\n  try { eval(code); send('done'); } catch (e) { send('error', (e && e.stack) ? e.stack : String(e)); }\n}`;
    const workerBlob = new Blob([blobSource], { type: 'application/javascript' });
    jsWorker = new Worker(URL.createObjectURL(workerBlob));
    jsWorker.onmessage = (e) => {
      const { type, data } = e.data || {};
      if (type === 'log') appendLine(String(data), 'log');
      else if (type === 'warn') appendLine(String(data), 'warn');
      else if (type === 'error') { appendLine(String(data), 'err'); setStatus('error'); resolve({ ok:false }); }
      else if (type === 'done') { setStatus('done'); appendLine('— JS finished —', 'ok'); resolve({ ok:true }); }
    };
    jsWorker.onerror = (e) => { appendLine(`JS error: ${e.message}`, 'err'); setStatus('error'); resolve({ ok:false }); };
    jsWorker.postMessage(code);
  });
}
async function runPython(code){
  try { setStatus('loading'); await ensurePyodide(); setStatus('running');
    const result = await pyodide.runPythonAsync(code);
    if (typeof result !== 'undefined') appendLine(String(result), 'ok');
    setStatus('done'); appendLine('— Python finished —', 'ok'); return { ok:true };
  } catch (e) { appendLine(String(e && e.message ? e.message : e), 'err'); setStatus('error'); return { ok:false }; }
}

// ------------------ Wiring after DOM ready ------------------
window.addEventListener('DOMContentLoaded', async () => {
  const modeSelect = document.getElementById('mode');
  const runBtn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const testBtn = document.getElementById('testBtn');
  const installBtn = document.getElementById('installBtn');

  const filebar = document.getElementById('filebar');
  const fileSelect = document.getElementById('fileSelect');
  const addFileBtn = document.getElementById('addFile');
  const delFileBtn = document.getElementById('delFile');
  const renFileBtn = document.getElementById('renFile');
  const resetBtn = document.getElementById('resetVFS');

  await Editor.init();
  Editor.setValue(initContent('javascript'));

  function isProjectMode(){ return ['webapp','node'].includes(modeSelect.value); }
  function currentVFS(){ return loadVFS(modeSelect.value); }
  function saveCurrentVFS(v){ return saveVFS(v, modeSelect.value); }

  function refreshFilebarVisibility(){
    const show = isProjectMode();
    filebar.setAttribute('aria-hidden', String(!show));
    document.getElementById('previewWrap').setAttribute('aria-hidden', String(!show));
    installBtn.style.display = modeSelect.value === 'node' ? 'inline-block' : 'none';
  }
  function refreshFileSelect(){
    const vfs = currentVFS();
    fileSelect.innerHTML = '';
    Object.keys(vfs.files).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name; if (name === vfs.active) opt.selected = true;
      fileSelect.appendChild(opt);
    });
  }
  function setActiveFile(name){
    const vfs = currentVFS();
    if (!vfs.files[name]) return;
    vfs.active = name; saveCurrentVFS(vfs);
    const ext = (name.split('.').pop()||'').toLowerCase();
    if (ext === 'html') Editor.setMode('ace/mode/html');
    else if (ext === 'css') Editor.setMode('ace/mode/css');
    else if (ext === 'js') Editor.setMode('ace/mode/javascript');
    else if (ext === 'json') Editor.setMode('ace/mode/json');
    else Editor.setMode('ace/mode/text');
    Editor.setValue(vfs.files[name]);
  }

  // Mode switching
  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value;
    saveCode('javascript', Editor.getValue());
    saveCode('python', Editor.getValue());
    if (mode === 'python') Editor.setMode('ace/mode/python');
    else if (isProjectMode()) { refreshFileSelect(); const vfs = currentVFS(); setActiveFile(vfs.active || (mode==='node'?'public/index.html':'index.html')); }
    else Editor.setMode('ace/mode/javascript');
    if (!isProjectMode()) Editor.setValue(initContent(mode));
    setStatus('idle'); refreshFilebarVisibility(); appendLine(`— Switched to ${mode.toUpperCase()} —`, 'ok');
  });

  // Filebar actions
  fileSelect.addEventListener('change', () => setActiveFile(fileSelect.value));
  addFileBtn.addEventListener('click', () => {
    const name = prompt('New file name (e.g. utils.js, styles.css, page.html):', modeSelect.value==='node'?'public/new.js':'new.js');
    if (!name) return; const vfs = currentVFS(); if (vfs.files[name]) return alert('File already exists');
    vfs.files[name] = ''; vfs.active = name; saveCurrentVFS(vfs); refreshFileSelect(); setActiveFile(name);
  });
  delFileBtn.addEventListener('click', () => {
    const vfs = currentVFS(); const name = vfs.active; if (!name) return; if (!confirm(`Delete ${name}?`)) return;
    delete vfs.files[name]; vfs.active = Object.keys(vfs.files)[0] || ''; saveCurrentVFS(vfs); refreshFileSelect(); setActiveFile(vfs.active);
  });
  renFileBtn.addEventListener('click', () => {
    const vfs = currentVFS(); const old = vfs.active; if (!old) return; const neu = prompt('Rename file to:', old); if (!neu || neu === old) return; if (vfs.files[neu]) return alert('A file with that name already exists');
    vfs.files[neu] = vfs.files[old]; delete vfs.files[old]; vfs.active = neu; saveCurrentVFS(vfs); refreshFileSelect(); setActiveFile(neu);
  });
  resetBtn.addEventListener('click', () => {
    if (!confirm('Reset the project to the starter template? This will overwrite your current files.')) return;
    saveVFS(defaultVFS(modeSelect.value), modeSelect.value); refreshFileSelect(); setActiveFile(modeSelect.value==='node'?'public/index.html':'index.html');
  });

  // Run wiring
  window.runCurrent = async function runCurrent(){
    const mode = modeSelect.value; clearConsole();
    if (mode === 'python') {
      const code = Editor.getValue(); saveCode('python', code); await runPython(code);
    } else if (mode === 'webapp') {
      const vfs = currentVFS(); vfs.files[vfs.active] = Editor.getValue(); saveCurrentVFS(vfs); runWebApp();
    } else if (mode === 'node') {
      const vfs = currentVFS(); vfs.files[vfs.active] = Editor.getValue(); saveCurrentVFS(vfs); await nodeStart();
    } else { // javascript
      const code = Editor.getValue(); saveCode('javascript', code); await runJS(code);
    }
  }

  // Autosave edited content (project modes) + auto-refresh preview
  let lastContent = Editor.getValue();
  setInterval(() => {
    if (isProjectMode()) {
      const vfs = currentVFS();
      if (!vfs.active) return;
      const currentContent = Editor.getValue();
      vfs.files[vfs.active] = currentContent;
      saveCurrentVFS(vfs);

      // Auto-refresh preview if content changed
      if (currentContent !== lastContent) {
        lastContent = currentContent;
        if (modeSelect.value === 'webapp') {
          runWebApp();
        }
        // Note: Node mode requires explicit restart for server changes
      }
    }
  }, 1000);

  runBtn.addEventListener('click', window.runCurrent);
  clearBtn.addEventListener('click', clearConsole);
  stopBtn.addEventListener('click', () => { if (modeSelect.value === 'javascript') stopJS(); else if (modeSelect.value === 'node') nodeStop(); else appendLine('Stop not available for Python/WebApp in this demo.', 'warn'); });
  installBtn.addEventListener('click', () => { if (modeSelect.value === 'node') nodeInstall(); });

  // Self tests (JS, Python, WebApp, Node)
  testBtn.addEventListener('click', async () => {
    appendLine('— Running self-tests —', 'warn');
    const prevMode = modeSelect.value;

    // JS
    modeSelect.value = 'javascript'; Editor.setMode('ace/mode/javascript'); clearConsole();
    await runJS('console.log("TEST_JS", [1,2,3].reduce((a,b)=>a+b,0));');
    const jsPass = document.getElementById('console').textContent.includes('TEST_JS 6');
    appendLine(`JS test ${jsPass ? 'PASS' : 'FAIL'}`, jsPass ? 'ok' : 'err');

    // Python
    modeSelect.value = 'python'; Editor.setMode('ace/mode/python'); clearConsole();
    await runPython('import math\\nprint("TEST_PY", math.factorial(5))');
    const pyPass = document.getElementById('console').textContent.includes('TEST_PY 120');
    appendLine(`Python test ${pyPass ? 'PASS' : 'FAIL'}`, pyPass ? 'ok' : 'err');

    // WebApp
    modeSelect.value = 'webapp'; clearConsole();
    runWebApp({ files: { 'index.html': '<!doctype html><html><body><h1>T</h1><script>console.log("TEST_WEBAPP", 25)</script></body></html>' }, active: 'index.html' });
    setTimeout(() => {
      const webPass = document.getElementById('console').textContent.includes('TEST_WEBAPP 25');
      appendLine(`WebApp test ${webPass ? 'PASS' : 'FAIL'}`, webPass ? 'ok' : 'err');
    }, 300);

    // Node
    modeSelect.value = 'node'; clearConsole();
    try {
      const { WebContainer } = await ensureWebContainers();
      if (!self.crossOriginIsolated) throw new Error('Not crossOriginIsolated');
      if (!wc) wc = await WebContainer.boot();
      const p = await wc.spawn('node', ['-e', 'console.log("TEST_NODE", 7*6)']);
      streamToConsole(p.output); await p.exit;
      const nodePass = document.getElementById('console').textContent.includes('TEST_NODE 42');
      appendLine(`Node test ${nodePass ? 'PASS' : 'FAIL'}`, nodePass ? 'ok' : 'err');
    } catch(e) {
      appendLine('Node test SKIPPED (host must send COOP/COEP headers).', 'warn');
    }

    // restore
    modeSelect.value = prevMode; appendLine('— Self-tests complete —', 'ok');
  });

  // Initial state
  appendLine('Ready. Modes: JavaScript, Python, WebApp (static), Node (WebContainers). If Ace fails to load, a fallback editor is used.', 'ok');
  document.getElementById('previewWrap').setAttribute('aria-hidden', 'true');
  setStatus('idle');
});

// Preview message listener
window.addEventListener('message', (ev)=>{
  if (ev.data && ev.data.source === 'mini-repl-preview') {
    const { type, data } = ev.data;
    if (type === 'preview-log') appendLine(String(data), 'log');
    else if (type === 'preview-warn') appendLine(String(data), 'warn');
    else if (type === 'preview-err') appendLine(String(data), 'err');
  }
});
