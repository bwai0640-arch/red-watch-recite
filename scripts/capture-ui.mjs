import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.argv[2]);
const output = process.argv[3];
const mode = process.argv[4] || 'idle';
if (!port || !output) throw new Error('Usage: node capture-ui.mjs <port> <output.png>');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let target;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    target = targets.find((item) => item.url === 'rwt://renderer/index.html');
    if (target) break;
  } catch {}
  await wait(250);
}
if (!target) throw new Error('Main renderer target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  request.resolve(message.result);
});
function command(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await command('Page.enable');
for (let attempt = 0; attempt < 120; attempt += 1) {
  const result = await command('Runtime.evaluate', {
    expression: `document.querySelector('#study-scene-canvas')?.dataset.animationReady === 'true'`,
    returnByValue: true,
  });
  if (result.result.value) break;
  await wait(250);
}
if (mode === 'warning') {
  await command('Runtime.evaluate', {
    expression: `(async () => {
      showOverlay({ title: '本人连续 20 秒未出声', message: '第 1 次提醒', controls: false });
      const prepared = await prepareClip('R1_react_yell', false);
      await state.scenePlayer.playPrepared(prepared, { audio: false, loop: true });
      setSceneLabel('warning', prepared.clipId);
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  await wait(600);
}
const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.from(screenshot.data, 'base64'));
socket.close();
