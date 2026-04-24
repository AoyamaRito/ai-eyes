const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 定数
const WIDTH = 400;
const HEIGHT = 300;
const SNAPSHOT_DIR = './snapshots';
const TEMP_FRAMES = './temp_node_frames';

// 1. 環境準備
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR);
if (fs.existsSync(TEMP_FRAMES)) fs.rmSync(TEMP_FRAMES, { recursive: true });
fs.mkdirSync(TEMP_FRAMES);

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');

// 2. ゲームロジック (決定論的)
let state = {
  frame: 0,
  player: { x: 50, y: 250, vy: 0 },
  obstacles: [{ x: 400, w: 30, h: 40 }],
  gravity: 0.8,
  jumpPower: -12,
  groundY: 250,
  speed: 5,
  gameOver: false
};

function update(jump) {
  if (state.gameOver) return;

  if (jump && state.player.y >= state.groundY) state.player.vy = state.jumpPower;
  
  state.player.vy += state.gravity;
  state.player.y += state.player.vy;
  if (state.player.y > state.groundY) { state.player.y = state.groundY; state.player.vy = 0; }
  
  state.obstacles.forEach(ob => ob.x -= state.speed);

  // 当たり判定
  const p = { x: state.player.x, y: state.player.y, w: 20, h: 20 };
  state.obstacles.forEach(ob => {
    const o = { x: ob.x, y: state.groundY + 20 - ob.h, w: ob.w, h: ob.h };
    if (p.x < o.x + o.w && p.x + p.w > o.x && p.y < o.y + o.h && p.y + p.h > o.y) {
      state.gameOver = true;
    }
  });

  state.frame++;
}

function draw() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#444';
  ctx.fillRect(0, state.groundY + 20, WIDTH, HEIGHT - state.groundY);
  ctx.fillStyle = '#f00';
  state.obstacles.forEach(ob => ctx.fillRect(ob.x, state.groundY + 20 - ob.h, ob.w, ob.h));
  ctx.fillStyle = state.gameOver ? '#555' : '#0f0';
  ctx.fillRect(state.player.x, state.player.y, 20, 20);
  ctx.fillStyle = '#fff';
  ctx.font = '16px monospace';
  ctx.fillText(`Node Frame: ${state.frame}`, 10, 20);
}

async function runSimulation() {
  console.log('🚀 1. Starting Node.js Internal Canvas Simulation...');
  
  const totalFrames = 100;
  for (let i = 0; i < totalFrames; i++) {
    // AIの判断: 障害物が近づいたらジャンプ
    let shouldJump = (state.obstacles[0].x > 100 && state.obstacles[0].x < 150);
    
    update(shouldJump);
    draw();

    // フレーム保存
    const filename = `frame_${i.toString().padStart(5, '0')}.png`;
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(TEMP_FRAMES, filename), buffer);
    
    if (i % 20 === 0) console.log(`[Node] Processed ${i} frames...`);
  }

  console.log('📼 2. Compiling Video via FFmpeg...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const videoName = `node_sim_${timestamp}.mp4`;
  const videoPath = path.join(SNAPSHOT_DIR, videoName);
  
  try {
    execSync(`ffmpeg -y -framerate 30 -i "${TEMP_FRAMES}/frame_%05d.png" -c:v libx264 -pix_fmt yuv420p "${videoPath}"`);
    console.log(`\n🎉 SUCCESS! Video created: ${videoPath}`);
    
    // ブラウザで専用プレイヤーを開く (ai-dev-server 経由)
    const playerUrl = `http://localhost:3000/player.html?video=${videoName}`;
    console.log(`🌐 Opening player: ${playerUrl}`);
    execSync(`open "${playerUrl}"`);
  } catch (e) {
    console.error('❌ FFmpeg error:', e.message);
  } finally {
    fs.rmSync(TEMP_FRAMES, { recursive: true });
  }
}

runSimulation();