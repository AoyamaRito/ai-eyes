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

async function runDeterministicSimulation() {
  console.log('🎮 Deterministic nextFrame() Simulation Started');
  await request('/record/start', 'POST');

  let gameOver = false;
  let totalFrames = 100;

  for (let frame = 1; frame <= totalFrames; frame++) {
    if (gameOver) break;

    // AIの決定ロジック: 障害物が近づいてきたらジャンプする
    // 今回はデモなので固定フレームでジャンプさせるか、状態を見ないで適当にジャンプさせます。
    // ※今回は「外部からnextFrameを呼ぶとどうなるか」を見せるため、
    //  サーバー経由でブラウザの状態を都度取得するのは通信ラグがあるので
    //  とりあえず「1〜100フレームまで一方的にコマンドを送り続ける」スクリプトにします。
    
    let input = { jump: false };
    if (frame === 45) { 
      input.jump = true; 
      console.log(`[Frame ${frame}] AI sends JUMP command!`);
    }

    process.stdout.write('.');

    // コマンドをブラウザに送信 (window.nextFrame を叩く)
    // ※ここでは「状態を待ってから次」ではなく、一気に100フレーム分の指示をキューに積みます。
    // ブラウザ側がポーリングで拾って順次処理します。
    await request('/input', 'POST', {
      action: 'eval',
      code: `window.nextFrame('${JSON.stringify(input)}')`
    });

    // サーバーのキューをあふれさせないように少しだけ待つ
    await new Promise(r => setTimeout(r, 20));
  }

  console.log('\n✅ 100 frames of commands sent to browser.');
  console.log('Waiting 8 seconds for browser to process and upload frames...');
  await new Promise(r => setTimeout(r, 8000));

  console.log('📼 Compiling Video...');
  const recRes = await request('/record/stop', 'POST');
  console.log('Video Result:', JSON.parse(recRes.data));
}

runDeterministicSimulation().catch(console.error);