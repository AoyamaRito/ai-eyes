const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3096;
const TEST_LOG = 'e2e_test.log';
const TEST_SNAPSHOTS = './e2e_snapshots';
const TEST_STATIC = './e2e_static';
let passed = 0, failed = 0, serverProc;

function fetch(urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${urlPath}`, {
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function test(name, fn) {
  return fn().then(() => {
    passed++;
    console.log(`✅ ${name}`);
  }).catch(e => {
    failed++;
    console.log(`❌ ${name}: ${e.message}`);
  });
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runAllTests() {
  console.log('=== ai-dev-server Unified E2E Tests ===\n');
  if (!fs.existsSync(TEST_STATIC)) fs.mkdirSync(TEST_STATIC);

  // Start server
  serverProc = spawn('node', ['ai-dev-server.js'], {
    env: { ...process.env, PORT: PORT, LOG_FILE: TEST_LOG, SNAPSHOT_DIR: TEST_SNAPSHOTS, STATIC_DIR: TEST_STATIC },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Server start timeout')), 5000);
    serverProc.stderr.on('data', d => console.error('[Server Error]', d.toString()));
    serverProc.stdout.on('data', d => {
      if (d.toString().includes('ai-dev-server running')) { clearTimeout(t); resolve(); }
    });
  });

  // 1. Basic Status
  await test('Basic Status', async () => {
    const r = await fetch('/status');
    assert(r.status === 200, 'Status 200');
    const data = JSON.parse(r.data);
    assert(data.ok === true, 'ok: true');
  });

  // 2. Error Logging & Deduplication
  await test('Error Logging & Deduplication', async () => {
    await fetch('/log', { method: 'DELETE' });
    
    // Send 3 identical errors
    for (let i = 0; i < 3; i++) {
      await fetch('/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'test', message: 'dedup test' })
      });
    }
    
    // Send 1 different error
    await fetch('/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: 'different' })
    });

    const r = await fetch('/log');
    const logs = JSON.parse(r.data);
    const deduped = logs.filter(l => l.message === 'dedup test');
    assert(deduped.length === 1, `Expected 1 deduped entry, got ${deduped.length}`);
    assert(logs.some(l => l.message === 'different'), 'Should have different error');
  });

  // 3. Snapshot Workflow
  await test('Snapshot Workflow', async () => {
    const r = await fetch('/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<h1>Test</h1>', error: 'snap error' })
    });
    assert(r.status === 200, 'Snapshot POST Status 200');
    const resData = JSON.parse(r.data);
    assert(resData.ok === true && resData.file, 'Should return filename');

    const listRes = await fetch('/snapshots');
    const snaps = JSON.parse(listRes.data);
    assert(snaps.some(s => s.name === resData.file), 'Snapshot should be in list');

    const getRes = await fetch(`/snapshots/${resData.file}`);
    assert(getRes.status === 200, 'Can retrieve snapshot file');
    assert(getRes.data.includes('<h1>Test</h1>'), 'Content matches');
  });

  // 4. E2E Snapshot Request (Wait for interaction)
  await test('E2E Snapshot Request (Blocking)', async () => {
    const requestPromise = fetch('/snapshot/request?label=test-label', { method: 'POST' });
    
    await sleep(200); // Wait for request to be registered
    
    const pendingRes = await fetch('/snapshot/pending');
    assert(JSON.parse(pendingRes.data).pending === true, 'Should be pending');

    // Simulate browser sending snapshot
    await fetch('/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<p>Interacted</p>', label: 'test-label' })
    });

    const res = await requestPromise;
    assert(res.status === 200, 'Request should resolve with 200');
    assert(JSON.parse(res.data).ok === true, 'Response should be ok');
  });

  // 5. Remote Input Queue
  await test('Remote Input Queue', async () => {
    await fetch('/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', target: '#btn' })
    });
    
    const r1 = await fetch('/input/pending');
    const d1 = JSON.parse(r1.data);
    assert(d1.hasCommand === true, 'Should have command');
    assert(d1.command.action === 'click', 'Command action matches');

    const r2 = await fetch('/input/pending');
    const d2 = JSON.parse(r2.data);
    assert(d2.hasCommand === false, 'Queue should be empty');
  });

  // 6. Security - Path Traversal
  await test('Security: Path Traversal', async () => {
    const r = await fetch('/../package.json');
    assert(r.status === 403 || r.status === 404, `Should block traversal (got ${r.status})`);
  });

  // 7. Video Recording
  await test('Video Recording', async () => {
    // Start recording
    const startRes = await fetch('/record/start', { method: 'POST' });
    const startData = JSON.parse(startRes.data);
    assert(startData.ok === true, 'Should start recording');

    // Send 3 dummy frames (red dot)
    const redDot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
    for (let i = 0; i < 3; i++) {
      await fetch('/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: redDot })
      });
    }

    // Stop recording and generate video
    const stopRes = await fetch('/record/stop', { method: 'POST' });
    const stopData = JSON.parse(stopRes.data);
    assert(stopData.ok === true, 'Should stop recording and generate video');
    assert(stopData.file.endsWith('.mp4'), 'Should return mp4 filename');
    
    // Verify video exists
    const videoRes = await fetch(`/videos/${stopData.file}`);
    assert(videoRes.status === 200, 'Should be able to retrieve video');
    assert(videoRes.headers['content-type'] === 'video/mp4', 'Should have video/mp4 content type');
  });

  // Cleanup
  serverProc.kill();
  await sleep(300);
  if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
  if (fs.existsSync(TEST_SNAPSHOTS)) {
    fs.readdirSync(TEST_SNAPSHOTS).forEach(f => fs.unlinkSync(path.join(TEST_SNAPSHOTS, f)));
    fs.rmdirSync(TEST_SNAPSHOTS);
  }
  if (fs.existsSync(TEST_STATIC)) {
    fs.readdirSync(TEST_STATIC).forEach(f => fs.unlinkSync(path.join(TEST_STATIC, f)));
    fs.rmdirSync(TEST_STATIC);
  }

  console.log(`\n=== Final Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(e => {
  console.error('Fatal Test Error:', e);
  if (serverProc) serverProc.kill();
  process.exit(1);
});
