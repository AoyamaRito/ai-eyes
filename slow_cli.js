const http = require('http');
const readline = require('readline');

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function runInteractiveDebugger() {
  console.log('🎮 Slow-Mo Action CLI Debugger Started');
  console.log('Command reference:');
  console.log('  [Enter] : Step forward 1 frame');
  console.log('  j [Enter]: Jump and step forward 1 frame');
  console.log('  q [Enter]: Quit');
  console.log('-------------------------------------------');

  // エラーログをクリアして同期しやすくする
  await request('/log', 'DELETE');

  let frame = 1;
  while (true) {
    const answer = (await ask(`\nFrame ${frame} > `)).trim().toLowerCase();
    
    if (answer === 'q') break;
    
    const jump = (answer === 'j');
    
    // ブラウザに1フレーム進める命令を送る
    await request('/input', 'POST', {
      action: 'eval',
      code: `window.stepFrame(${jump})`
    });

    // ブラウザからの実行結果（状態）を待つ
    let resultJson = null;
    for (let i = 0; i < 20; i++) { // 最大1秒待つ
      await new Promise(r => setTimeout(r, 50));
      const logRes = await request('/log', 'GET');
      const logs = JSON.parse(logRes.data);
      const syncLogs = logs.filter(l => l.type === 'sync');
      
      if (syncLogs.length > 0) {
        try {
          resultJson = JSON.parse(syncLogs[syncLogs.length - 1].message);
          // 取得したらログをクリア
          await request('/log', 'DELETE');
          break;
        } catch (e) {}
      }
    }

    if (resultJson) {
      console.log(`  -> Player Y: ${resultJson.playerY}, Obstacle X: ${resultJson.obstacleX}`);
      if (resultJson.status === 'game_over') {
        console.log('💥 GAME OVER! Collision detected.');
        break;
      }
    } else {
      console.log('  -> (No response from browser. Is it open?)');
    }
    
    frame++;
  }

  rl.close();
  console.log('Debugger disconnected.');
}

runInteractiveDebugger().catch(console.error);