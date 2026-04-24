const http = require('http');

const SERVER = 'http://localhost:3000';

function sendCommand(cmd) {
  return new Promise((resolve, reject) => {
    const req = http.request(SERVER + '/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(JSON.stringify(cmd));
    req.end();
  });
}

async function runExperiment() {
  console.log('--- AI Remote Control Experiment ---');
  
  console.log('1. Setting input values via Remote Control...');
  await sendCommand({ action: 'type', target: '#a', value: '12' });
  await sendCommand({ action: 'type', target: '#b', value: '30' });
  
  console.log('2. Clicking calculation button...');
  await sendCommand({ action: 'click', target: '#calc-btn' });
  
  console.log('3. Sending eval to verify and log back...');
  const verifyCode = `
    const res = document.getElementById('result').innerText;
    fetch('${SERVER}/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'experiment-result', message: 'Calculated value: ' + res })
    });
  `;
  await sendCommand({ action: 'eval', code: verifyCode });

  console.log('Experiment commands sent. Check server logs for result.');
}

runExperiment().catch(console.error);
