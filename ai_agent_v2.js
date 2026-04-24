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

// 迷路データ（slow_maze.htmlと同じもの）
const grid = [
  [1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,1,0,0,0,0,0,1],
  [1,1,1,0,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,0,0,1],
  [1,0,1,1,1,1,1,0,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,0,1,1,1,0,1],
  [1,0,0,0,1,0,0,0,1,0,1],
  [1,0,1,0,1,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,0,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1]
];

function solve(sx, sy, gx, gy) {
  console.log(`Searching path from (${sx},${sy}) to (${gx},${gy})...`);
  const queue = [{x: sx, y: sy, path: []}];
  const visited = new Set();
  visited.add(`${sx},${sy}`);
  
  while (queue.length > 0) {
    const {x, y, path} = queue.shift();
    if (x === gx && y === gy) return path;
    
    const dirs = [[0,1], [0,-1], [1,0], [-1,0]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
        if (grid[ny][nx] === 0 && !visited.has(`${nx},${ny}`)) {
          visited.add(`${nx},${ny}`);
          queue.push({x: nx, y: ny, path: [...path, {dx, dy}]});
        }
      }
    }
  }
  return null;
}

async function runAgent() {
  console.log('🚀 Upgraded AI Agent Started');
  await request('/record/start', 'POST');
  
  // 最初の一歩を誘発
  await request('/input', 'POST', { action: 'eval', code: 'window.move(0,0)' });

  for (let step = 1; step <= 50; step++) {
    const snapRes = await request(`/snapshot/request?label=upgraded_${step}`, 'POST');
    const snapJson = JSON.parse(snapRes.data);
    if (!snapJson.ok) continue;

    const html = fs.readFileSync(`./snapshots/${snapJson.file}`, 'utf8');
    const posMatch = html.match(/<span id="pos">(\d+),\s*(\d+)<\/span>/);
    if (!posMatch) continue;

    const cx = parseInt(posMatch[1]), cy = parseInt(posMatch[2]);
    console.log(`🧠 AI Position: (${cx}, ${cy})`);
    
    if (cx === 9 && cy === 9) {
      console.log('🏁 GOAL REACHED!');
      break;
    }

    const fullPath = solve(cx, cy, 9, 9);
    if (!fullPath || fullPath.length === 0) {
      console.log('❌ No path found!');
      break;
    }

    const nextMove = fullPath[0];
    console.log(`🕹️ Decided move: dx=${nextMove.dx}, dy=${nextMove.dy}`);
    
    await request('/input', 'POST', {
      action: 'eval',
      code: `window.move(${nextMove.dx}, ${nextMove.dy})`
    });
    
    await new Promise(r => setTimeout(r, 200));
  }

  const recRes = await request('/record/stop', 'POST');
  console.log('📼 Video compiled:', JSON.parse(recRes.data));
}

runAgent().catch(console.error);