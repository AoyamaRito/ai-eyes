const http = require('http');

const API = 'http://localhost:3000';

async function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const options = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };
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

// AIが移動を指示し、その後の結果（スナップショット）を確認する
async function step(dx, dy, stepNum) {
  console.log(`\n[AI Step ${stepNum}] Moving: dx=${dx}, dy=${dy}`);
  
  // 1. 移動指示をキューに入れる
  await request('/input', 'POST', {
    action: 'eval',
    code: `window.move(${dx}, ${dy})`
  });

  // 2. ブラウザが処理してスナップショットをアップロードするのを待つ
  // (/snapshot/request は新しいスナップショットが来るまでサーバー側でブロッキングされる)
  console.log(`[AI Step ${stepNum}] Waiting for snapshot...`);
  const res = await request(`/snapshot/request?label=step_${stepNum}`, 'POST');
  const snapData = JSON.parse(res.data);
  
  console.log(`[AI Step ${stepNum}] Snapshot saved: ${snapData.file}`);
  
  // 3. 本来ならここでスナップショットの中身(DOMなど)を解析して次の手を決める
  // 今回はデモなので固定の動きをする
}

async function runDebugSession() {
  console.log('=== Slow Motion Debug Session Start ===');
  
  // 録画も並行して行う
  await request('/record/start', 'POST');

  const moves = [
    [1, 0], [1, 0], [0, 1], [0, 1], // 右、右、下、下
    [1, 0], [1, 0], [0, 1], [0, 1], // 右、右、下、下
    [1, 0], [1, 0], [0, 1], [0, 1], // 右、右、下、下
    [1, 0], [1, 0], [0, 1], [0, 1]  // 右、右、下、下
  ];

  for (let i = 0; i < moves.length; i++) {
    await step(moves[i][0], moves[i][1], i + 1);
    // 意図的にゆっくり進める
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== Session Finished, Compiling Video... ===');
  const recordRes = await request('/record/stop', 'POST');
  console.log('Video Result:', recordRes.data);
}

runDebugSession().catch(console.error);
