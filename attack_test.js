const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 3098;
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runTests() {
  console.log('=== Attack Tests ===\n');

  // Start server
  serverProc = spawn('node', ['ai_dev_server.js'], {
    env: { ...process.env, PORT: PORT, LOG_FILE: 'attack_test.log', SNAPSHOT_DIR: './attack_snapshots' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 5000);
    serverProc.stdout.on('data', d => {
      if (d.toString().includes('ai-dev-server')) { clearTimeout(t); resolve(); }
    });
  });

  // Tests
  await test('Empty POST body to /error', async () => {
    const r = await fetch('/error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
    assert(r.status === 400, 'Should return 400');
  });

  await test('Huge error message', async () => {
    const huge = 'x'.repeat(100000);
    const r = await fetch('/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: huge })
    });
    assert(r.status === 200, 'Should handle huge message');
  });

  await test('Special characters in error', async () => {
    const r = await fetch('/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: '<script>alert("xss")</script>' })
    });
    assert(r.status === 200, 'Should handle special chars');
  });

  await test('Unicode in error', async () => {
    const r = await fetch('/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: '日本語エラー 🔥' })
    });
    assert(r.status === 200, 'Should handle unicode');
  });

  await test('Nested JSON in error', async () => {
    const r = await fetch('/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: 'err', data: { nested: { deep: true } } })
    });
    assert(r.status === 200, 'Should handle nested JSON');
  });

  await test('Snapshot with huge HTML', async () => {
    const html = '<div>'.repeat(10000) + '</div>'.repeat(10000);
    const r = await fetch('/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, error: 'test' })
    });
    assert(r.status === 200, 'Should handle huge HTML');
  });

  await test('Snapshot with malformed HTML', async () => {
    const r = await fetch('/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<div><span>', error: 'unclosed' })
    });
    assert(r.status === 200, 'Should accept malformed HTML');
  });

  await test('GET non-existent snapshot', async () => {
    const r = await fetch('/snapshots/nonexistent.html');
    assert(r.status === 404, 'Should return 404');
  });

  await test('Path traversal attempt', async () => {
    const r = await fetch('/snapshots/../../../etc/passwd');
    assert(r.status === 404, 'Should block path traversal');
  });

  await test('Multiple rapid requests', async () => {
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(fetch('/status'));
    }
    const results = await Promise.all(promises);
    assert(results.every(r => r.status === 200), 'Should handle rapid requests');
  });

  await test('Concurrent error posts', async () => {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(fetch('/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'concurrent', message: `msg${i}` })
      }));
    }
    const results = await Promise.all(promises);
    assert(results.every(r => r.status === 200), 'Should handle concurrent posts');
  });

  await test('Invalid content-type', async () => {
    const r = await fetch('/error', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json'
    });
    assert(r.status === 400, 'Should reject non-JSON');
  });

  await test('Method not allowed', async () => {
    const r = await fetch('/error', { method: 'PUT' });
    assert(r.status === 405, 'Should return 405');
  });

  await test('Snapshot request timeout simulation', async () => {
    const r = await fetch('/snapshot/pending');
    assert(r.status === 200, 'Should return pending status');
    const data = JSON.parse(r.data);
    assert(data.pending === false, 'Should not be pending');
  });

  // Cleanup
  serverProc.kill();
  if (fs.existsSync('attack_test.log')) fs.unlinkSync('attack_test.log');
  if (fs.existsSync('./attack_snapshots')) {
    fs.readdirSync('./attack_snapshots').forEach(f => fs.unlinkSync(`./attack_snapshots/${f}`));
    fs.rmdirSync('./attack_snapshots');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal:', e);
  if (serverProc) serverProc.kill();
  process.exit(1);
});
