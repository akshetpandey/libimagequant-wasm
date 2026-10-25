import LibImageQuant from 'libimagequant-wasm/node';
import { readFile, writeFile } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node examples/node.mjs INPUT.png OUTPUT.png');
  process.exitCode = 1;
} else {
  const quantizer = new LibImageQuant();
  try {
    const result = await quantizer.quantizePng(await readFile(input), { maxColors: 64 });
    await writeFile(output, result.pngBytes);
    console.log(`${result.width}x${result.height}, ${result.paletteLength} colors → ${output}`);
    if (result.animation) {
      console.log(
        `${result.animation.frames.length} frames, ${result.animation.numPlays || 'infinite'} plays`,
      );
    }
  } finally {
    quantizer.dispose();
  }
}
