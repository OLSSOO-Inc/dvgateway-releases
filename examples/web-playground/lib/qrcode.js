// Minimal dependency-free QR Code encoder (byte mode, EC level M).
//
// Self-contained so the playground stays offline-capable (no CDN/QR API).
// Based on the public QR algorithm (Reed–Solomon over GF(256), ISO/IEC 18004).
// Scope kept small on purpose: byte mode + EC level M, auto-picks the smallest
// version (1–10) that fits. Store URLs (~55–90 chars) fit comfortably.
//
// Public API:
//   renderQr(canvas, text, { size?, margin?, dark?, light? })
//     — draws the QR for `text` into the given <canvas>. Throws if too long.

// ── Galois field GF(256) tables (primitive poly 0x11d) ──────────────
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 256; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

// Generator polynomial for `degree` EC codewords.
function rsGenPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const res = new Array(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// ── Version capacity (byte mode, EC level M) ────────────────────────
// [version] = { totalCodewords, ecPerBlock, blocks:[ [count, dataCodewords], ... ] }
const VERSIONS = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

function versionInfoBits(version) {
  // Version >= 7 needs an 18-bit version info block. We cap at 10 so it's used.
  // BCH(18,6) with golay-like generator 0x1f25.
  let d = version << 12;
  const g = 0x1f25;
  let rem = d;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= g << (i - 12);
  }
  return (d | (rem & 0xfff)) >>> 0;
}

function dataCapacity(version) {
  const v = VERSIONS[version];
  let dataCw = 0;
  for (const [count, dc] of v.groups) dataCw += count * dc;
  return dataCw;
}

function sizeForVersion(version) {
  return version * 4 + 17;
}

// ── Bit buffer ──────────────────────────────────────────────────────
class BitBuffer {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  get length() { return this.bits.length; }
}

// Build the full codeword stream (data + EC, interleaved) for `bytes`.
function buildCodewords(bytes, version) {
  const v = VERSIONS[version];
  const bb = new BitBuffer();
  // Mode indicator: byte = 0100
  bb.put(0b0100, 4);
  // Character count indicator: 8 bits (v1–9) / 16 bits (v10+). v<=9 → 8, v10 → 16.
  const ccBits = version <= 9 ? 8 : 16;
  bb.put(bytes.length, ccBits);
  for (const b of bytes) bb.put(b, 8);

  const totalDataCw = dataCapacity(version);
  const totalDataBits = totalDataCw * 8;
  // Terminator (up to 4 zero bits)
  const term = Math.min(4, totalDataBits - bb.length);
  if (term > 0) bb.put(0, term);
  // Pad to byte boundary
  while (bb.length % 8 !== 0) bb.bits.push(0);
  // Pad bytes 0xEC, 0x11 alternating
  const dataCw = [];
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
    dataCw.push(byte);
  }
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (dataCw.length < totalDataCw) dataCw.push(padBytes[pi++ % 2]);

  // Split into blocks, compute EC per block
  const dataBlocks = [];
  const ecBlocks = [];
  let idx = 0;
  for (const [count, dc] of v.groups) {
    for (let c = 0; c < count; c++) {
      const block = dataCw.slice(idx, idx + dc);
      idx += dc;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, v.ec));
    }
  }
  // Interleave data codewords
  const result = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  // Interleave EC codewords
  const maxEc = v.ec;
  for (let i = 0; i < maxEc; i++) {
    for (const block of ecBlocks) if (i < block.length) result.push(block[i]);
  }
  return result;
}

// ── Matrix construction ─────────────────────────────────────────────
function newMatrix(size) {
  const m = [];
  for (let i = 0; i < size; i++) m.push(new Array(size).fill(null)); // null = unset
  return m;
}

function placeFinder(m, r, c) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      let dark = false;
      if (inRing) {
        dark = dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
               (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      }
      m[rr][cc] = dark ? 1 : 0; // separators (outside ring) become 0
    }
  }
}

function placeAlignment(m, version) {
  if (version < 2) return;
  // Alignment center positions per version (subset for v2–10)
  const POS = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  }[version];
  if (!POS) return;
  for (const r of POS) {
    for (const c of POS) {
      // skip if overlaps a finder
      if (m[r][c] !== null) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m[r + dr][c + dc] = dark ? 1 : 0;
        }
      }
    }
  }
}

function placeTiming(m) {
  const n = m.length;
  for (let i = 8; i < n - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (m[6][i] === null) m[6][i] = v;
    if (m[i][6] === null) m[i][6] = v;
  }
}

function reserveFormat(m) {
  const n = m.length;
  // mark format areas as reserved (-1) so data skips them
  for (let i = 0; i <= 8; i++) {
    if (m[8][i] === null) m[8][i] = -1;
    if (m[i][8] === null) m[i][8] = -1;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][n - 1 - i] === null) m[8][n - 1 - i] = -1;
    if (m[n - 1 - i][8] === null) m[n - 1 - i][8] = -1;
  }
  m[n - 8][8] = 1; // dark module
}

function reserveVersion(m, version) {
  if (version < 7) return;
  const n = m.length;
  for (let i = 0; i < 18; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    if (m[r][n - 11 + c] === null) m[r][n - 11 + c] = -1;
    if (m[n - 11 + c][r] === null) m[n - 11 + c][r] = -1;
  }
}

function placeData(m, codewords) {
  const n = m.length;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let bi = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let r = 0; r < n; r++) {
      const row = upward ? n - 1 - r : r;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (m[row][c] === null) {
          m[row][c] = bi < bits.length ? bits[bi++] : 0;
          m[row][c] |= 0;
          // tag as data with bit value already set
        }
      }
    }
    upward = !upward;
  }
}

function maskFn(id, r, c) {
  switch (id) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

// Apply mask to data modules only (reserved/-1 and function modules untouched).
// We track which modules are "function" via a parallel structure: here, any
// module that was set during function placement is fixed. To distinguish, we
// build the matrix so function modules are placed first; data via placeData.
// Simplest robust approach: rebuild with a "fixed" map.

function formatBits(maskId) {
  // EC level M = 0b00, mask 3 bits. BCH(15,5) with generator 0x537, XOR 0x5412.
  const ec = 0b00;
  let data = (ec << 3) | maskId;
  let d = data << 10;
  const g = 0x537;
  let rem = d;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= g << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function placeFormat(m, maskId) {
  const n = m.length;
  const fmt = formatBits(maskId);
  // bit i (0..14), 0 = MSB? QR spec: bit 14 first. We place per standard mapping.
  const bits = [];
  for (let i = 14; i >= 0; i--) bits.push((fmt >> i) & 1);
  // Around top-left finder + split copies
  // Mapping per ISO 18004
  const coordsA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) m[coordsA[i][0]][coordsA[i][1]] = bits[i];
  const coordsB = [
    [n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8],
    [8, n - 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1],
  ];
  for (let i = 0; i < 15; i++) m[coordsB[i][0]][coordsB[i][1]] = bits[i];
}

function placeVersionInfo(m, version) {
  if (version < 7) return;
  const n = m.length;
  const info = versionInfoBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = (info >> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    m[r][n - 11 + c] = bit;
    m[n - 11 + c][r] = bit;
  }
}

// Encode text → matrix of 0/1. Picks smallest fitting version (1–10).
function encode(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const ccBits = v <= 9 ? 8 : 16;
    const need = 4 + ccBits + bytes.length * 8;
    if (need <= dataCapacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error("text too long for QR (max ~ v10 byte mode)");

  const size = sizeForVersion(version);
  // 1) function pattern matrix (fixed modules) + reserved map
  const m = newMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, version);
  placeTiming(m);
  reserveFormat(m);
  reserveVersion(m, version);

  // snapshot which modules are "function/reserved" (non-null right now)
  const fixed = m.map((row) => row.map((x) => x !== null));

  // 2) data
  const codewords = buildCodewords(bytes, version);
  placeData(m, codewords);

  // 3) choose mask 0 (deterministic; readers handle any valid mask).
  // Apply mask to data modules only.
  const maskId = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!fixed[r][c] && maskFn(maskId, r, c)) m[r][c] ^= 1;
    }
  }
  placeFormat(m, maskId);
  placeVersionInfo(m, version);

  // normalize -1 (any leftover reserved) to 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (m[r][c] === null || m[r][c] === -1) m[r][c] = 0;
  }
  return m;
}

// Render `text` into `canvas` at a FIXED `size` × `size` pixel box, regardless
// of the QR version (module count). This keeps multiple QRs visually identical
// in size even when their content length differs (e.g. two store URLs of
// different length). Module rects are snapped to integer pixels so the code
// stays crisp and scannable; the quiet-zone margin scales with the box.
export function renderQr(canvas, text, opts = {}) {
  const { size = 132, margin = 4, dark = "#0b1020", light = "#ffffff" } = opts;
  const m = encode(text);
  const n = m.length;
  const total = n + margin * 2;          // modules including quiet zone
  const cell = size / total;             // fractional px per module (fixed box)

  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = light;
  g.fillRect(0, 0, size, size);
  g.fillStyle = dark;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c] === 1) {
        // Snap edges to integer px so adjacent dark modules merge cleanly
        // (no sub-pixel gaps that hurt scanning).
        const x0 = Math.round((c + margin) * cell);
        const y0 = Math.round((r + margin) * cell);
        const x1 = Math.round((c + margin + 1) * cell);
        const y1 = Math.round((r + margin + 1) * cell);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
  return canvas;
}
