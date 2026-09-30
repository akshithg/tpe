import { blockAverageThumbnail, compareBlockSums } from './tpe-core.js';

const elements = {
  blockSize: document.querySelector('#block-size'),
  blockOutput: document.querySelector('#block-output'),
  blockTradeoff: document.querySelector('#block-tradeoff'),
  decrypt: document.querySelector('#decrypt-button'),
  encrypt: document.querySelector('#encrypt-button'),
  fileInput: document.querySelector('#image-input'),
  fileName: document.querySelector('#file-name'),
  heroCipher: document.querySelector('#hero-cipher-canvas'),
  heroCipherLabel: document.querySelector('#hero-cipher-label'),
  heroEncryptedCard: document.querySelector('#hero-encrypted-card'),
  heroSource: document.querySelector('#hero-source-canvas'),
  heroThumbnail: document.querySelector('#hero-thumbnail-canvas'),
  key: document.querySelector('#secret-key'),
  proofDetail: document.querySelector('#proof-detail'),
  proofPanel: document.querySelector('#thumbnail-proof'),
  proofStatus: document.querySelector('#proof-status'),
  result: document.querySelector('#result-canvas'),
  resultCaption: document.querySelector('#result-caption'),
  resultThumbnail: document.querySelector('#result-thumbnail'),
  rounds: document.querySelector('#rounds'),
  roundOutput: document.querySelector('#round-output'),
  source: document.querySelector('#source-canvas'),
  sourceThumbnail: document.querySelector('#source-thumbnail'),
  status: document.querySelector('#status'),
  statusRow: document.querySelector('.status-row'),
  timing: document.querySelector('#timing'),
};

let sourceImage;
let encryptedImage;
let encryptedSettings;
let running = false;

async function drawSample() {
  const width = 720;
  const height = 540;
  elements.source.width = width;
  elements.source.height = height;
  const context = elements.source.getContext('2d', { willReadFrequently: true });
  const artwork = new Image();
  artwork.src = new URL('../assets/witches-of-chaosah-family.jpg', import.meta.url).href;
  await artwork.decode();
  const sourceHeight = artwork.naturalWidth * 0.75;
  const sourceY = (artwork.naturalHeight - sourceHeight) / 2;
  context.drawImage(
    artwork,
    0,
    sourceY,
    artwork.naturalWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
  sourceImage = context.getImageData(0, 0, width, height);
  drawImageData(elements.result, sourceImage);
  elements.resultCaption.textContent = 'Waiting to encrypt';
  refreshThumbnails(sourceImage, sourceImage);
  clearHeroCipher();
}

function drawImageData(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

function drawThumbnail(canvas, imageData, blockSize) {
  const thumbnail = blockAverageThumbnail(imageData.data, imageData.width, imageData.height, blockSize);
  canvas.width = thumbnail.width;
  canvas.height = thumbnail.height;
  canvas.getContext('2d').putImageData(new ImageData(thumbnail.pixels, thumbnail.width, thumbnail.height), 0, 0);
}

function refreshThumbnails(first, second) {
  const blockSize = Number(elements.blockSize.value);
  drawImageData(elements.heroSource, first);
  drawThumbnail(elements.heroThumbnail, first, blockSize);
  drawThumbnail(elements.sourceThumbnail, first, blockSize);
  drawThumbnail(elements.resultThumbnail, second, blockSize);
}

function clearHeroCipher() {
  if (!sourceImage) return;
  elements.heroCipher.width = sourceImage.width;
  elements.heroCipher.height = sourceImage.height;
  const context = elements.heroCipher.getContext('2d');
  context.fillStyle = '#20252f';
  context.fillRect(0, 0, sourceImage.width, sourceImage.height);
  elements.heroEncryptedCard.classList.add('is-pending');
  elements.heroCipherLabel.textContent = 'Preparing ciphertext…';
}

function setProofState(state) {
  elements.proofPanel.classList.remove('is-pending', 'is-verified', 'is-roundtrip');
  if (state === 'verified') {
    requestAnimationFrame(() => elements.proofPanel.classList.add('is-verified'));
  } else {
    elements.proofPanel.classList.add(state === 'roundtrip' ? 'is-roundtrip' : 'is-pending');
  }
}

function settings() {
  return { blockSize: Number(elements.blockSize.value), rounds: Number(elements.rounds.value), secret: elements.key.value };
}

function createNonce() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function setBusy(busy, message) {
  running = busy;
  elements.statusRow.classList.toggle('busy', busy);
  elements.status.textContent = message;
  elements.encrypt.disabled = busy;
  elements.decrypt.disabled = busy || !encryptedImage;
}

function runWorker(mode, input, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tpe.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      if (event.data.type === 'progress') {
        elements.status.textContent = `${mode === 'encrypt' ? 'Encrypting' : 'Decrypting'} · ${Math.round(event.data.progress * 100)}%`;
      } else if (event.data.type === 'complete') {
        worker.terminate();
        resolve({ image: new ImageData(new Uint8ClampedArray(event.data.buffer), input.width, input.height), duration: event.data.duration });
      } else if (event.data.type === 'error') {
        worker.terminate();
        reject(new Error(event.data.message));
      }
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The background worker failed.'));
    });
    const buffer = input.data.slice().buffer;
    worker.postMessage({ ...options, mode, width: input.width, height: input.height, buffer }, [buffer]);
  });
}

async function encrypt() {
  if (running || !sourceImage) return;
  const options = { ...settings(), nonce: createNonce() };
  if (!options.secret) {
    elements.status.textContent = 'Enter a secret key first.';
    elements.key.focus();
    return;
  }
  setBusy(true, 'Preparing encryption…');
  elements.timing.textContent = '';
  try {
    const { image, duration } = await runWorker('encrypt', sourceImage, options);
    const currentSettings = settings();
    if (currentSettings.blockSize !== options.blockSize || currentSettings.rounds !== options.rounds || currentSettings.secret !== options.secret) {
      setBusy(false, 'Settings changed · restarting encryption');
      encrypt();
      return;
    }
    encryptedImage = image;
    encryptedSettings = options;
    drawImageData(elements.result, image);
    drawImageData(elements.heroCipher, image);
    elements.heroEncryptedCard.classList.remove('is-pending');
    elements.heroCipherLabel.textContent = 'Actual encrypted pixels';
    refreshThumbnails(sourceImage, image);
    const difference = compareBlockSums(sourceImage.data, image.data, image.width, image.height, options.blockSize);
    elements.resultCaption.textContent = 'Encrypted image';
    elements.proofStatus.textContent = difference === 0 ? 'Exact match verified' : 'Invariant failed';
    elements.proofDetail.textContent = `Maximum RGBA block-sum difference: ${difference}.`;
    setProofState(difference === 0 ? 'verified' : 'pending');
    elements.timing.textContent = `${(duration / 1000).toFixed(2)} s`;
    setBusy(false, 'Encryption complete');
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function decrypt() {
  if (running || !encryptedImage || !encryptedSettings) return;
  setBusy(true, 'Preparing decryption…');
  elements.timing.textContent = '';
  try {
    const options = { ...encryptedSettings, secret: elements.key.value };
    const { image, duration } = await runWorker('decrypt', encryptedImage, options);
    drawImageData(elements.result, image);
    refreshThumbnails(sourceImage, image);
    let changedBytes = 0;
    for (let index = 0; index < image.data.length; index += 1) if (image.data[index] !== sourceImage.data[index]) changedBytes += 1;
    elements.resultCaption.textContent = 'Decrypted image';
    elements.proofStatus.textContent = changedBytes === 0 ? 'Lossless round trip verified' : 'Key does not match';
    elements.proofDetail.textContent = changedBytes === 0 ? 'Every RGBA byte matches the original.' : `${changedBytes.toLocaleString()} bytes differ from the original.`;
    elements.timing.textContent = `${(duration / 1000).toFixed(2)} s`;
    setProofState(changedBytes === 0 ? 'roundtrip' : 'verified');
    setBusy(false, 'Decryption complete');
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function loadImage(file) {
  const bitmap = await createImageBitmap(file);
  const maximumDimension = 1024;
  const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  sourceImage = context.getImageData(0, 0, width, height);
  encryptedImage = undefined;
  encryptedSettings = undefined;
  drawImageData(elements.source, sourceImage);
  drawImageData(elements.result, sourceImage);
  refreshThumbnails(sourceImage, sourceImage);
  clearHeroCipher();
  elements.fileName.textContent = file.name;
  elements.resultCaption.textContent = 'Waiting to encrypt';
  elements.proofStatus.textContent = 'Ready to verify';
  elements.proofDetail.textContent = scale < 1 ? `Resized locally to ${width} × ${height} for the interactive demo.` : `${width} × ${height} pixels loaded locally.`;
  setProofState('pending');
  setBusy(false, 'Image ready');
}

function invalidateSettings() {
  updateBlockExperience();
  elements.roundOutput.textContent = elements.rounds.value;
  if (sourceImage) {
    refreshThumbnails(sourceImage, sourceImage);
    clearHeroCipher();
  }
  if (encryptedImage) {
    encryptedImage = undefined;
    encryptedSettings = undefined;
    elements.decrypt.disabled = true;
    elements.status.textContent = 'Settings changed · encrypt again';
    elements.proofStatus.textContent = 'Ready to verify';
    elements.proofDetail.textContent = 'Encryption parameters define the preserved thumbnail.';
    setProofState('pending');
  }
}

function updateBlockExperience() {
  const blockSize = Number(elements.blockSize.value);
  elements.blockOutput.textContent = `${blockSize} × ${blockSize} px`;
  if (!sourceImage) return;
  const previewWidth = Math.ceil(sourceImage.width / blockSize);
  const previewHeight = Math.ceil(sourceImage.height / blockSize);
  const description = blockSize <= 8
    ? 'High recognition · more of the image remains visible'
    : blockSize <= 20
      ? 'Balanced preview · faces remain easy to find'
      : 'Coarse preview · less visual detail remains';
  elements.blockTradeoff.textContent = `${description} · ${previewWidth} × ${previewHeight} preview`;
}

elements.encrypt.addEventListener('click', encrypt);
elements.decrypt.addEventListener('click', decrypt);
elements.fileInput.addEventListener('change', async () => {
  const [file] = elements.fileInput.files;
  if (!file) return;
  setBusy(true, 'Decoding image…');
  try { await loadImage(file); }
  catch (error) { setBusy(false, error instanceof Error ? error.message : 'Could not decode that image.'); }
});
elements.blockSize.addEventListener('input', invalidateSettings);
elements.blockSize.addEventListener('change', () => {
  if (sourceImage && elements.key.value && !running) encrypt();
});
elements.rounds.addEventListener('input', invalidateSettings);

drawSample()
  .then(() => {
    updateBlockExperience();
    window.setTimeout(encrypt, 250);
  })
  .catch((error) => setBusy(false, `Could not load the ensemble sample: ${error.message}`));
