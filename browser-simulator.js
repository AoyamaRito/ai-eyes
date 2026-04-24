// ブラウザの挙動を模倣するシミュレーター
const http = require('http');
const SERVER = 'http://localhost:3000';

console.log('Browser Simulator started (Polling every 1s)...');

setInterval(() => {
  http.get(SERVER + '/input/pending', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const json = JSON.parse(data);
      if (json.hasCommand) {
        const cmd = json.command;
        console.log('[Simulator] Executing command:', cmd.action);
        
        // 実行結果をサーバーのログに報告（eval の代わり）
        const report = {
          type: 'simulator-exec',
          message: `Executed ${cmd.action} on ${cmd.target || 'N/A'}`
        };
        const req = http.request(SERVER + '/error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        req.write(JSON.stringify(report));
        req.end();
      }
    });
  });
}, 1000);
