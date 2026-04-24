const http = require('http');
const fs = require('fs');

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

// 5x5 の赤いドット画像（これを動かして「探索」を表現する）
const baseDot = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

async function run() {
  console.log('--- 迷路探索 & 録画シミュレーション開始 ---');
  
  console.log('1. 録画開始...');
  await request('/record/start', 'POST');

  console.log('2. 探索フレーム送信中 (15フレーム)...');
  for (let i = 0; i < 15; i++) {
    // 実際にはここでCanvasをキャプチャしますが、シミュレーションとしてダミーを送信
    await request('/frame', 'POST', { image: `data:image/png;base64,${baseDot}` });
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('\n3. 録画停止 & エンコード要求...');
  const res = await request('/record/stop', 'POST');
  const result = JSON.parse(res.data);
  
  if (result.ok) {
    console.log('✅ 成功！');
    console.log(`ファイル名: ${result.file}`);
    console.log(`保存先: snapshots/${result.file}`);
  } else {
    console.log('❌ 失敗:', result.error);
  }
}

run().catch(console.error);
