const port = Number(process.argv[2]);
if (!port) throw new Error('Usage: node cdp-smoke.mjs <remote-debugging-port>');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let target;
for (let attempt = 0; attempt < 180; attempt += 1) {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    target = list.find((item) => item.url === 'rwt://renderer/index.html');
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

const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Smoke test timed out')), 60_000);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message || 'CDP Runtime.evaluate failed'));
    else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
    else if (!message.result?.result) reject(new Error('CDP Runtime.evaluate returned no result'));
    else resolve(message.result.result.value);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline && document.querySelector('#study-scene-canvas')?.dataset.animationReady !== 'true') {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return {
          title: document.title,
          ready: document.querySelector('#study-scene-canvas')?.dataset.animationReady === 'true',
          idleClip: document.querySelector('#study-scene-canvas')?.dataset.clipId,
          idleFrame: document.querySelector('#study-scene-canvas')?.dataset.frameIndex,
          mediaCount: state.mediaCatalog.length,
          videoElements: document.querySelectorAll('video').length,
          runtime: await window.desktopAPI.getRuntimeWindowState()
        };
      })()`,
    },
  }));
});

socket.close();
if (!result.ready || result.idleClip !== 'E1_enter_walk' || result.idleFrame !== '0' || result.mediaCount !== 22 || result.videoElements !== 0 || result.runtime.windowCount !== 1) {
  throw new Error(`Unexpected smoke result: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
