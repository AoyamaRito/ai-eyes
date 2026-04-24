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

// 簡単な自律エージェント: 現在地を取得して右か下に進む
async function runAgent() {
  console.log('🤖 AI Agent Started');
  
  // 録画開始
  await request('/record/start', 'POST');
  
  let currentX = 1;
  let currentY = 1;
  const targetX = 9;
  const targetY = 9;

  for (let step = 1; step <= 20; step++) {
    // 1. スナップショットの要求 (ブラウザが開くまで待機する)
    console.log(`[Step ${step}] Waiting for browser to be opened and take snapshot...`);
    const snapRes = await request(`/snapshot/request?label=agent_${step}`, 'POST');
    const snapJson = JSON.parse(snapRes.data);
    
    if (!snapJson.ok) {
      console.log('⚠️ No response from browser. Retrying in 2 seconds...');
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    console.log(`📸 Snapshot received: ${snapJson.file}`);

    // 2. スナップショット（HTML）を読み取って現在地を解析
    const html = fs.readFileSync(`./snapshots/${snapJson.file}`, 'utf8');
    const posMatch = html.match(/<span id="pos">(\d+),\s*(\d+)<\/span>/);
    
    if (posMatch) {
      currentX = parseInt(posMatch[1]);
      currentY = parseInt(posMatch[2]);
      console.log(`🧠 AI sees position: (${currentX}, ${currentY})`);
      
      if (currentX === targetX && currentY === targetY) {
        console.log('🎉 GOAL REACHED!');
        break;
      }
      
      // 3. 次の行動を決定 (右に行けるなら右、無理なら下)
      // (実際のAIなら画像認識かDOM解析で壁の有無を判定しますが、今回は簡易的な座標ベース)
      let dx = 0, dy = 0;
      if (currentX < 4) { dx = 1; }
      else if (currentY < 4) { dy = 1; }
      else if (currentX < 9) { dx = 1; }
      else { dy = 1; }
      
      console.log(`🕹️ AI decided to move: (${dx}, ${dy})`);
      
      // 4. 命令を発行
      await request('/input', 'POST', {
        action: 'eval',
        code: `window.move(${dx}, ${dy})`
      });

    } else {
      console.log('❌ Failed to read position from snapshot.');
    }
  }

  // 録画停止
  const recRes = await request('/record/stop', 'POST');
  console.log('📼 Video compiled:', JSON.parse(recRes.data));
}

runAgent().catch(console.error);