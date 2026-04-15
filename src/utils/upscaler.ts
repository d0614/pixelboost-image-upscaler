/**
 * High-quality image upscaler using multi-step canvas scaling with smart sharpening.
 * Upscales images to HD resolution (1080p) while preserving detail.
 */

export interface UpscaleResult {
  canvas: HTMLCanvasElement;
  originalWidth: number;
  originalHeight: number;
  newWidth: number;
  newHeight: number;
  scaleFactor: number;
}

/**
 * Upscale an image so its shorter dimension reaches at least targetMinDim pixels.
 * Uses multi-step 2x scaling for better quality than single-step resize.
 */
export function upscaleToHD(
  source: HTMLCanvasElement,
  targetMinDim: number = 1080
): UpscaleResult {
  const srcW = source.width;
  const srcH = source.height;
  const minDim = Math.min(srcW, srcH);

  // Already at or above target resolution — just apply light sharpening
  if (minDim >= targetMinDim) {
    const result = document.createElement('canvas');
    result.width = srcW;
    result.height = srcH;
    result.getContext('2d')!.drawImage(source, 0, 0);
    applyUnsharpMask(result, 0.25);
    return {
      canvas: result,
      originalWidth: srcW,
      originalHeight: srcH,
      newWidth: srcW,
      newHeight: srcH,
      scaleFactor: 1,
    };
  }

  const scale = targetMinDim / minDim;
  const targetW = Math.round(srcW * scale);
  const targetH = Math.round(srcH * scale);

  // Multi-step upscaling: scale by at most 2x per step for smoother results
  let current = document.createElement('canvas');
  current.width = srcW;
  current.height = srcH;
  current.getContext('2d')!.drawImage(source, 0, 0);

  let curW = srcW;
  let curH = srcH;

  while (curW < targetW || curH < targetH) {
    const nextW = Math.min(Math.round(curW * 2), targetW);
    const nextH = Math.min(Math.round(curH * 2), targetH);

    const next = document.createElement('canvas');
    next.width = nextW;
    next.height = nextH;
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, nextW, nextH);

    current = next;
    curW = nextW;
    curH = nextH;
  }

  // Apply sharpening to recover detail lost during upscaling
  applyUnsharpMask(current, 0.45);

  return {
    canvas: current,
    originalWidth: srcW,
    originalHeight: srcH,
    newWidth: targetW,
    newHeight: targetH,
    scaleFactor: scale,
  };
}

/**
 * Apply an unsharp mask (sharpening filter) to a canvas.
 * Uses a 3x3 convolution kernel with adjustable strength.
 *
 * Kernel (with strength s):
 *    0   -s   0
 *   -s  1+4s -s
 *    0   -s   0
 */
function applyUnsharpMask(canvas: HTMLCanvasElement, strength: number): void {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;

  // Skip if image is too large (>4K) to avoid freezing the browser
  if (width * height > 8_000_000) {
    strength *= 0.5; // Use lighter sharpening for very large images
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const output = new Uint8ClampedArray(src.length);

  // Copy all pixels first (handles borders + alpha)
  output.set(src);

  const center = 1 + 4 * strength;
  const neighbor = -strength;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const val =
          src[idx + c] * center +
          src[((y - 1) * width + x) * 4 + c] * neighbor +
          src[((y + 1) * width + x) * 4 + c] * neighbor +
          src[(y * width + (x - 1)) * 4 + c] * neighbor +
          src[(y * width + (x + 1)) * 4 + c] * neighbor;
        output[idx + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }

  ctx.putImageData(new ImageData(output, width, height), 0, 0);
}
