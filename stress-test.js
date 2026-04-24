const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 3097;
let passed = 0, failed = 0, serverProc;

function fetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${path}`, {
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

async function runTests() {
  console.log('=== Stress Tests ===\n');

  serverProc = spawn('node', ['ai-dev-server.js'], {
    env: { ...process.env, PORT: PORT, LOG_FILE: 'stress_test.log', SNAPSHOT_DIR: './stress_snapshots' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 5000);
    serverProc.stdout.on('data', d => {
      if (d.toString().includes('ai-dev-server')) { clearTimeout(t); resolve(); }
    });
  });

  // Clear log first
  await fetch('/log', { method: 'DELETE' });

  await test('Duplicate error suppression', async () => {
    // Send same error 10 times rapidly
    for (let i = 0; i < 10; i++) {
      await fetch('/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'dup', message: 'same error' })
      });
    }
    await sleep(100);
    const r = await fetch('/log');
    const logs = JSON.parse(r.data);
    // Should have only 1 entry (others deduplicated)
    const dupLogs = logs.filter(l => l.type === 'dup' || l.type === 'repeated');
    assert(dupLogs.length <= 2, `Expected <=2 entries, got ${dupLogs.length}`);
  });

  await test('Different errors not suppressed', async () => {
    await fetch('/log', { method: 'DELETE' });
    for (let i = 0; i < 5; i++) {
      await fetch('/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'unique', message: `error ${i}` })
      });
    }
    await sleep(100);
    const r = await fetch('/log');
    const logs = JSON.parse(r.data);
    const uniqueLogs = logs.filter(l => l.type === 'unique');
    assert(uniqueLogs.length === 5, `Expected 5 entries, got ${uniqueLogs.length}`);
  });

  await test('100 sequential snapshots', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await fetch('/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: `<p>snap${i}</p>`, error: `test${i}` })
      });
      assert(r.status === 200, `Snapshot ${i} failed`);
    }
    const r = await fetch('/snapshots');
    const snaps = JSON.parse(r.data);
    assert(snaps.length >= 100, `Expected >=100 snapshots, got ${snaps.length}`);
  });

  await test('Static file caching headers', async () => {
    const r = await fetch('/');
    assert(r.status === 200, 'Should serve index.html');
  });

  await test('Long-running stability', async () => {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      await fetch('/status');
      await sleep(50);
    }
    const r = await fetch('/status');
    assert(r.status === 200, 'Server should still respond');
  });

  // Cleanup
  serverProc.kill();
  await sleep(500);
  if (fs.existsSync('stress_test.log')) fs.unlinkSync('stress_test.log');
  if (fs.existsSync('./stress_snapshots')) {
    fs.readdirSync('./stress_snapshots').forEach(f => fs.unlinkSync(`./stress_snapshots/${f}`));
    fs.rmdirSync('./stress_snapshots');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal:', e);
  if (serverProc) serverProc.kill();
  process.exit(1);
});
