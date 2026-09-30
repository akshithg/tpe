import { transformImage } from './tpe-core.js';

self.addEventListener('message', async (event) => {
  try {
    const startedAt = performance.now();
    const pixels = await transformImage({
      ...event.data,
      pixels: new Uint8ClampedArray(event.data.buffer),
      onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'complete', buffer: pixels.buffer, duration: performance.now() - startedAt }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The image operation failed.' });
  }
});
