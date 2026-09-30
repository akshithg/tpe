const CHANNELS = 4;
const UINT32_RANGE = 0x1_0000_0000;
const encoder = new TextEncoder();

function assertInteger(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{32}$/iu.test(hex)) {
    throw new TypeError('nonce must be a 16-byte hexadecimal string.');
  }
  return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function boundedRandom(word, bound) {
  return Math.floor((word * bound) / UINT32_RANGE);
}

export function transformPair(first, second, randomWord, decrypt = false) {
  assertInteger('first pixel', first, 0, 255);
  assertInteger('second pixel', second, 0, 255);
  const sum = first + second;
  const lower = Math.max(0, sum - 255);
  const upper = Math.min(255, sum);
  const domainSize = upper - lower + 1;
  const shift = boundedRandom(randomWord >>> 0, domainSize);
  const rank = first - lower;
  const transformedRank = decrypt
    ? (rank - shift + domainSize) % domainSize
    : (rank + shift) % domainSize;
  const transformedFirst = lower + transformedRank;
  return [transformedFirst, sum - transformedFirst];
}

function createBlocks(width, height, blockSize) {
  const blocks = [];
  let substitutionWords = 0;
  let permutationWords = 0;
  for (let blockY = 0; blockY < height; blockY += blockSize) {
    const blockHeight = Math.min(blockSize, height - blockY);
    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const blockWidth = Math.min(blockSize, width - blockX);
      const offsets = new Uint32Array(blockWidth * blockHeight);
      let cursor = 0;
      for (let y = 0; y < blockHeight; y += 1) {
        for (let x = 0; x < blockWidth; x += 1) {
          offsets[cursor] = ((blockY + y) * width + blockX + x) * 4;
          cursor += 1;
        }
      }
      blocks.push(offsets);
      substitutionWords += Math.floor(offsets.length / 2);
      permutationWords += Math.max(0, offsets.length - 1);
    }
  }
  return { blocks, substitutionWords, permutationWords };
}

async function deriveAesKey(secret, nonce) {
  if (secret.length < 1) throw new TypeError('secret key cannot be empty.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(nonce), iterations: 100_000 },
    material,
    { name: 'AES-CTR', length: 256 },
    false,
    ['encrypt'],
  );
}

async function createCounter(nonce, width, height, blockSize, round, channel, phase) {
  const label = `${nonce}|${width}x${height}|b${blockSize}|r${round}|c${channel}|${phase}`;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(label));
  return new Uint8Array(digest, 0, 16);
}

async function randomWords(key, count, counter) {
  if (count === 0) return new Uint32Array();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter, length: 128 },
    key,
    new Uint8Array(count * 4),
  );
  const view = new DataView(encrypted);
  const words = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) words[index] = view.getUint32(index * 4, false);
  return words;
}

function substituteBlocks(pixels, blocks, channel, words, decrypt) {
  let wordIndex = 0;
  for (const offsets of blocks) {
    for (let index = 0; index + 1 < offsets.length; index += 2) {
      const firstOffset = (offsets[index] ?? 0) + channel;
      const secondOffset = (offsets[index + 1] ?? 0) + channel;
      const [first, second] = transformPair(
        pixels[firstOffset] ?? 0,
        pixels[secondOffset] ?? 0,
        words[wordIndex] ?? 0,
        decrypt,
      );
      pixels[firstOffset] = first;
      pixels[secondOffset] = second;
      wordIndex += 1;
    }
  }
}

function createPermutation(length, words, wordOffset) {
  const permutation = Uint32Array.from({ length }, (_, index) => index);
  let cursor = wordOffset;
  for (let index = length - 1; index > 0; index -= 1) {
    const swapIndex = boundedRandom(words[cursor] ?? 0, index + 1);
    const held = permutation[index] ?? 0;
    permutation[index] = permutation[swapIndex] ?? 0;
    permutation[swapIndex] = held;
    cursor += 1;
  }
  return permutation;
}

function permuteBlocks(pixels, blocks, channel, words, decrypt) {
  let wordOffset = 0;
  for (const offsets of blocks) {
    const permutation = createPermutation(offsets.length, words, wordOffset);
    const values = new Uint8Array(offsets.length);
    for (let index = 0; index < offsets.length; index += 1) {
      values[index] = pixels[(offsets[index] ?? 0) + channel] ?? 0;
    }
    for (let index = 0; index < offsets.length; index += 1) {
      const sourceIndex = decrypt ? index : (permutation[index] ?? 0);
      const targetIndex = decrypt ? (permutation[index] ?? 0) : index;
      pixels[(offsets[targetIndex] ?? 0) + channel] = values[sourceIndex] ?? 0;
    }
    wordOffset += Math.max(0, offsets.length - 1);
  }
}

export async function transformImage({ pixels, width, height, blockSize, rounds, secret, nonce, mode, onProgress = () => {} }) {
  assertInteger('width', width, 1, 16_384);
  assertInteger('height', height, 1, 16_384);
  assertInteger('blockSize', blockSize, 2, 256);
  assertInteger('rounds', rounds, 1, 10_000);
  if (mode !== 'encrypt' && mode !== 'decrypt') throw new TypeError('mode must be encrypt or decrypt.');
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) {
    throw new TypeError('pixels must be an RGBA Uint8ClampedArray matching width and height.');
  }
  const output = pixels.slice();
  const key = await deriveAesKey(secret, nonce);
  const { blocks, substitutionWords, permutationWords } = createBlocks(width, height, blockSize);
  const decrypt = mode === 'decrypt';
  const orderedRounds = Array.from({ length: rounds }, (_, index) => decrypt ? rounds - index - 1 : index);
  const operations = rounds * CHANNELS * 2;
  let completed = 0;
  for (const round of orderedRounds) {
    const phases = decrypt ? ['permutation', 'substitution'] : ['substitution', 'permutation'];
    for (const phase of phases) {
      for (let channel = 0; channel < CHANNELS; channel += 1) {
        const count = phase === 'substitution' ? substitutionWords : permutationWords;
        const counter = await createCounter(nonce, width, height, blockSize, round, channel, phase);
        const words = await randomWords(key, count, counter);
        if (phase === 'substitution') substituteBlocks(output, blocks, channel, words, decrypt);
        else permuteBlocks(output, blocks, channel, words, decrypt);
        completed += 1;
        onProgress(completed / operations);
      }
    }
  }
  return output;
}

export function compareBlockSums(first, second, width, height, blockSize) {
  if (first.length !== second.length || first.length !== width * height * 4) {
    throw new TypeError('Both pixel buffers must match the supplied dimensions.');
  }
  const { blocks } = createBlocks(width, height, blockSize);
  let maximumDifference = 0;
  for (const offsets of blocks) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      let firstSum = 0;
      let secondSum = 0;
      for (const offset of offsets) {
        firstSum += first[offset + channel] ?? 0;
        secondSum += second[offset + channel] ?? 0;
      }
      maximumDifference = Math.max(maximumDifference, Math.abs(firstSum - secondSum));
    }
  }
  return maximumDifference;
}

export function blockAverageThumbnail(pixels, width, height, blockSize) {
  const thumbnailWidth = Math.ceil(width / blockSize);
  const thumbnailHeight = Math.ceil(height / blockSize);
  const thumbnail = new Uint8ClampedArray(thumbnailWidth * thumbnailHeight * 4);
  let destination = 0;
  for (let blockY = 0; blockY < height; blockY += blockSize) {
    const blockHeight = Math.min(blockSize, height - blockY);
    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const blockWidth = Math.min(blockSize, width - blockX);
      const count = blockWidth * blockHeight;
      const sums = [0, 0, 0, 0];
      for (let y = 0; y < blockHeight; y += 1) {
        for (let x = 0; x < blockWidth; x += 1) {
          const offset = ((blockY + y) * width + blockX + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += pixels[offset + channel] ?? 0;
        }
      }
      for (let channel = 0; channel < 4; channel += 1) {
        thumbnail[destination + channel] = Math.round((sums[channel] ?? 0) / count);
      }
      destination += 4;
    }
  }
  return { pixels: thumbnail, width: thumbnailWidth, height: thumbnailHeight };
}
