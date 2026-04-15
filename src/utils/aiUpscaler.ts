/**
 * AI Super-Resolution using Swin2SR 4x model via ONNX Runtime Web directly.
 * Bypasses @huggingface/transformers pipeline to avoid input resizing issues.
 * Processes tiles at FULL resolution → 4x output.
 */

import * as ort from 'onnxruntime-web';

// Single-threaded WASM for compatibility
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession | null = null;
let sessionPromise: Promise<ort.InferenceSession | null> | null = null;

export interface ModelLoadProgress {
  status: string;
  progress: number;
  file?: string;
}

/**
 * Initialize the ONNX Runtime session with the Swin2SR model.
 */
export async function initModel(
  onProgress?: (p: ModelLoadProgress) => void,
): Promise<boolean> {
  if (session) return true;
  if (sessionPromise) {
    await sessionPromise;
    return session !== null;
  }

  sessionPromise = (async (): Promise<ort.InferenceSession | null> => {
    try {
      onProgress?.({ status: 'progress', progress: 20, file: 'Loading ONNX Runtime...' });

      const modelUrl = import.meta.env.BASE_URL + 'models/swin2SR/onnx/model.onnx';

      onProgress?.({ status: 'progress', progress: 40, file: 'Loading Swin2SR model...' });

      const sess = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });

      onProgress?.({ status: 'ready', progress: 100, file: 'Model ready' });
      return sess;
    } catch (err) {
      console.error('[AI Upscaler] ONNX model load failed:', err);
      onProgress?.({ status: 'error', progress: 0, file: String(err) });
      return null;
    }
  })();

  session = await sessionPromise;
  sessionPromise = null;
  return session !== null;
}

export function isModelReady(): boolean {
  return session !== null;
}

/**
 * Upscale a canvas tile using Swin2SR 4x model via ONNX Runtime.
 * Full resolution input → 4x output, no resizing.
 */
export async function upscaleWithAI(
  sourceCanvas: HTMLCanvasElement,
  targetMinDim: number = 1080,
): Promise<{
  canvas: HTMLCanvasElement;
  originalWidth: number;
  originalHeight: number;
  newWidth: number;
  newHeight: number;
}> {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  let currentCanvas = sourceCanvas;
  let curW = srcW;
  let curH = srcH;

  // ── Step 1: AI 4x upscale via ONNX Runtime ─────────────────
  if (session) {
    try {
      // For very large tiles, process in patches to avoid OOM
      const maxInputDim = 256; // Max dimension before tiling
      if (srcW > maxInputDim || srcH > maxInputDim) {
        currentCanvas = await processInTiles(sourceCanvas, session, maxInputDim);
      } else {
        currentCanvas = await processSingleTile(sourceCanvas, session);
      }
      curW = currentCanvas.width;
      curH = currentCanvas.height;
    } catch (err) {
      console.warn('[AI Upscaler] Inference failed:', err);
    }
  }

  // ── Step 2: Ensure minimum 1080p ────────────────────────────
  const curMin = Math.min(curW, curH);
  if (curMin < targetMinDim) {
    const scale = targetMinDim / curMin;
    const tW = Math.round(curW * scale);
    const tH = Math.round(curH * scale);
    currentCanvas = multiStepCanvasUpscale(currentCanvas, tW, tH);
    curW = tW;
    curH = tH;
  }

  // ── Step 3: Sharpen ────────────────────────────────────────
  sharpen(currentCanvas, 0.35);

  return {
    canvas: currentCanvas,
    originalWidth: srcW,
    originalHeight: srcH,
    newWidth: curW,
    newHeight: curH,
  };
}

/**
 * Process a single tile through the model (for small inputs).
 */
async function processSingleTile(
  canvas: HTMLCanvasElement,
  sess: ort.InferenceSession,
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  // Pad to multiple of 8 (window_size)
  const padW = Math.ceil(width / 8) * 8;
  const padH = Math.ceil(height / 8) * 8;

  // Convert RGBA HWC [0,255] → RGB CHW [0,1]
  const input = new Float32Array(3 * padH * padW);
  for (let y = 0; y < padH; y++) {
    for (let x = 0; x < padW; x++) {
      const srcY = Math.min(y, height - 1);
      const srcX = Math.min(x, width - 1);
      const srcIdx = (srcY * width + srcX) * 4;
      const planeSize = padH * padW;

      input[0 * planeSize + y * padW + x] = pixels[srcIdx] / 255;
      input[1 * planeSize + y * padW + x] = pixels[srcIdx + 1] / 255;
      input[2 * planeSize + y * padW + x] = pixels[srcIdx + 2] / 255;
    }
  }

  // ONNX inference
  const inputName = sess.inputNames[0]; // Usually 'pixel_values'
  const inputTensor = new ort.Tensor('float32', input, [1, 3, padH, padW]);
  const results = await sess.run({ [inputName]: inputTensor });
  const outputTensor = Object.values(results)[0];
  const output = outputTensor.data as Float32Array;

  // Output dimensions (4x upscaled)
  const outH = padH * 4;
  const outW = padW * 4;
  const cropH = height * 4;
  const cropW = width * 4;

  // Convert CHW [0,1] → RGBA HWC [0,255]
  const outCanvas = document.createElement('canvas');
  outCanvas.width = cropW;
  outCanvas.height = cropH;
  const outCtx = outCanvas.getContext('2d')!;
  const outImageData = outCtx.createImageData(cropW, cropH);
  const outPixels = outImageData.data;
  const outPlane = outH * outW;

  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const srcIdx = y * outW + x;
      const dstIdx = (y * cropW + x) * 4;

      outPixels[dstIdx]     = clamp(output[0 * outPlane + srcIdx] * 255);
      outPixels[dstIdx + 1] = clamp(output[1 * outPlane + srcIdx] * 255);
      outPixels[dstIdx + 2] = clamp(output[2 * outPlane + srcIdx] * 255);
      outPixels[dstIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outImageData, 0, 0);
  return outCanvas;
}

/**
 * Process a large image in overlapping tiles to avoid OOM.
 */
async function processInTiles(
  canvas: HTMLCanvasElement,
  sess: ort.InferenceSession,
  tileSize: number = 256,
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  const overlap = 16; // Overlap in pixels
  const step = tileSize - overlap * 2;
  const scale = 4;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width * scale;
  outCanvas.height = height * scale;
  const outCtx = outCanvas.getContext('2d')!;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      // Calculate tile bounds (with clamping)
      const tx = Math.max(0, Math.min(x - overlap, width - tileSize));
      const ty = Math.max(0, Math.min(y - overlap, height - tileSize));
      const tw = Math.min(tileSize, width - tx);
      const th = Math.min(tileSize, height - ty);

      // Extract tile
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tw;
      tileCanvas.height = th;
      const tileCtx = tileCanvas.getContext('2d')!;
      tileCtx.drawImage(canvas, tx, ty, tw, th, 0, 0, tw, th);

      // Upscale tile
      const upscaledTile = await processSingleTile(tileCanvas, sess);

      // Calculate paste position (accounting for overlap)
      const pasteX = tx * scale;
      const pasteY = ty * scale;

      outCtx.drawImage(upscaledTile, pasteX, pasteY);

      // Yield to UI thread
      await new Promise(r => setTimeout(r, 10));
    }
  }

  return outCanvas;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function multiStepCanvasUpscale(
  source: HTMLCanvasElement, targetW: number, targetH: number,
): HTMLCanvasElement {
  let current = source;
  let w = source.width;
  let h = source.height;

  while (w < targetW || h < targetH) {
    const nextW = Math.min(w * 2, targetW);
    const nextH = Math.min(h * 2, targetH);
    const step = document.createElement('canvas');
    step.width = nextW;
    step.height = nextH;
    const ctx = step.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, nextW, nextH);
    current = step;
    w = nextW;
    h = nextH;
  }
  return current;
}

function sharpen(canvas: HTMLCanvasElement, strength: number): void {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const src = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);
  const c = 1 + 4 * strength;
  const n = -strength;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[i + ch] = clamp(
          src[i + ch] * c +
          src[((y - 1) * width + x) * 4 + ch] * n +
          src[((y + 1) * width + x) * 4 + ch] * n +
          src[(y * width + x - 1) * 4 + ch] * n +
          src[(y * width + x + 1) * 4 + ch] * n
        );
      }
    }
  }
  ctx.putImageData(new ImageData(out, width, height), 0, 0);
}
