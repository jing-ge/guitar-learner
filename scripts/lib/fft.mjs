// 纯 JS 迭代 Cooley-Tukey FFT，零依赖
// 输入: 实数数组（长度必须 2^n）
// 输出: 交错 [re, im, re, im, ...] 长度 2N

export function fftRealToComplex(input) {
  const N = input.length;
  if ((N & (N - 1)) !== 0) throw new Error(`FFT length must be power of 2, got ${N}`);

  // 输出 buffer：交错 re/im，长度 2N
  const out = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) {
    out[2 * i] = input[i];
    out[2 * i + 1] = 0;
  }

  // Bit reversal
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const ti_re = out[2 * i], ti_im = out[2 * i + 1];
      out[2 * i]     = out[2 * j];
      out[2 * i + 1] = out[2 * j + 1];
      out[2 * j]     = ti_re;
      out[2 * j + 1] = ti_im;
    }
  }

  // 迭代 butterfly
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    for (let i = 0; i < N; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const re = out[2 * (i + k + half)];
        const im = out[2 * (i + k + half) + 1];
        const tr = wr * re - wi * im;
        const ti = wr * im + wi * re;
        const ar = out[2 * (i + k)];
        const ai = out[2 * (i + k) + 1];
        out[2 * (i + k)]            = ar + tr;
        out[2 * (i + k) + 1]        = ai + ti;
        out[2 * (i + k + half)]     = ar - tr;
        out[2 * (i + k + half) + 1] = ai - ti;
      }
    }
  }
  return out;
}

/** 返回 magnitude spectrum 的前 N/2+1 个 bin */
export function magnitudeSpectrum(fftOut) {
  const N = fftOut.length / 2;
  const mag = new Float64Array(N / 2 + 1);
  for (let i = 0; i <= N / 2; i++) {
    const re = fftOut[2 * i];
    const im = fftOut[2 * i + 1];
    mag[i] = Math.sqrt(re * re + im * im);
  }
  return mag;
}
