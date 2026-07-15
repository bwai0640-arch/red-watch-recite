const path = require('node:path');
const sherpa = require('sherpa-onnx-node');

const root = path.resolve(__dirname, '..');
const model = path.join(root, 'models', '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx');
const fixtures = path.join(root, 'work', 'speaker-fixtures');

const extractor = new sherpa.SpeakerEmbeddingExtractor({
  model,
  numThreads: 2,
  debug: false,
});

function embedding(file) {
  const wave = sherpa.readWave(path.join(fixtures, file), false);
  const stream = extractor.createStream();
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
  if (!extractor.isReady(stream)) throw new Error(`Audio is too short: ${file}`);
  return extractor.compute(stream, false);
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

const files = [
  'fangjun-sr-1.wav',
  'fangjun-sr-2.wav',
  'fangjun-sr-3.wav',
  'fangjun-test-sr-1.wav',
  'leijun-sr-1.wav',
  'leijun-sr-2.wav',
  'leijun-test-sr-1.wav',
  'liudehua-sr-1.wav',
  'liudehua-test-sr-1.wav',
];
const vectors = new Map(files.map((file) => [file, embedding(file)]));

for (let row = 0; row < files.length; row += 1) {
  const scores = [];
  for (let column = 0; column < files.length; column += 1) {
    scores.push(cosine(vectors.get(files[row]), vectors.get(files[column])).toFixed(3));
  }
  console.log(files[row].padEnd(27), scores.join(' '));
}
console.log(`embedding-dim=${extractor.dim}`);
