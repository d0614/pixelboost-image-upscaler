/**
 * Grid detection using multiple complementary strategies:
 *
 *  1. Aggressive downsampling (blurs away content, keeps structure)
 *  2. Seam detection (uniform-color divider bands)
 *  3. Autocorrelation (repeating periodic patterns)
 *  4. Content histogram analysis (last resort)
 *
 * Results from each method are scored and the best is returned.
 */

export interface GridDetectionResult {
  rows: number;
  cols: number;
  confidence: number;
}

export async function detectGrid(img: HTMLImageElement): Promise<GridDetectionResult> {
  // ── Prepare multiple scales ────────────────────────────────
  const scales = [150, 300]; // Very aggressive + moderate downsampling
  const candidates: (GridDetectionResult & { method: string })[] = [];

  for (const maxDim of scales) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
    }

    // Method 1: Seam detection
    const seam = detectBySeams(gray, w, h);
    if (seam.rows > 1 || seam.cols > 1) {
      candidates.push({ ...seam, method: `seam@${maxDim}` });
    }

    // Method 2: Autocorrelation
    const ac = detectByAutocorrelation(gray, w, h);
    if (ac.rows > 1 || ac.cols > 1) {
      candidates.push({ ...ac, method: `autocorr@${maxDim}` });
    }
  }

  // Method 3: Content analysis (at moderate scale)
  const modScale = Math.min(1, 300 / Math.max(img.width, img.height));
  const mw = Math.round(img.width * modScale);
  const mh = Math.round(img.height * modScale);
  const mc = document.createElement('canvas');
  mc.width = mw; mc.height = mh;
  mc.getContext('2d')!.drawImage(img, 0, 0, mw, mh);
  const md = mc.getContext('2d')!.getImageData(0, 0, mw, mh).data;
  const mg = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) {
    mg[i] = md[i * 4] * 0.299 + md[i * 4 + 1] * 0.587 + md[i * 4 + 2] * 0.114;
  }
  const content = detectByContent(mg, mw, mh);
  if (content.rows > 1 || content.cols > 1) {
    candidates.push({ ...content, method: 'content' });
  }

  // ── Pick best candidate ────────────────────────────────────
  if (candidates.length === 0) {
    return { rows: 1, cols: 1, confidence: 0.5 };
  }

  // Check if multiple methods agree
  const agreement = findAgreement(candidates);
  if (agreement) return agreement;

  // Otherwise pick highest confidence
  candidates.sort((a, b) => b.confidence - a.confidence);
  return {
    rows: candidates[0].rows,
    cols: candidates[0].cols,
    confidence: candidates[0].confidence,
  };
}

// ─── Agreement checker ───────────────────────────────────────

function findAgreement(
  candidates: GridDetectionResult[],
): GridDetectionResult | null {
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (
        candidates[i].rows === candidates[j].rows &&
        candidates[i].cols === candidates[j].cols
      ) {
        // Two methods agree → boost confidence
        return {
          rows: candidates[i].rows,
          cols: candidates[i].cols,
          confidence: Math.min(1, Math.max(candidates[i].confidence, candidates[j].confidence) + 0.15),
        };
      }
    }
  }
  return null;
}

// ─── Method 1: Seam detection ────────────────────────────────

function detectBySeams(gray: Float32Array, w: number, h: number): GridDetectionResult {
  const hSeams = findSeamLines(gray, w, h, 'horizontal');
  const vSeams = findSeamLines(gray, w, h, 'vertical');

  const hGrid = fitRegularGrid(hSeams, h);
  const vGrid = fitRegularGrid(vSeams, w);

  if (hGrid.count === 0 && vGrid.count === 0) {
    return { rows: 1, cols: 1, confidence: 0 };
  }

  return {
    rows: hGrid.count + 1,
    cols: vGrid.count + 1,
    confidence: (hGrid.score + vGrid.score) / 2,
  };
}

function findSeamLines(
  gray: Float32Array, w: number, h: number, dir: 'horizontal' | 'vertical',
): number[] {
  const isH = dir === 'horizontal';
  const pLen = isH ? h : w;
  const sLen = isH ? w : h;

  const lineStd = new Float32Array(pLen);
  for (let p = 0; p < pLen; p++) {
    let sum = 0, sumSq = 0;
    for (let s = 0; s < sLen; s++) {
      const v = isH ? gray[p * w + s] : gray[s * w + p];
      sum += v; sumSq += v * v;
    }
    const mean = sum / sLen;
    lineStd[p] = Math.sqrt(Math.max(0, sumSq / sLen - mean * mean));
  }

  const sorted = Float32Array.from(lineStd).sort();
  const medStd = sorted[Math.floor(sorted.length * 0.5)];
  const thresh = Math.min(Math.max(3, medStd * 0.25), 12);
  const margin = Math.round(pLen * 0.03);
  const seams: number[] = [];
  let inSeam = false, start = 0;

  for (let p = 0; p < pLen; p++) {
    if (lineStd[p] < thresh) {
      if (!inSeam) { start = p; inSeam = true; }
    } else if (inSeam) {
      const center = Math.round((start + p - 1) / 2);
      if (center > margin && center < pLen - margin) seams.push(center);
      inSeam = false;
    }
  }
  return seams;
}

// ─── Method 2: Autocorrelation ───────────────────────────────

function detectByAutocorrelation(gray: Float32Array, w: number, h: number): GridDetectionResult {
  // Column profile (mean brightness per column)
  const colProf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += gray[y * w + x];
    colProf[x] = s / h;
  }

  // Row profile
  const rowProf = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += gray[y * w + x];
    rowProf[y] = s / w;
  }

  // Also compute gradient profiles for sharper periodic signals
  const colGrad = new Float32Array(w);
  for (let x = 1; x < w - 1; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += Math.abs(gray[y * w + x + 1] - gray[y * w + x - 1]);
    colGrad[x] = s / h;
  }
  const rowGrad = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
    rowGrad[y] = s / w;
  }

  // Try both profiles (brightness and gradient) and pick best
  const colPeriod1 = findPeriod(colProf);
  const colPeriod2 = findPeriod(colGrad);
  const colPeriod = colPeriod1.strength > colPeriod2.strength ? colPeriod1 : colPeriod2;

  const rowPeriod1 = findPeriod(rowProf);
  const rowPeriod2 = findPeriod(rowGrad);
  const rowPeriod = rowPeriod1.strength > rowPeriod2.strength ? rowPeriod1 : rowPeriod2;

  const cols = colPeriod.period > 0 ? Math.round(w / colPeriod.period) : 1;
  const rows = rowPeriod.period > 0 ? Math.round(h / rowPeriod.period) : 1;

  // Clamp to reasonable range
  const rr = Math.max(1, Math.min(10, rows));
  const cc = Math.max(1, Math.min(10, cols));

  const confidence = (colPeriod.strength + rowPeriod.strength) / 2;
  return { rows: rr, cols: cc, confidence };
}

function findPeriod(signal: Float32Array): { period: number; strength: number } {
  const len = signal.length;
  if (len < 10) return { period: 0, strength: 0 };

  let mean = 0;
  for (let i = 0; i < len; i++) mean += signal[i];
  mean /= len;

  let variance = 0;
  for (let i = 0; i < len; i++) variance += (signal[i] - mean) ** 2;
  variance /= len;
  if (variance < 0.01) return { period: 0, strength: 0 };

  const minLag = Math.max(3, Math.floor(len * 0.08)); // At least 8% of signal
  const maxLag = Math.floor(len * 0.6);

  const ac = new Float32Array(maxLag);
  for (let lag = minLag; lag < maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < len - lag; i++) {
      s += (signal[i] - mean) * (signal[i + lag] - mean);
    }
    ac[lag] = s / ((len - lag) * variance);
  }

  // Find first significant peak
  for (let lag = minLag + 1; lag < maxLag - 1; lag++) {
    if (ac[lag] > 0.15 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      return { period: lag, strength: Math.min(1, ac[lag] * 1.2) };
    }
  }

  return { period: 0, strength: 0 };
}

// ─── Method 3: Content analysis ──────────────────────────────

function detectByContent(gray: Float32Array, w: number, h: number): GridDetectionResult {
  const candidates = [
    [2, 2], [1, 2], [2, 1], [1, 3], [3, 1],
    [2, 3], [3, 2], [3, 3], [4, 4],
    [5, 4], [4, 5], [4, 3], [3, 4],
    [5, 3], [3, 5], [6, 4], [4, 6],
  ];

  let bestScore = -1;
  let bestR = 1, bestC = 1;

  for (const [r, c] of candidates) {
    const score = scoreCandidate(gray, w, h, r, c);
    if (score > bestScore) {
      bestScore = score;
      bestR = r;
      bestC = c;
    }
  }

  if (bestScore < 0.10) return { rows: 1, cols: 1, confidence: 0.3 };

  return {
    rows: bestR,
    cols: bestC,
    confidence: Math.min(0.7, 0.25 + bestScore),
  };
}

function scoreCandidate(gray: Float32Array, w: number, h: number, rows: number, cols: number): number {
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  const mx = Math.floor(cw * 0.25);
  const my = Math.floor(ch * 0.25);

  const means: number[][] = [];
  for (let r = 0; r < rows; r++) {
    means[r] = [];
    for (let c = 0; c < cols; c++) {
      let s = 0, n = 0;
      for (let y = r * ch + my; y < r * ch + ch - my; y++) {
        for (let x = c * cw + mx; x < c * cw + cw - mx; x++) {
          s += gray[y * w + x]; n++;
        }
      }
      means[r][c] = n > 0 ? s / n : 0;
    }
  }

  let diff = 0, cnt = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) { diff += Math.abs(means[r][c] - means[r][c + 1]); cnt++; }
      if (r + 1 < rows) { diff += Math.abs(means[r][c] - means[r + 1][c]); cnt++; }
    }
  }
  return cnt > 0 ? diff / cnt / 255 : 0;
}

// ─── Regular grid fitting ────────────────────────────────────

function fitRegularGrid(candidates: number[], totalLen: number): { count: number; score: number } {
  if (candidates.length === 0) return { count: 0, score: 0.5 };

  let bestScore = -1, bestN = 0;

  for (let n = 1; n <= Math.min(candidates.length, 9); n++) {
    const spacing = totalLen / (n + 1);
    if (spacing < totalLen * 0.05) continue;

    let totalDev = 0, matched = 0;

    for (let i = 1; i <= n; i++) {
      const expected = spacing * i;
      let minD = Infinity;
      for (const cp of candidates) {
        minD = Math.min(minD, Math.abs(cp - expected));
      }
      totalDev += minD;
      if (minD < spacing * 0.12) matched++;
    }

    if (matched < n) continue;

    const score = Math.max(0, 1 - (totalDev / n / spacing) * 5);
    if (score > bestScore) { bestScore = score; bestN = n; }
  }

  return bestScore < 0.5 ? { count: 0, score: 0.5 } : { count: bestN, score: bestScore };
}
