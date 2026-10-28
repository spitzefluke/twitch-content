// Markenfarbe: Farben aus einem Logo holen – ganz im Browser, das Bild verlässt den Rechner nicht.
// Genutzt vom Look-Baukasten (js/library.js) und vom OBS-Editor (Akzentfarbe).
const MAX_SIDE = 96;

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hsl(r, g, b) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

// Datei → bis zu 6 Farben, die kräftigste und häufigste zuerst. Fast nur Grau/Weiß/Schwarz: diese Töne.
export async function extractColors(file, count = 6) {
  if (!/^image\//.test(file?.type ?? '')) throw new Error('Bitte ein Bild wählen (PNG, JPG, SVG oder WebP).');
  if (file.size > 8 * 1024 * 1024) throw new Error('Das Bild ist größer als 8 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Das Bild lässt sich nicht lesen.'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || MAX_SIDE, img.naturalHeight || MAX_SIDE));
    const w = Math.max(1, Math.round((img.naturalWidth || MAX_SIDE) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || MAX_SIDE) * scale));
    const canvas = document.createElement('canvas');
    Object.assign(canvas, { width: w, height: h });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return paletteOf(ctx.getImageData(0, 0, w, h).data, count);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Pixel (RGBA) → Farben: grob in Eimer sortieren, bunte Eimer zählen mehr, ähnliche zusammenlegen
export function paletteOf(data, count = 6) {
  const vivid = new Map();
  const plain = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 140) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const { s, l } = hsl(r, g, b);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const target = s > 0.22 && l > 0.12 && l < 0.9 ? vivid : plain;
    const e = target.get(key) ?? { r: 0, g: 0, b: 0, n: 0, s: 0 };
    e.r += r; e.g += g; e.b += b; e.n += 1; e.s += s;
    target.set(key, e);
  }
  const source = vivid.size ? vivid : plain;
  const ranked = [...source.values()]
    .map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n], score: e.n * (0.35 + e.s / e.n) }))
    .sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of ranked) {
    if (out.some((o) => Math.hypot(o[0] - c.rgb[0], o[1] - c.rgb[1], o[2] - c.rgb[2]) < 56)) continue;
    out.push(c.rgb);
    if (out.length >= count) break;
  }
  return out.map(([r, g, b]) => hex(r, g, b));
}

// Lesbare Schriftfarbe auf der Farbe (für Knöpfe)
export function inkOn(h) {
  const rgb = hexToRgb(h);
  if (!rgb) return '#fff';
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#14101f' : '#fff';
}
