// ─────────────────────────────────────────────────────────────────────────────
// textures.ts — every texture in the game is generated procedurally on canvas.
// No external assets: asphalt, concrete, building facades (colour + emissive
// window map), graffiti tags, chain-link fence, sky backdrop per act, sprites
// for blood / smoke / muzzle and light cones.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { ActPalette } from './state';

// deterministic rng so stages look authored, not random-noise
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function toTex(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  tex.anisotropy = 4;
  return tex;
}

// speckle helper — grime noise
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rng: () => number, alpha = 0.06) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rng() * 90);
    ctx.fillStyle = rng() > 0.5 ? `rgba(${v},${v},${v},${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

// jagged cracks
function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rng: () => number, color = 'rgba(0,0,0,0.35)') {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = rng() * w, y = rng() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rng() * 5);
    for (let s = 0; s < segs; s++) { x += (rng() - 0.5) * 46; y += (rng() - 0.5) * 46; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// ── ground: asphalt road ─────────────────────────────────────────────────────
export function asphaltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rng = mulberry32(1201);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#232527'); g.addColorStop(0.5, '#1c1e20'); g.addColorStop(1, '#17181a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 5200, rng, 0.07);
  cracks(ctx, 512, 512, 16, rng);
  // faded centre dashes
  ctx.fillStyle = 'rgba(190,160,60,0.18)';
  for (let x = 0; x < 512; x += 128) ctx.fillRect(x, 250, 64, 6);
  // manhole / patches
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(rng() * 512, rng() * 512, 24 + rng() * 20, 18 + rng() * 14, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // oil stains + dried blood
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 3 === 0 ? 'rgba(90,8,10,0.20)' : 'rgba(0,0,0,0.20)';
    ctx.beginPath(); ctx.ellipse(rng() * 512, rng() * 512, 12 + rng() * 26, 8 + rng() * 18, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  return toTex(canvas, true);
}

// ── concrete (sidewalk kerb / rubble / bunker) ───────────────────────────────
export function concreteTexture(seed = 77, base = '#3d3f40'): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = mulberry32(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 2600, rng, 0.08);
  cracks(ctx, 256, 256, 8, rng, 'rgba(0,0,0,0.4)');
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  for (let i = 0; i < 6; i++) { // water stains
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(rng() * 256, 0, 8 + rng() * 22, 256);
  }
  return toTex(canvas, true);
}

// ── building facade: returns { map, emissive } — tile is 6×6 world units ────
const FACADE_BASES = ['#4c4e50', '#57534d', '#42454a', '#5a5147', '#484f52', '#52443e'];
const LIT_WARM = '#ffd9a0', LIT_COLD = '#b8d4ff';

export function facadeTextures(variant: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 512; // 6 world units → ~85px per unit
  const { canvas, ctx } = makeCanvas(S, S);
  const { canvas: ecv, ctx: ectx } = makeCanvas(S, S);
  const rng = mulberry32(500 + variant * 131);
  const base = FACADE_BASES[variant % FACADE_BASES.length];

  // base concrete with vertical grime falloff
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, base);
  grad.addColorStop(0.75, shade(base, -22));
  grad.addColorStop(1, shade(base, -46));
  ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 4200, rng, 0.075);
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, S, S);

  // floor bands
  for (let fy = 0; fy < S; fy += 85) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, fy, S, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, fy + 3, S, 2);
  }

  // window grid
  const cols = 5, rows = 5;
  const cw = S / cols, chh = S / rows;
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      const x = cx * cw + cw * 0.24, y = cy * chh + chh * 0.22, w = cw * 0.52, h = chh * 0.56;
      // window reveal
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
      const r = rng();
      if (r < 0.10) { // boarded up
        ctx.fillStyle = '#241a10'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#3a2b18';
        for (let b = 0; b < 3; b++) { ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate((rng() - 0.5) * 0.5); ctx.fillRect(-w * 0.62, -6 + b * 7 - 7, w * 1.24, 7); ctx.restore(); }
      } else if (r < 0.34) { // broken
        ctx.fillStyle = '#05070a'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(160,180,200,0.35)'; ctx.lineWidth = 1;
        for (let s = 0; s < 4; s++) { ctx.beginPath(); ctx.moveTo(x + rng() * w, y + rng() * h); ctx.lineTo(x + rng() * w, y + rng() * h); ctx.stroke(); }
      } else if (r < 0.62) { // dark glass
        const gg = ctx.createLinearGradient(x, y, x, y + h);
        gg.addColorStop(0, '#0c1118'); gg.addColorStop(1, '#070a0e');
        ctx.fillStyle = gg; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y, w, h * 0.24);
      } else if (r < 0.72 && cy > 0) { // LIT window — also painted into emissive map
        const warm = rng() > 0.45;
        const col = warm ? LIT_WARM : LIT_COLD;
        ctx.fillStyle = warm ? '#7d6238' : '#42566e'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, 3);
        const dim = 0.45 + rng() * 0.55;
        ectx.save(); ectx.globalAlpha = dim;
        ectx.fillStyle = col; ectx.fillRect(x, y, w, h);
        ectx.fillStyle = 'rgba(0,0,0,0.65)'; // mullions subtract light
        ectx.fillRect(x + w / 2 - 2, y, 4, h); ectx.fillRect(x, y + h / 2 - 2, w, 4);
        ectx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeRect(x + w / 2 - 2, y, 4, h);
      } else { // concrete sealed
        ctx.fillStyle = shade(base, -12); ctx.fillRect(x, y, w, h);
        speckle(ctx, S, S, 20, rng, 0.1);
      }
      // grime streak under window
      if (rng() > 0.45) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(x + w * 0.3, y + h + 4, w * 0.4, 10 + rng() * 26);
      }
    }
  }
  // street-level grime + blood smears
  const bg = ctx.createLinearGradient(0, S - 90, 0, S);
  bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = bg; ctx.fillRect(0, S - 90, S, 90);
  for (let i = 0; i < 3; i++) {
    if (rng() > 0.5) continue;
    ctx.fillStyle = 'rgba(80,5,8,0.35)';
    ctx.beginPath(); ctx.ellipse(rng() * S, S - 20 - rng() * 50, 14 + rng() * 26, 8 + rng() * 16, rng(), 0, Math.PI * 2); ctx.fill();
  }

  const map = toTex(canvas, true);
  const emissive = toTex(ecv, true);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// ── graffiti tags (transparent overlays) ─────────────────────────────────────
const TAGS = ['NO HOPE', 'EVAC \u2192', 'DEAD END', 'RUN', 'THEY LIE', 'ZONE-7', 'S.O.S', 'STAY BACK', 'RUN \u2192', 'IT SPREADS'];
export function graffitiTexture(i: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 256);
  const rng = mulberry32(900 + i * 37);
  const colors = ['#c22030', '#d8d4c8', '#2fb8b0', '#c9a13a', '#8a4fd0'];
  const word = TAGS[i % TAGS.length];
  const col = colors[Math.floor(rng() * colors.length)];
  ctx.translate(256, 128); ctx.rotate((rng() - 0.5) * 0.22); ctx.translate(-256, -128);
  ctx.font = `900 ${word.length > 6 ? 64 : 92}px "Arial Narrow", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // spray haze
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 26; ctx.globalAlpha = 0.85;
  ctx.fillStyle = col; ctx.fillText(word, 256, 118);
  ctx.fillText(word, 256, 118);
  ctx.restore();
  // drips
  ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 3;
  for (let d = 0; d < 6; d++) {
    if (rng() > 0.5) continue;
    const x = 140 + rng() * 240, y = 130 + rng() * 20;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 4, y + 16 + rng() * 40); ctx.stroke();
  }
  // scratches
  ctx.globalAlpha = 0.4; ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
  for (let s = 0; s < 8; s++) {
    if (rng() > 0.4) continue;
    ctx.beginPath(); ctx.moveTo(rng() * 512, rng() * 256); ctx.lineTo(rng() * 512, rng() * 256); ctx.stroke();
  }
  const tex = toTex(canvas);
  return tex;
}

// ── chain-link fence (alpha) ─────────────────────────────────────────────────
export function fenceTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(150,158,164,0.95)'; ctx.lineWidth = 2;
  const step = 24;
  for (let i = -256; i < 512; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + 256, 0); ctx.lineTo(i, 256); ctx.stroke();
  }
  // rust spots
  const rng = mulberry32(31);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(120,60,30,0.5)'; ctx.fillRect(rng() * 256, rng() * 256, 3, 3); }
  const tex = toTex(canvas, true);
  return tex;
}

// ── sky backdrop per act (gradient, stars, moon, far skyline) ────────────────
export function skyTexture(p: ActPalette, seed = 0): THREE.CanvasTexture {
  const W = 2048, H = 768;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = mulberry32(3000 + seed * 99);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.skyTop); g.addColorStop(0.62, p.skyHorizon); g.addColorStop(1, p.fogColor);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 240; i++) {
    const y = rng() * H * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.4})`;
    ctx.fillRect(rng() * W, y, rng() > 0.9 ? 2 : 1, rng() > 0.9 ? 2 : 1);
  }
  // smog band
  const smog = ctx.createLinearGradient(0, H * 0.45, 0, H * 0.8);
  smog.addColorStop(0, 'rgba(0,0,0,0)'); smog.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = smog; ctx.fillRect(0, H * 0.45, W, H * 0.35);
  // far skyline silhouettes — two parallax depths baked in
  for (let layer = 0; layer < 2; layer++) {
    const baseY = H - 40 - layer * 26;
    ctx.fillStyle = layer === 0 ? shade(p.skyline, 6) : p.skyline;
    let x = -20;
    while (x < W + 40) {
      const bw = 60 + rng() * 130;
      const bh = 90 + rng() * 260 - layer * 60;
      ctx.fillRect(x, baseY - bh, bw, bh + 60);
      // rooftop clutter
      if (rng() > 0.6) ctx.fillRect(x + bw * 0.2, baseY - bh - 14, 8, 14);
      if (rng() > 0.6) ctx.fillRect(x + bw * 0.6, baseY - bh - 20, 4, 20);
      // sparse lit windows in the distance
      for (let wx = x + 8; wx < x + bw - 10; wx += 16) {
        for (let wy = baseY - bh + 10; wy < baseY - 20; wy += 20) {
          if (rng() > 0.965) { ctx.fillStyle = 'rgba(255,200,130,0.5)'; ctx.fillRect(wx, wy, 4, 6); ctx.fillStyle = layer === 0 ? shade(p.skyline, 6) : p.skyline; }
        }
      }
      x += bw + 4 + rng() * 26;
    }
  }
  // ground smoke
  const fog2 = ctx.createLinearGradient(0, H - 160, 0, H);
  fog2.addColorStop(0, 'rgba(0,0,0,0)'); fog2.addColorStop(1, p.fogColor);
  ctx.fillStyle = fog2; ctx.fillRect(0, H - 160, W, 160);
  return toTex(canvas);
}

// soft radial sprite (dust / muzzle / glow)
export function softSpriteTexture(inner = 'rgba(255,255,255,1)'): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, inner); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return toTex(canvas);
}

// splatter sprite (blood particles + decals)
export function bloodSpriteTexture(seed = 5): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  const rng = mulberry32(seed);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, d = rng() * 44;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const r = 2 + rng() * (i === 0 ? 22 : 9);
    ctx.fillStyle = `rgba(255,255,255,${0.5 + rng() * 0.5})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 5; i++) { // streaks
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    const a = rng() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 + Math.cos(a) * (30 + rng() * 30), 64 + Math.sin(a) * (30 + rng() * 30)); ctx.stroke();
  }
  return toTex(canvas);
}

// star-shaped muzzle flash sprite
export function muzzleSpriteTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.translate(64, 64);
  const spikes = 4;
  for (let i = 0; i < spikes; i++) {
    ctx.rotate(Math.PI / spikes);
    const g = ctx.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, 'rgba(255,240,190,1)'); g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(58, 0); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
  }
  const c = ctx.createRadialGradient(0, 0, 1, 0, 0, 26);
  c.addColorStop(0, 'rgba(255,255,240,1)'); c.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  return toTex(canvas);
}

// volumetric-looking light cone (street lamp shafts)
export function coneTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(54, 0); ctx.lineTo(74, 0); ctx.lineTo(126, 256); ctx.lineTo(2, 256); ctx.closePath(); ctx.fill();
  const side = ctx.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.25, 'rgba(0,0,0,0)'); side.addColorStop(0.75, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side; ctx.fillRect(0, 0, 128, 256);
  return toTex(canvas);
}

// pool of light on the ground under lamps
export function lightPoolTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.save(); ctx.translate(64, 64); ctx.scale(1, 0.45); ctx.translate(-64, -64);
  ctx.fillRect(0, 0, 128, 128); ctx.restore();
  return toTex(canvas);
}

// neon sign board with glowing text → emissive-looking basic material map
export function signTexture(text: string, color: string, seed = 1): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 160);
  const rng = mulberry32(seed * 7 + 13);
  // housing
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#26262c'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 504, 152);
  ctx.font = `900 ${text.length > 8 ? 62 : 88}px "Arial Narrow", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // tubes (double draw for glow)
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 30;
  ctx.fillStyle = color;
  // some letters dead
  let out = '';
  for (const ch of text) out += (rng() > 0.12 ? ch : ' ');
  ctx.fillText(out, 256, 86); ctx.fillText(out, 256, 86);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `900 ${text.length > 8 ? 62 : 88}px "Arial Narrow", Arial, sans-serif`;
  ctx.globalAlpha = 0.28; ctx.fillText(out, 256, 86); ctx.globalAlpha = 1;
  return toTex(canvas);
}

// generic metal-ish plate (barricades, car bodies)
export function metalTexture(seed: number, base: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = mulberry32(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 2400, rng, 0.1);
  for (let i = 0; i < 12; i++) { // rust
    ctx.fillStyle = `rgba(${100 + rng() * 40},${40 + rng() * 20},16,${0.12 + rng() * 0.22})`;
    ctx.beginPath(); ctx.ellipse(rng() * 256, rng() * 256, 8 + rng() * 28, 6 + rng() * 18, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  cracks(ctx, 256, 256, 5, rng, 'rgba(0,0,0,0.3)');
  return toTex(canvas, true);
}
