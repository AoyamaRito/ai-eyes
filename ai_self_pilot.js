const http = require('http');
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

async function runAutonomousDebug() {
  console.log('🤖 Starting Autonomous Slow-Mo Debugger...');
  
  // 1. 録画とログのリセット
  await request('/record/start', 'POST');
  await request('/log', 'DELETE');

  let frame = 0;
  let isJumping = false;

  while (frame < 150) { // 最大150フレーム分回す
    // 2. ブラウザに「今の状態で1コマ進め」と命令を送る
    // ジャンプの判断: 障害物がプレイヤー(50)の少し手前(150〜180付近)に来たらジャンプ
    let jumpDecision = false;
    
    // 前回の状態をログから取得して判断
    const logRes = await request('/log', 'GET');
    const logs = JSON.parse(logRes.data);
    const lastSync = logs.filter(l => l.type === 'sync').pop();
    
    if (lastSync) {
      const state = JSON.parse(lastSync.message);
      const distance = state.obstacleX - state.playerY; // 簡易的な距離判定
      // 障害物が近づいたらジャンプ
      if (state.obstacleX > 50 && state.obstacleX < 180 && state.playerY >= 250) {
        jumpDecision = true;
        console.log(`\n[Frame ${frame}] 🧠 AI Decision: Obstacle at ${state.obstacleX}. JUMPING!`);
      }
    }

    // 3. 実行
    await request('/input', 'POST', {
      action: 'eval',
      code: `window.stepFrame(${jumpDecision})`
    });

    process.stdout.write(jumpDecision ? 'J' : '.');

    // 4. ブラウザが処理を終えて状態を報告するまで待つ
    let result = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 50));
      const lRes = await request('/log', 'GET');
      const lJson = JSON.parse(lRes.data);
      const sync = lJson.filter(l => l.type === 'sync').pop();
      if (sync) {
        result = JSON.parse(sync.message);
        break;
      }
    }

    if (result && result.status === 'game_over') {
      console.log('\n💥 Collision detected! Debugging failure...');
      break;
    }
    
    if (result && result.obstacleX < -20) {
      console.log('\n🚩 Obstacle cleared! Success.');
      break;
    }

    frame++;
    await new Promise(r => setTimeout(r, 100)); // デバッグのためにゆっくり回す
  }

  const recRes = await request('/record/stop', 'POST');
  console.log('📼 Video compiled:', JSON.parse(recRes.data));
}

runAutonomousDebug().catch(console.error);