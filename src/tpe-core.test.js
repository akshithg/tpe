import assert from 'node:assert/strict';
import test from 'node:test';
import { compareBlockSums, transformImage, transformPair } from './tpe-core.js';

test('pair substitution is reversible and preserves the integer sum', () => {
  for (const [first, second, randomWord] of [[0, 0, 0], [12, 81, 0xffff_ffff], [255, 255, 0x1234_5678], [240, 32, 0xdead_beef]]) {
    const encrypted = transformPair(first, second, randomWord);
    const decrypted = transformPair(encrypted[0], encrypted[1], randomWord, true);
    assert.equal(encrypted[0] + encrypted[1], first + second);
    assert.deepEqual(decrypted, [first, second]);
  }
});

test('image encryption preserves block sums and decrypts losslessly', async () => {
  const width = 13;
  const height = 11;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < source.length; index += 4) {
    source[index] = (index * 17) % 256;
    source[index + 1] = (index * 31) % 256;
    source[index + 2] = (index * 47) % 256;
    source[index + 3] = 255;
  }
  const options = { width, height, blockSize: 4, rounds: 3, secret: 'test-secret', nonce: '00112233445566778899aabbccddeeff' };
  const encrypted = await transformImage({ ...options, pixels: source, mode: 'encrypt' });
  assert.equal(compareBlockSums(source, encrypted, width, height, options.blockSize), 0);
  assert.notDeepEqual(encrypted, source);
  const decrypted = await transformImage({ ...options, pixels: encrypted, mode: 'decrypt' });
  assert.deepEqual(decrypted, source);
});

test('a different key does not recover the plaintext', async () => {
  const pixels = new Uint8ClampedArray([10,20,30,255,40,50,60,255,70,80,90,255,100,110,120,255]);
  const options = { width: 4, height: 1, blockSize: 4, rounds: 2, nonce: 'ffeeddccbbaa99887766554433221100' };
  const encrypted = await transformImage({ ...options, pixels, secret: 'right-key', mode: 'encrypt' });
  const wrong = await transformImage({ ...options, pixels: encrypted, secret: 'wrong-key', mode: 'decrypt' });
  assert.notDeepEqual(wrong, pixels);
});

test('encryption transforms alpha while preserving its block sum and reversibility', async () => {
  const width = 4;
  const height = 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 80;
    pixels[index + 1] = 120;
    pixels[index + 2] = 160;
    pixels[index + 3] = (index / 4) * 13;
  }
  const options = { width, height, blockSize: 4, rounds: 3, secret: 'alpha-review', nonce: '00112233445566778899aabbccddeeff' };
  const encrypted = await transformImage({ ...options, pixels, mode: 'encrypt' });
  const alphaChanged = Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3] !== encrypted[index * 4 + 3]).some(Boolean);
  assert.equal(alphaChanged, true);
  assert.equal(compareBlockSums(pixels, encrypted, width, height, options.blockSize), 0);
  const decrypted = await transformImage({ ...options, pixels: encrypted, mode: 'decrypt' });
  assert.deepEqual(decrypted, pixels);
});
