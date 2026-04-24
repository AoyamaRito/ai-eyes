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

async function runSynchronousSimulation() {
  console.log('🎮 Synchronous nextFrame() Simulation Started');
  
  // 1. 録画開始
  await request('/record/start', 'POST');

  for (let frame = 1; frame <= 100; frame++) {
    let input = { jump: (frame === 45) };
    
    // 2. コマンドを投入
    await request('/input', 'POST', {
      action: 'eval',
      code: `window.nextFrame('${JSON.stringify(input)}').then(() => fetch('http://localhost:3000/error', {method:'POST', body: JSON.stringify({type:'sync', message:'frame_${frame}_done'})}))`
    });

    // 3. サーバー側のログ（error.log）を見て、ブラウザが「処理完了」と報告するまで待つ
    // これにより、確実に1コマずつ処理を同期させます。
    let processed = false;
    process.stdout.write(input.jump ? 'J' : '.');
    
    for (let retry = 0; retry < 20; retry++) {
      await new Promise(r => setTimeout(r, 50));
      const logRes = await request('/log', 'GET');
      const logs = JSON.parse(logRes.data);
      if (logs.some(l => l.message === `frame_${frame}_done`)) {
        processed = true;
        break;
      }
    }
    
    if (!processed) {
      console.log(`\n⚠️ Frame ${frame} timeout - Browser might not be responding.`);
    }
  }

  console.log('\n✅ 100 frames processed synchronously.');
  console.log('📼 Compiling Video...');
  const recRes = await request('/record/stop', 'POST');
  console.log('Video Result:', JSON.parse(recRes.data));
}

runSynchronousSimulation().catch(console.error);