#!/usr/bin/env node

// [ai_s_emblem:#low#config Imports]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
// [/ai_s_emblem: Imports]

// [ai_s_emblem:#low#config Config]
const BASE_PORT = parseInt(process.env.PORT) || 3000;
const MAX_PORT_TRIES = 10;
const LOG_FILE = process.env.LOG_FILE || 'error.log';
const STATIC_DIR = process.env.STATIC_DIR || '.';
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || './snapshots';
const AUTO_KILL = process.argv.includes('--kill');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Ensure snapshot directory exists
if (!fs.existsSync(SNAPSHOT_DIR)) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}
// [/ai_s_emblem: Config]

// [ai_s_emblem:#mid#logic ProcessManager]
function findProcessOnPort(port) {
  try {
    const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    return result ? result.split('\n').map(p => parseInt(p)) : [];
  } catch {
    return [];
  }
}

function killProcessOnPort(port) {
  const pids = findProcessOnPort(port);
  if (pids.length === 0) return false;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Killed process ${pid} on port ${port}`);
    } catch (e) {
      console.error(`Failed to kill ${pid}: ${e.message}`);
    }
  }
  return true;
}
// [/ai_s_emblem: ProcessManager]

// [ai_s_emblem:#high#logic Logger]
let lastError = { message: '', time: 0, count: 0 };
const DEDUP_WINDOW_MS = 5000; // 5秒以内の同一エラーは集約

function logError(entry) {
  const now = Date.now();
  const key = `${entry.type}:${entry.message}`;

  // 同一エラーが5秒以内に再発 → カウントのみ
  if (lastError.message === key && (now - lastError.time) < DEDUP_WINDOW_MS) {
    lastError.count++;
    lastError.time = now;
    return; // ログ書き込みスキップ
  }

  // 前の重複エラーがあれば書き出し
  if (lastError.count > 0) {
    const dupLine = JSON.stringify({
      timestamp: new Date(lastError.time).toISOString(),
      type: 'repeated',
      message: `Previous error repeated ${lastError.count} more times`
    }) + '\n';
    fs.appendFileSync(LOG_FILE, dupLine);
    console.error(`[repeated] Previous error x${lastError.count}`);
  }

  // 新規エラー記録
  lastError = { message: key, time: now, count: 0 };
  const timestamp = new Date().toISOString();
  const line = JSON.stringify({ timestamp, ...entry }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
  console.error(`[${timestamp}] ${entry.type}: ${entry.message}`);
}
// [/ai_s_emblem: Logger]

// [ai_s_emblem:#high#logic SnapshotManager]
let snapshotRequest = null; // { label, resolve }

function saveSnapshot(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).substring(2, 6);
  const filename = `snapshot_${timestamp}_${rand}.html`;
  const filepath = path.join(SNAPSHOT_DIR, filename);

  // Save HTML with inline styles
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Snapshot ${timestamp}</title>
  <style>${data.styles || ''}</style>
</head>
<body>
  <!-- Snapshot taken at ${data.timestamp || timestamp} -->
  <!-- Error: ${data.error || 'N/A'} -->
  <!-- URL: ${data.url || 'N/A'} -->
  ${data.html || ''}
</body>
</html>`;

  fs.writeFileSync(filepath, html);
  console.error(`[${timestamp}] snapshot: Saved ${filename}`);
  
  if (snapshotRequest && snapshotRequest.resolve) {
    snapshotRequest.resolve(filename);
    snapshotRequest = null;
  }

  // Also log the snapshot event
  logError({
    type: 'snapshot',
    message: `Snapshot saved: ${filename}`,
    file: filepath,
    error: data.error || null,
    url: data.url || null
  });
  
  return filename;
}

function listSnapshots() {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => ({
      name: f,
      path: `/snapshots/${f}`,
      time: fs.statSync(path.join(SNAPSHOT_DIR, f)).mtime
    }))
    .sort((a, b) => b.time - a.time);
}
// [/ai_s_emblem: SnapshotManager]

// [ai_s_emblem:#high#logic VideoManager]
let currentRecordingId = null;
let currentFrameIndex = 0;
let framesDir = null;

function startRecording() {
  currentRecordingId = Date.now().toString(36);
  currentFrameIndex = 0;
  framesDir = path.join(SNAPSHOT_DIR, `frames_${currentRecordingId}`);
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }
  console.log(`[Video] Started recording: ${currentRecordingId}`);
  return currentRecordingId;
}

function saveFrame(base64Image) {
  if (!currentRecordingId) return;
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, 'base64');
  const filename = `frame_${currentFrameIndex.toString().padStart(5, '0')}.png`;
  fs.writeFileSync(path.join(framesDir, filename), buffer);
  if (currentFrameIndex % 10 === 0) console.log(`[Video] Saved frame ${currentFrameIndex} for session ${currentRecordingId}`);
  currentFrameIndex++;
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!currentRecordingId || currentFrameIndex === 0) {
      if (currentRecordingId && framesDir && fs.existsSync(framesDir)) {
        fs.rmSync(framesDir, { recursive: true, force: true });
      }
      currentRecordingId = null;
      resolve({ ok: false, error: 'No frames recorded' });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilename = `video_${timestamp}.mp4`;
    const outputPath = path.join(SNAPSHOT_DIR, outputFilename);
    const framesPattern = path.join(framesDir, 'frame_%05d.png');

    const ffmpegCmd = `ffmpeg -y -framerate 10 -i "${framesPattern}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p "${outputPath}"`;
    console.log(`[Video] Compiling video: ${outputFilename} (${currentFrameIndex} frames)`);
    
    require('child_process').exec(ffmpegCmd, (error) => {
      if (fs.existsSync(framesDir)) {
        fs.rmSync(framesDir, { recursive: true, force: true });
      }
      currentRecordingId = null;

      if (error) {
        console.error(`[Video] FFmpeg error: ${error.message}`);
        resolve({ ok: false, error: 'FFmpeg failed to compile video' });
      } else {
        console.log(`[Video] Compiled video saved: ${outputFilename}`);
        resolve({ ok: true, file: outputFilename });
      }
    });
  });
}
// [/ai_s_emblem: VideoManager]

// [ai_s_emblem:#high#logic InputManager]
const inputQueue = [];

function pushInput(command) {
  // command: { action: 'click'|'type'|'eval', target?: string, value?: string, code?: string }
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
  inputQueue.push({ id, ...command });
  console.log(`[Input] Queued command: ${command.action}`);
  return id;
}

function popInput() {
  return inputQueue.shift() || null;
}
// [/ai_s_emblem: InputManager]

// [ai_s_emblem:#high#core Router]
function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const baseDir = path.resolve(STATIC_DIR);
  const filePath = path.resolve(baseDir, urlPath === '/' ? 'index.html' : (urlPath.startsWith('/') ? urlPath.slice(1) : urlPath));

  if (!filePath.startsWith(baseDir + path.sep) && filePath !== baseDir && filePath !== path.join(baseDir, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (req.method === 'POST' && urlPath === '/error') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        logError(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400); res.end('Invalid JSON');
      }
    });
  } else if (req.method === 'POST' && urlPath === '/snapshot') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const filename = saveSnapshot(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: filename }));
      } catch (e) {
        res.writeHead(400); res.end('Invalid JSON');
      }
    });
  } else if (req.method === 'GET' && urlPath === '/snapshots') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listSnapshots(), null, 2));
  } else if (req.method === 'GET' && urlPath.startsWith('/snapshots/')) {
    const file = urlPath.replace('/snapshots/', '');
    const baseDir = path.resolve(SNAPSHOT_DIR);
    const filepath = path.resolve(baseDir, file);
    // Ensure the file is inside SNAPSHOT_DIR and not just a prefix (like snapshots-secret)
    if (filepath.startsWith(baseDir + path.sep) && fs.existsSync(filepath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(filepath));
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  } else if (req.method === 'GET' && urlPath === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    const snippet = `
(function() {
  const SERVER = 'http://localhost:' + ${currentPort};
  function sendError(entry) {
    fetch(SERVER + '/error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
  }
  function sendSnapshot(label) {
    let styles = '';
    try {
      for (const sheet of document.styleSheets) {
        try { for (const rule of sheet.cssRules) { styles += rule.cssText + '\\n'; } } catch (e) {}
      }
    } catch (e) {}
    fetch(SERVER + '/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: document.body.innerHTML,
        styles: styles,
        url: location.href,
        label: label || 'auto',
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});
  }
  window.onerror = function(msg, src, line, col, err) {
    sendError({ type: 'error', message: msg, source: src, line: line, column: col, stack: err?.stack || '' });
    sendSnapshot('Error: ' + msg);
  };
  window.onunhandledrejection = function(e) {
    sendError({ type: 'unhandledrejection', message: e.reason?.message || String(e.reason), stack: e.reason?.stack || '' });
    sendSnapshot('Promise Rejection');
  };
  const origConsoleError = console.error;
  console.error = function(...args) {
    sendError({ type: 'console.error', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
    origConsoleError.apply(console, args);
  };
  setInterval(async () => {
    try {
      const res = await fetch(SERVER + '/input/pending');
      const data = await res.json();
      if (data.hasCommand) {
        const cmd = data.command;
        console.log('[Remote] Executing:', cmd.action);
        if (cmd.action === 'eval') { await eval(cmd.code); }
        else if (cmd.action === 'click') { document.querySelector(cmd.target)?.click(); }
        else if (cmd.action === 'type') {
          const el = document.querySelector(cmd.target);
          if (el) { el.value = cmd.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }
      const pendingRes = await fetch(SERVER + '/snapshot/pending');
      const pendingData = await pendingRes.json();
      if (pendingData.pending) { sendSnapshot(pendingData.label); }
    } catch (e) {}
  }, 500);
})();`.trim();
    res.end(snippet);
  } else if (req.method === 'GET' && urlPath === '/log') {
    if (!fs.existsSync(LOG_FILE)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
    const entries = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n')
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries, null, 2));
  } else if (req.method === 'DELETE' && urlPath === '/log') {
    fs.writeFileSync(LOG_FILE, '');
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"message":"Log cleared"}');
  } else if (req.method === 'GET' && urlPath === '/status') {
    const snapshots = fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.html')).length : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: currentPort, staticDir: path.resolve(STATIC_DIR), logFile: path.resolve(LOG_FILE), snapshotDir: path.resolve(SNAPSHOT_DIR), snapshotCount: snapshots, uptime: process.uptime() }, null, 2));
  } else if (req.method === 'POST' && urlPath === '/snapshot/request') {
    const url = new URL(req.url, `http://localhost`);
    const label = url.searchParams.get('label') || 'requested';
    const timeout = setTimeout(() => { if (snapshotRequest) { snapshotRequest = null; res.writeHead(408); res.end('{"ok":false,"error":"timeout"}'); } }, 5000);
    snapshotRequest = { label, resolve: (file) => { clearTimeout(timeout); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, file })); } };
  } else if (req.method === 'GET' && urlPath === '/snapshot/pending') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshotRequest ? { pending: true, label: snapshotRequest.label } : { pending: false }));
  
  // --- Recording Endpoints ---
  } else if (req.method === 'POST' && urlPath === '/record/start') {
    const id = startRecording();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, id }));
  } else if (req.method === 'POST' && urlPath === '/record/stop') {
    stopRecording().then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  } else if (req.method === 'POST' && urlPath === '/frame') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { image } = JSON.parse(body);
        saveFrame(image);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400); res.end('Invalid JSON');
      }
    });
  } else if (req.method === 'GET' && urlPath.startsWith('/videos/')) {
    const file = urlPath.replace('/videos/', '');
    const filepath = path.join(SNAPSHOT_DIR, file);
    if (fs.existsSync(filepath) && file.endsWith('.mp4')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      fs.createReadStream(filepath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not Found');
    }

  // --- New Input Endpoints ---
  } else if (req.method === 'POST' && urlPath === '/input') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const id = pushInput(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400); res.end('Invalid JSON');
      }
    });
  } else if (req.method === 'GET' && urlPath === '/input/pending') {
    const cmd = popInput();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (cmd) {
      res.end(JSON.stringify({ hasCommand: true, command: cmd }));
    } else {
      res.end('{"hasCommand":false}');
    }

  } else if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    res.writeHead(405); res.end('Method Not Allowed');
  }
}
// [/ai_s_emblem: Router]

// [ai_s_emblem:#high#core Server]
const server = http.createServer(handleRequest);
let currentPort = BASE_PORT;

function tryListen(port, attempt = 1) {
  if (attempt > MAX_PORT_TRIES) {
    console.error(`ERROR: Could not find open port after ${MAX_PORT_TRIES} attempts (tried ${BASE_PORT}-${port - 1})`);
    console.error(`Try: node ai-eyes.js --kill`);
    process.exit(1);
  }

  const pids = findProcessOnPort(port);
  if (pids.length > 0) {
    if (AUTO_KILL) {
      killProcessOnPort(port);
      setTimeout(() => tryListen(port, attempt), 500);
      return;
    }
    console.error(`Port ${port} in use by PID: ${pids.join(', ')}`);
    console.log(`Trying port ${port + 1}...`);
    tryListen(port + 1, attempt + 1);
    return;
  }

  server.listen(port, () => {
    currentPort = port;
    console.log(`\n✓ ai-eyes running on http://localhost:${port}`);
    console.log(`  Static:    ${path.resolve(STATIC_DIR)}`);
    console.log(`  Log:       ${path.resolve(LOG_FILE)}`);
    console.log(`  Snapshots: ${path.resolve(SNAPSHOT_DIR)}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /error     - Log error`);
    console.log(`  POST /snapshot  - Save HTML snapshot`);
    console.log(`  GET  /log       - Get errors`);
    console.log(`  POST /input     - Send remote command`);
    console.log(`  GET  /status    - Server status`);
    if (port !== BASE_PORT) {
      console.log(`\n⚠ Note: Using port ${port} instead of ${BASE_PORT}`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} already in use`);
      tryListen(port + 1, attempt + 1);
    } else {
      console.error(`Server error: ${err.message}`);
      process.exit(1);
    }
  });
}
// [/ai_s_emblem: Server]

// [ai_s_emblem:#mid#docs ClientSnippet]
/*
 * ブラウザ側に貼るコード (コピペ用)
 *
 * <script>
 * (function() {
 *   const SERVER = 'http://localhost:3000';
 *
 *   function sendError(entry) {
 *     fetch(SERVER + '/error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
 *   }
 *
 *   window.onerror = function(msg, src, line, col, err) {
 *     sendError({ type: 'error', message: msg, source: src, line: line, column: col, stack: err?.stack || '' });
 *   };
 *   window.onunhandledrejection = function(e) {
 *     sendError({ type: 'unhandledrejection', message: e.reason?.message || String(e.reason), stack: e.reason?.stack || '' });
 *   };
 *   const origConsoleError = console.error;
 *   console.error = function(...args) {
 *     sendError({ type: 'console.error', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
 *     origConsoleError.apply(console, args);
 *   };
 * 
 *   // --- Remote Control Listener ---
 *   let isRecording = false;
 *   function captureFrame() {
 *     if (!isRecording) return;
 *     const canvas = document.createElement('canvas');
 *     canvas.width = window.innerWidth;
 *     canvas.height = window.innerHeight;
 *     // Simple visualization (HTML to Canvas is limited, but we can capture at least some state)
 *     // Better approach: use html2canvas or similar if available, but for now we use eval to trigger captures.
 *   }
 *
 *   setInterval(() => {
 *     fetch(SERVER + '/input/pending').then(r => r.json()).then(data => {
 *       if (!data.hasCommand) return;
 *       const cmd = data.command;
 *       console.log('[Remote] Executing:', cmd.action);
 *       try {
 *         if (cmd.action === 'eval') {
 *           eval(cmd.code);
 *         } else if (cmd.action === 'record-start') {
 *           isRecording = true;
 *           // Capture loop
 *           const loop = () => {
 *             if (!isRecording) return;
 *             // Note: In real app, AI can trigger 'eval' to take screenshot using html2canvas or simply document.body
 *             requestAnimationFrame(loop);
 *           };
 *           loop();
 *         } else if (cmd.action === 'record-stop') {
 *           isRecording = false;
 *         } else if (cmd.action === 'click') {
 *           document.querySelector(cmd.target)?.click();
 *         } else if (cmd.action === 'type') {
 *           const el = document.querySelector(cmd.target);
 *           if (el) { el.value = cmd.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
 *         }
 *       } catch (err) {
 *         console.error('[Remote] Execution failed:', err);
 *       }
 *     }).catch(() => {});
 *   }, 1000);
 * })();
 * </script>
 */
// [/ai_s_emblem: ClientSnippet]

// [ai_s_emblem:#mid#test E2ETest]
const TEST_PORT = 3099;
const TEST_LOG = 'test_error.log';
const TEST_SNAPSHOTS = './test_snapshots';

function testFetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, `http://localhost:${TEST_PORT}`);
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function testCleanup() {
  if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
  if (fs.existsSync(TEST_SNAPSHOTS)) {
    fs.readdirSync(TEST_SNAPSHOTS).forEach(f => fs.unlinkSync(path.join(TEST_SNAPSHOTS, f)));
    fs.rmdirSync(TEST_SNAPSHOTS);
  }
}

async function runE2ETests() {
  console.log('=== ai-eyes E2E Test ===\n');
  testCleanup();

  let passed = 0, failed = 0;
  const assert = (cond, msg) => {
    if (cond) { passed++; console.log(`  ✓ ${msg}`); }
    else { failed++; console.log(`  ✗ ${msg}`); }
  };

  const serverProc = spawn(process.execPath, [__filename], {
    env: { ...process.env, PORT: TEST_PORT, LOG_FILE: TEST_LOG, SNAPSHOT_DIR: TEST_SNAPSHOTS },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 5000);
    serverProc.stdout.on('data', (d) => {
      if (d.toString().includes('ai-eyes running')) { clearTimeout(timeout); resolve(); }
    });
    serverProc.on('error', reject);
  });

  try {
    let res = await testFetch('/status');
    assert(res.status === 200, 'Status 200');

    // Test Remote Input
    console.log('\n[Test: Remote Input Queue]');
    res = await testFetch('/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'eval', code: 'console.log(1)' })
    });
    assert(res.status === 200, 'POST /input Status 200');
    
    res = await testFetch('/input/pending');
    assert(res.status === 200, 'GET /input/pending Status 200');
    let data = JSON.parse(res.data);
    assert(data.hasCommand === true, 'hasCommand: true');
    assert(data.command.action === 'eval', 'Returns queued command');
    
    res = await testFetch('/input/pending');
    data = JSON.parse(res.data);
    assert(data.hasCommand === false, 'Queue is empty after pop');

  } catch (e) {
    console.error('\nTest error:', e.message);
    failed++;
  }

  serverProc.kill();
  await new Promise(r => setTimeout(r, 300));
  testCleanup();
  process.exit(failed > 0 ? 1 : 0);
}
// [/ai_s_emblem: E2ETest]

// [ai_s_emblem:#high#entry Main]
function showHelp() {
  console.log(`
ai-eyes v0.4.0 - Zero-dependency dev server with Remote Control

USAGE:
  node ai-eyes.js [OPTIONS]

OPTIONS:
  --help     Show this help
  --test     Run E2E tests
  --kill     Kill existing process on port before starting

ENDPOINTS:
  POST /error            Log browser error (JSON body)
  POST /snapshot         Save HTML snapshot
  GET  /log              Get all logged errors
  GET  /snapshots        List saved snapshots

REMOTE CONTROL ENDPOINTS (For AI):
  POST /input            Queue a command for the browser
                         e.g. { "action": "eval", "code": "alert(1)" }
                         e.g. { "action": "click", "target": "#submit-btn" }
                         e.g. { "action": "type", "target": "#name", "value": "Test" }

BROWSER SNIPPET (paste in your HTML):
  (Run 'node ai-eyes.js' and copy the <script> snippet from the code)

EXAMPLES:
  node ai-eyes.js
  node ai-eyes.js --test

REMOTE CONTROL (cURL):
  curl -X POST localhost:3000/input -H "Content-Type: application/json" -d '{"action":"eval","code":"console.log(\\"Hello from AI\\")"}'
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
} else if (process.argv.includes('--test')) {
  runE2ETests();
} else {
  tryListen(BASE_PORT);
}
// [/ai_s_emblem: Main]
