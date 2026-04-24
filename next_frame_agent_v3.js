const http = require('http');

const API = 'http://localhost:3000';

async function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const options = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.status, data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runSnapshotSyncSimulation() {
  console.log('🎮 Snapshot-Synchronized nextFrame() Simulation Started');
  await request('/record/start', 'POST');

  for (let frame = 1; frame <= 60; frame++) { // 1秒分(60コマ)に短縮して確実に
    let input = { jump: (frame === 25) };
    
    // 1. コマンドを投入 (移動後に自動でスナップショットを送るように仕込む)
    await request('/input', 'POST', {
      action: 'eval',
      code: `window.nextFrame('${JSON.stringify(input)}').then(() => fetch('http://localhost:3000/snapshot', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({html:'frame_${frame}_done', label:'f_${frame}'})}))`
    });

    process.stdout.write(input.jump ? 'J' : '.');

    // 2. スナップショットが届くまでサーバー側で待機 (これが最強の同期)
    const snapRes = await request(`/snapshot/request?label=f_${frame}`, 'POST');
    const snapJson = JSON.parse(snapRes.data);
    
    if (!snapJson.ok) {
      console.log(`\n⚠️ Frame ${frame} timeout!`);
      break;
    }
  }

  console.log('\n✅ Frames processed via Snapshot Sync.');
  console.log('📼 Compiling Video...');
  const recRes = await request('/record/stop', 'POST');
  console.log('Video Result:', JSON.parse(recRes.data));
}

runSnapshotSyncSimulation().catch(console.error);