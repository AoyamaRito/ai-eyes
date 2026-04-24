const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');

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

async function runPerfectSimulation() {
  console.log('🤖 Starting Perfect AI Autonomous Debugger...');
  await request('/log', 'DELETE');
  console.log('🌐 Opening browser and waiting for connection...');
  execSync('open "http://localhost:3000/slow_action.html"');

  let connected = false;
  for (let i = 0; i < 20; i++) {
    // ステップ命令を送ってみて、ブラウザが拾うか試す
    await request('/input', 'POST', { action: 'eval', code: 'window.stepFrame(false)' });
    await new Promise(r => setTimeout(r, 500));
    const logRes = await request('/log', 'GET');
    if (JSON.parse(logRes.data).length > 0) {
      connected = true;
      break;
    }
    process.stdout.write('⏳');
  }

  if (!connected) {
    console.log('\n❌ Browser connection failed.');
    return;
  }

  console.log('\n✅ Connected! Starting Step-by-Step AI Control...');
  await request('/record/start', 'POST');
  await request('/log', 'DELETE');

  let obstacleX = 400;
  let playerY = 250;
  let frame = 1;

  while (frame < 100) {
    let shouldJump = (obstacleX > 100 && obstacleX < 150 && playerY >= 250);
    if (shouldJump) console.log(`\n[Frame ${frame}] 🧠 AI JUMP! (Obstacle at ${obstacleX})`);

    await request('/input', 'POST', { action: 'eval', code: `window.stepFrame(${shouldJump})` });
    process.stdout.write(shouldJump ? 'J' : '.');

    let state = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 50));
      const logRes = await request('/log', 'GET');
      const logs = JSON.parse(logRes.data);
      const sync = logs.filter(l => l.type === 'sync').pop();
      if (sync) {
        state = JSON.parse(sync.message);
        await request('/log', 'DELETE');
        break;
      }
    }

    if (state) {
      obstacleX = state.obstacleX;
      playerY = state.playerY;
      if (state.status === 'game_over' || obstacleX < -20) break;
    } else {
      break;
    }
    frame++;
  }

  const recRes = await request('/record/stop', 'POST');
  const final = JSON.parse(recRes.data);
  console.log('\n📼 Video:', final);
  if (final.ok) execSync(`open "./snapshots/${final.file}"`);
}

runPerfectSimulation().catch(console.error);