'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isMainThread,
  parentPort,
} = require('node:worker_threads');

if (!isMainThread) {
  parentPort.on('message', (message) => {
    if (message?.method !== 'getInfo') return;
    parentPort.postMessage({
      id: message.id,
      ok: true,
      result: { ready: true, dimension: 3 },
    });
  });
} else {
  const { SpeakerService } = require('../speaker-service');
  const { AudioEventService } = require('../audio-event-service');

  async function main() {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rwt-worker-timeout-'));
    const modelPath = path.join(temporaryRoot, 'model.bin');
    const labelsPath = path.join(temporaryRoot, 'labels.csv');
    fs.writeFileSync(modelPath, 'model fixture');
    fs.writeFileSync(labelsPath, 'index,mid,display_name\n0,/m/test,Test\n');
    const profileCrypto = {
      isAvailable: async () => true,
      encryptString: async (value) => Buffer.from(value),
      decryptString: async (value) => Buffer.from(value).toString('utf8'),
    };
    const speaker = new SpeakerService({
      workerPath: __filename,
      modelPath,
      dataRoot: path.join(temporaryRoot, 'speaker-data'),
      profileCrypto,
    });
    const audioEvent = new AudioEventService({
      workerPath: __filename,
      modelPath,
      labelsPath,
    });

    try {
      const [speakerState, audioState] = await Promise.all([
        speaker.initialize(),
        audioEvent.initialize(),
      ]);
      assert.equal(speakerState.ready, true);
      assert.equal(audioState.ready, true);

      const enrollment = await speaker.beginEnrollment({ label: 'timeout fixture' });
      const startedAt = Date.now();
      const speakerRequest = speaker.addEnrollmentSample({
        enrollmentId: enrollment.enrollmentId,
        source: 'mic',
        sampleRate: 16_000,
        samples: Float32Array.from({ length: 16_000 }, (_, index) => (
          0.1 * Math.sin((2 * Math.PI * 220 * index) / 16_000)
        )),
      });
      const audioRequest = audioEvent.classify({
        sampleRate: 16_000,
        samples: new Float32Array(32_000),
      });

      await assert.rejects(speakerRequest, /超时/);
      assert.equal(speaker.getState().ready, false);
      assert.equal(speaker.getState().enrolling, false);
      await assert.rejects(audioRequest, /超时/);
      assert.equal(audioEvent.getState().ready, false);
      const elapsedMs = Date.now() - startedAt;
      assert.ok(elapsedMs >= 4_000 && elapsedMs < 8_000, `timeouts were not bounded (${elapsedMs} ms)`);

      process.stdout.write(JSON.stringify({
        speakerFailedClosed: true,
        audioEventFailedClosed: true,
        elapsedMs,
        uiStarted: false,
        microphoneRequested: false,
        realProfileRead: false,
      }));
      process.stdout.write('\n');
    } finally {
      await Promise.allSettled([speaker.dispose(), audioEvent.dispose()]);
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
