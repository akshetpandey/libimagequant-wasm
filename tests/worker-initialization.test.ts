import { test, expect } from 'vitest';

test('concurrent first requests share one WASM initialization', async () => {
  const workerUrl = new URL('/worker.mjs', location.href).href;
  const source = `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
      self.postMessage({ type: 'wasm-fetch' });
      return originalFetch(...args);
    };
    await import(${JSON.stringify(workerUrl)});
  `;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module' });
  try {
    const fetches = await new Promise<number>((resolve, reject) => {
      let count = 0;
      let completed = 0;
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = ({ data }) => {
        if (data.type === 'wasm-fetch') count++;
        if (data.type === 'ready') {
          for (let id = 1; id <= 5; id++) worker.postMessage({
            id, action: 'quantize_imagedata',
            data: { imageData: [255, 0, 0, 255], width: 1, height: 1 },
          });
        }
        if (data.id) {
          if (!data.success) reject(new Error(data.error));
          if (++completed === 5) resolve(count);
        }
      };
    });
    expect(fetches).toBe(1);
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});
