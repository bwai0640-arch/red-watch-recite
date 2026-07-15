const port = Number(process.argv[2]);
if (!port) throw new Error('Usage: node media-runtime-test.mjs <remote-debugging-port>');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findMainTarget() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const target = (await response.json()).find((item) => item.url === 'rwt://renderer/index.html');
      if (target) return target;
    } catch {}
    await wait(250);
  }
  throw new Error('Main renderer target not found');
}

const target = await findMainTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const completed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Media runtime test timed out')), 300_000);
  socket.addEventListener('open', () => {
    const expression = `
      (async () => {
        const catalog = await fetch('rwt://renderer/media/catalog.json').then((response) => response.json());
        const results = [];
        const endpoints = new Map();
        const probe = new OffscreenCanvas(160, 90);
        const probeContext = probe.getContext('2d', { willReadFrequently: true });
        const sampleFrame = (bitmap, manifest, sheet, localFrame) => {
          const sourceX = (localFrame % sheet.cols) * manifest.width;
          const sourceY = Math.floor(localFrame / sheet.cols) * manifest.height;
          probeContext.drawImage(bitmap, sourceX, sourceY, manifest.width, manifest.height, 0, 0, probe.width, probe.height);
          return new Uint8ClampedArray(probeContext.getImageData(0, 0, probe.width, probe.height).data);
        };
        const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        const keyBytes = (hex) => {
          const bytes = new Uint8Array(hex.length / 2);
          for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
          return bytes;
        };
        for (const clip of catalog) {
          const base = 'rwt://renderer/media/' + clip.id;
          const manifestResponse = await fetch(base + '/manifest.json');
          if (!manifestResponse.ok) throw new Error(clip.id + ': manifest ' + manifestResponse.status);
          const manifest = await manifestResponse.json();
          let decodedSheets = 0;
          let firstFrame = null;
          let lastFrame = null;
          const startFrameIndex = Math.min(
            manifest.frameCount - 1,
            Math.floor(Math.min(0.1, manifest.duration / 3) * manifest.frameRate),
          );
          const endFrameIndex = Math.min(
            manifest.frameCount - 1,
            Math.floor(Math.max(0, manifest.duration - 0.03) * manifest.frameRate),
          );
          let frameCursor = 0;
          for (let sheetIndex = 0; sheetIndex < manifest.sheets.length; sheetIndex += 1) {
            const sheet = manifest.sheets[sheetIndex];
            const response = await fetch(base + '/' + sheet.file);
            if (!response.ok) throw new Error(clip.id + ': sheet ' + sheet.file + ' ' + response.status);
            const bitmap = await createImageBitmap(await response.blob());
            if (bitmap.width < manifest.width || bitmap.height < manifest.height) throw new Error(clip.id + ': invalid bitmap ' + sheet.file);
            if (startFrameIndex >= frameCursor && startFrameIndex < frameCursor + sheet.count) {
              firstFrame = sampleFrame(bitmap, manifest, sheet, startFrameIndex - frameCursor);
            }
            if (endFrameIndex >= frameCursor && endFrameIndex < frameCursor + sheet.count) {
              lastFrame = sampleFrame(bitmap, manifest, sheet, endFrameIndex - frameCursor);
            }
            bitmap.close();
            decodedSheets += 1;
            frameCursor += sheet.count;
          }
          const encryptedResponse = await fetch(base + '/audio.rwa');
          if (!encryptedResponse.ok) throw new Error(clip.id + ': audio ' + encryptedResponse.status);
          const encrypted = new Uint8Array(await encryptedResponse.arrayBuffer());
          const key = keyBytes(manifest.audio.keyHex);
          const decrypted = new Uint8Array(encrypted.length);
          for (let index = 0; index < encrypted.length; index += 1) {
            decrypted[index] = encrypted[index] ^ key[index % key.length] ^ ((31 * index) & 255);
          }
          const audioHash = toHex(await crypto.subtle.digest('SHA-256', decrypted));
          if (audioHash !== manifest.audio.sha256) throw new Error(clip.id + ': audio checksum mismatch');
          endpoints.set(clip.id, { first: firstFrame, last: lastFrame });
          results.push({ id: clip.id, frames: manifest.frameCount, sheets: decodedSheets, audio: 'SHA256_OK' });
        }
        const entries = ['E1_enter_walk', 'E2_enter_sneak', 'E3_enter_rush', 'E4_enter_prowl'];
        const normal = ['R2_react_doubt', 'R_note_logbook', 'R_nod', 'R_close_check'];
        const salute = ['R_pass_react_salute'];
        const nonfatalViolations = ['R1_react_yell', 'R_aim_react_gun'];
        const fatalViolations = ['R_aim_shoot', 'R_whip_react_lash'];
        const exits = ['X1_exit', 'X3_exit_backaway', 'X4_exit_sideglance'];
        const independent = ['L_lean', 'P_pass_corridor_red', 'P_pass_corridor_blue'];
        const reactions = [...normal, ...salute, ...nonfatalViolations, ...fatalViolations];
        const nonfatalReactions = [...normal, ...salute, ...nonfatalViolations];
        const allowedPairs = [
          ['E1_enter_walk', 'S1_intro_speech'],
          ['S1_intro_speech', 'X1_exit'],
          ...entries.flatMap((entry) => reactions.map((reaction) => [entry, reaction])),
          ...nonfatalReactions.flatMap((reaction) => exits.map((exit) => [reaction, exit])),
          ...exits.flatMap((exit) => entries.map((entry) => [exit, entry]))
        ];
        const meanAbsoluteDifference = (left, right) => {
          let total = 0;
          let channels = 0;
          for (let index = 0; index < left.length; index += 4) {
            total += Math.abs(left[index] - right[index]);
            total += Math.abs(left[index + 1] - right[index + 1]);
            total += Math.abs(left[index + 2] - right[index + 2]);
            channels += 3;
          }
          return total / channels;
        };
        const continuity = allowedPairs.map(([from, to]) => ({
          from,
          to,
          mad: meanAbsoluteDifference(endpoints.get(from).last, endpoints.get(to).first)
        }));
        const worst = continuity.reduce((current, item) => item.mad > current.mad ? item : current, continuity[0]);
        if (worst.mad > 3) throw new Error('Incompatible timeline seam: ' + JSON.stringify(worst));
        const independentReturn = independent.map((id) => ({
          id,
          mad: meanAbsoluteDifference(endpoints.get(id).first, endpoints.get(id).last)
        }));
        const worstIndependentReturn = independentReturn.reduce((current, item) => item.mad > current.mad ? item : current, independentReturn[0]);
        if (worstIndependentReturn.mad > 3) throw new Error('Independent event does not return to its own base: ' + JSON.stringify(worstIndependentReturn));
        return {
          clips: results.length,
          frames: results.reduce((sum, item) => sum + item.frames, 0),
          sheets: results.reduce((sum, item) => sum + item.sheets, 0),
          allAudioVerified: results.every((item) => item.audio === 'SHA256_OK'),
          ids: results.map((item) => item.id),
          continuityPairs: continuity.length,
          continuityMaxMad: worst.mad,
          continuityWorstPair: worst.from + ' -> ' + worst.to,
          independentReturn,
          independentReturnMaxMad: worstIndependentReturn.mad,
          runtimeExitPool: exits,
          x6Scheduled: exits.includes('X6_exit_abrupt')
        };
      })()
    `;
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    if (message.result?.exceptionDetails) {
      reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
    } else {
      resolve(message.result.result.value);
    }
  });
  socket.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')));
});

try {
  const report = await completed;
  if (report.clips !== 22 || report.frames !== 3092 || report.sheets !== 222 || !report.allAudioVerified || report.continuityPairs !== 71 || report.continuityMaxMad > 3 || report.independentReturnMaxMad > 3 || report.x6Scheduled) {
    throw new Error(`Unexpected media totals: ${JSON.stringify(report)}`);
  }
  console.log(JSON.stringify(report));
} finally {
  socket.close();
}
