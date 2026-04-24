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

async function runFullyAutomated() {
  console.log('🤖 1. AI starts fully automated simulation...');

  // Macのコマンドを使って、強制的にブラウザでデモページを開く(リロードさせる)
  console.log('🌐 2. Opening browser automatically...');
  try {
    execSync('open "http://localhost:3000/batch_demo.html"');
  } catch (e) {
    console.log('⚠️ Failed to open browser. Please open http://localhost:3000/batch_demo.html manually.');
  }

  // ブラウザが立ち上がってポーリングを開始するまで少し待つ
  await new Promise(r => setTimeout(r, 2000));

  console.log('🚀 3. Sending RUN command to the browser...');
  // ブラウザ側の runBatch() をキックする
  await request('/input', 'POST', {
    action: 'eval',
    code: 'runBatch()'
  });

  console.log('⏳ 4. Waiting for the simulation to finish (checking snapshots dir)...');
  
  // 動画ファイルが生成されるのをポーリングで待つ
  const initialFiles = fs.readdirSync('./snapshots').filter(f => f.endsWith('.mp4'));
  
  for (let i = 0; i < 30; i++) { // 最大15秒待機
    await new Promise(r => setTimeout(r, 500));
    const currentFiles = fs.readdirSync('./snapshots').filter(f => f.endsWith('.mp4'));
    
    // 新しいMP4ファイルが増えていれば成功
    if (currentFiles.length > initialFiles.length) {
      const newFile = currentFiles.filter(x => !initialFiles.includes(x))[0];
      console.log(`\n🎉 SUCCESS! Video generated: snapshots/${newFile}`);
      
      // 完成した動画を自動でMacの標準プレイヤーで開く（プレビュー表示）
      try {
        console.log('🎬 Opening video preview...');
        execSync(`open "./snapshots/${newFile}"`);
      } catch (e) { }
      return;
    }
    process.stdout.write('.');
  }

  console.log('\n❌ ERROR: Timeout. Video was not generated.');
}

runFullyAutomated().catch(console.error);