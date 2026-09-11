// ─────────────────────────────────────────────────────────────────────────────
// world.ts — builds a full stage: procedural urban-ruin corridor with two
// parallax building rows, graffiti, neon signs, flickering streetlights,
// wrecked cars, fences, debris, corpses, distant walker silhouettes, a
// per-act sky backdrop — and the SAFE HOUSE objective at the far right.
// Only two pooled point lights are reassigned per frame to the nearest lamps
// + two for neon, so real-time light count stays tiny.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { ActPalette } from './state';
import {
  asphaltTexture, concreteTexture, facadeTextures, graffitiTexture, fenceTexture,
  skyTexture, coneTexture, lightPoolTexture, signTexture, metalTexture, softSpriteTexture, mulberry32,
} from './textures';
import { buildSilhouette } from './models';

// scale a geometry's UVs instead of cloning textures (keeps VRAM tiny)
function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// ── module-level shared caches (never disposed) ──────────────────────────────
const SHARED = {
  loaded: false,
  facadeMats: [] as THREE.MeshStandardMaterial[],
  darkConcrete: null as unknown as THREE.MeshStandardMaterial,
  asphaltMat: null as unknown as THREE.MeshStandardMaterial,
  curbMat: null as unknown as THREE.MeshStandardMaterial,
  unitBox: null as unknown as THREE.BoxGeometry,
  unitCyl: null as unknown as THREE.CylinderGeometry,
  silhouetteMat: null as unknown as THREE.MeshBasicMaterial,
  midRowMat: null as unknown as THREE.MeshBasicMaterial,
  fenceMat: null as unknown as THREE.MeshStandardMaterial,
  graffitiTex: [] as THREE.CanvasTexture[],
  rubbleMat: null as unknown as THREE.MeshStandardMaterial,
  carBodyA: null as unknown as THREE.MeshStandardMaterial,
  carBodyB: null as unknown as THREE.MeshStandardMaterial,
  tyre: null as unknown as THREE.MeshStandardMaterial,
  glass: null as unknown as THREE.MeshStandardMaterial,
  sand: null as unknown as THREE.MeshStandardMaterial,
  trash: null as unknown as THREE.MeshStandardMaterial,
  barrel: null as unknown as THREE.MeshStandardMaterial,
  barrelToxic: null as unknown as THREE.MeshStandardMaterial,
  coneTex: null as unknown as THREE.CanvasTexture,
  poolTex: null as unknown as THREE.CanvasTexture,
  bunkerMat: null as unknown as THREE.MeshStandardMaterial,
  corpseMat: null as unknown as THREE.MeshStandardMaterial,
  pole: null as unknown as THREE.MeshStandardMaterial,
};

function loadShared() {
  if (SHARED.loaded) return;
  SHARED.loaded = true;
  SHARED.unitBox = new THREE.BoxGeometry(1, 1, 1);
  SHARED.unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  for (let i = 0; i < 7; i++) {
    const { map, emissive } = facadeTextures(i);
    SHARED.facadeMats.push(new THREE.MeshStandardMaterial({
      map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 1.6,
      roughness: 0.94, metalness: 0.0,
    }));
  }
  SHARED.darkConcrete = new THREE.MeshStandardMaterial({ map: concreteTexture(9, '#2c2e30'), roughness: 0.95 });
  SHARED.asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92 });
  SHARED.curbMat = new THREE.MeshStandardMaterial({ map: concreteTexture(21, '#4a4c4e'), roughness: 0.95 });
  SHARED.silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x030507 });
  SHARED.midRowMat = new THREE.MeshBasicMaterial({ color: 0x05070b });
  SHARED.fenceMat = new THREE.MeshStandardMaterial({
    map: fenceTexture(), transparent: false, alphaTest: 0.35, side: THREE.DoubleSide,
    color: 0x9aa2a8, metalness: 0.6, roughness: 0.5,
  });
  for (let i = 0; i < 8; i++) SHARED.graffitiTex.push(graffitiTexture(i));
  SHARED.rubbleMat = new THREE.MeshStandardMaterial({ map: concreteTexture(55, '#4b4a47'), roughness: 1 });
  SHARED.carBodyA = new THREE.MeshStandardMaterial({ map: metalTexture(3, '#4a3428'), roughness: 0.8, metalness: 0.3 });
  SHARED.carBodyB = new THREE.MeshStandardMaterial({ map: metalTexture(8, '#2e3438'), roughness: 0.7, metalness: 0.4 });
  SHARED.tyre = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 1 });
  SHARED.glass = new THREE.MeshStandardMaterial({ color: 0x111a20, roughness: 0.25, metalness: 0.6 });
  SHARED.sand = new THREE.MeshStandardMaterial({ color: 0x4d4636, roughness: 1 });
  SHARED.trash = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6 });
  SHARED.barrel = new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.8, metalness: 0.3 });
  SHARED.barrelToxic = new THREE.MeshStandardMaterial({ color: 0x39442c, roughness: 0.7, metalness: 0.3, emissive: 0x2aff4a, emissiveIntensity: 0.35 });
  SHARED.coneTex = coneTexture();
  SHARED.poolTex = lightPoolTexture();
  SHARED.bunkerMat = new THREE.MeshStandardMaterial({ map: concreteTexture(91, '#3f4143'), roughness: 0.9 });
  SHARED.corpseMat = new THREE.MeshStandardMaterial({ color: 0x1d1c20, roughness: 1 });
  SHARED.pole = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6, metalness: 0.6 });
}

// ── public types ─────────────────────────────────────────────────────────────
export interface Emitter { x: number; y: number; z: number; kind: 'smoke' | 'ember' | 'steam'; t: number }
interface Lamp { x: number; z: number; on: boolean; seed: number; lens: THREE.MeshBasicMaterial; cone: THREE.MeshBasicMaterial; pool: THREE.MeshBasicMaterial }
interface Sign { x: number; y: number; z: number; mat: THREE.MeshBasicMaterial; flicker: boolean; seed: number }

export class StageWorld {
  group = new THREE.Group();
  houseX: number;
  length: number;
  minX: number;
  maxX: number;
  arena: boolean;
  emitters: Emitter[] = [];
  private lamps: Lamp[] = [];
  private signs: Sign[] = [];
  private lampLights: THREE.PointLight[] = [];
  private neonLights: THREE.PointLight[] = [];
  private silhouettes: { g: THREE.Group; lL: THREE.Group; lR: THREE.Group; speed: number; seed: number }[] = [];
  private disposables: { dispose(): void }[] = [];
  private flag!: THREE.Group;
  private flagCloth!: THREE.Mesh;
  private flagMat!: THREE.MeshStandardMaterial;
  private beacon!: THREE.Group;
  private doorLight!: THREE.PointLight;
  private houseSignMat!: THREE.MeshBasicMaterial;
  private skyMesh!: THREE.Mesh;
  private moonCore!: THREE.Sprite;
  private moonGlow!: THREE.Sprite;
  private emberGlows: { m: THREE.MeshBasicMaterial; seed: number }[] = [];
  flagLit = false;
  private palette: ActPalette;
  private swayMeshes: { m: THREE.Mesh; seed: number }[] = [];

  constructor(act: number, stage: number, length: number, palette: ActPalette, opts?: { arena?: boolean }) {
    loadShared();
    this.palette = palette;
    this.arena = !!opts?.arena;
    this.length = length;
    this.houseX = this.arena ? length + 999 : length - 7; // unreachable in arena mode
    this.minX = this.arena ? 10 : 1.1;
    this.maxX = this.arena ? length - 10 : length - 8.4;
    const rng = mulberry32(act * 7919 + stage * 104729 + 7);

    this.buildSky(act, rng);
    this.buildGround(length, rng);
    this.buildMidRow(length, rng);
    this.buildFrontRow(length, act, rng);
    this.buildStreetProps(length, act, rng);
    if (this.arena) this.buildBarricades(); else this.buildSafeHouse(act);
    this.buildSilhouettes(length, rng);

    // pooled light rigs
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(palette.lampColor, 0, 11, 1.8);
      this.group.add(l); this.lampLights.push(l);
      const n = new THREE.PointLight(palette.signColors[i % palette.signColors.length], 0, 8, 2);
      this.group.add(n); this.neonLights.push(n);
    }
  }

  // ── sky plane + moon ───────────────────────────────────────────────────────
  private buildSky(act: number, rng: () => number) {
    const tex = skyTexture(this.palette, act);
    this.disposables.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
    this.disposables.push(mat);
    const geo = new THREE.PlaneGeometry(150, 56);
    this.disposables.push(geo);
    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.position.set(0, 15, -34);
    this.group.add(this.skyMesh);
    // moon (small hot core + halo so bloom blooms it)
    const soft = softSpriteTexture(); this.disposables.push(soft);
    const glowMat = new THREE.SpriteMaterial({ map: soft, color: this.palette.moonColor, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const coreMat = new THREE.SpriteMaterial({ map: soft, color: 0xfff4e0, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.disposables.push(glowMat, coreMat);
    this.moonGlow = new THREE.Sprite(glowMat); this.moonGlow.scale.setScalar(14);
    this.moonCore = new THREE.Sprite(coreMat); this.moonCore.scale.setScalar(3.6 + rng() * 1.5);
    this.group.add(this.moonGlow, this.moonCore);
  }

  // ── ground / kerb / sidewalk ───────────────────────────────────────────────
  private buildGround(length: number, rng: () => number) {
    const L = length + 90;
    const gGeo = scaleUV(new THREE.PlaneGeometry(L, 8.4), L / 8, 1);
    this.disposables.push(gGeo);
    const ground = new THREE.Mesh(gGeo, SHARED.asphaltMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(length / 2, 0, 0.6);
    ground.receiveShadow = true;
    this.group.add(ground);

    const sw = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(L, 0.16, 2.8), L / 4, 1), SHARED.curbMat);
    this.disposables.push(sw.geometry);
    sw.position.set(length / 2, 0.05, -4.35);
    sw.receiveShadow = true;
    this.group.add(sw);

    // kerb edge highlight
    const kerb = new THREE.Mesh(SHARED.unitBox, SHARED.curbMat);
    kerb.scale.set(L, 0.17, 0.14);
    kerb.position.set(length / 2, 0.06, -3.62);
    kerb.receiveShadow = true;
    this.group.add(kerb);

    // potholes
    for (let i = 0; i < length / 26; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.4 + rng() * 0.6, 10),
        new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 1 }));
      this.disposables.push(p.geometry, p.material);
      p.rotation.x = -Math.PI / 2;
      p.position.set(rng() * length, 0.012, -2.4 + rng() * 4.5);
      p.receiveShadow = true;
      this.group.add(p);
    }
  }

  // ── far building silhouettes (parallax layer 2) ────────────────────────────
  private buildMidRow(length: number, rng: () => number) {
    let x = -25;
    while (x < length + 40) {
      const w = 7 + rng() * 9, h = 9 + rng() * 13;
      const b = new THREE.Mesh(SHARED.unitBox, SHARED.midRowMat);
      b.scale.set(w, h, 2);
      b.position.set(x + w / 2, h / 2, -9 - rng() * 3.5);
      this.group.add(b);
      if (rng() > 0.6) { // rooftop block / antenna
        const a = new THREE.Mesh(SHARED.unitBox, SHARED.midRowMat);
        a.scale.set(0.3 + rng() * 1.4, 1 + rng() * 2.4, 1);
        a.position.set(x + w * rng(), h + a.scale.y / 2, b.position.z);
        this.group.add(a);
      }
      x += w + 2 + rng() * 7;
    }
  }

  // ── hero facades with windows, graffiti, neon ──────────────────────────────
  private buildFrontRow(length: number, act: number, rng: () => number) {
    const SIGN_WORDS = ['HOTEL', 'LIQUOR', 'PAWN', 'GUNS', 'BAR', 'GAS', 'FOOD', 'MOTEL', 'EVAC', 'CLINIC'];
    let x = -14;
    let signCount = 0;
    while (x < length + 34) {
      const w = 6 + Math.floor(rng() * 4) + rng();
      const ruin = rng() < 0.16;
      const h = ruin ? 1.6 + rng() * 2 : 5.5 + rng() * 7.5;
      const inHouseZone = x + w > this.houseX - 9 && x < this.houseX + 8;
      if (!inHouseZone) {
        const geo = scaleUV(new THREE.BoxGeometry(w, h, 0.7), Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 6)));
        this.disposables.push(geo);
        const skin = SHARED.facadeMats[Math.floor(rng() * SHARED.facadeMats.length)];
        const mats = [SHARED.darkConcrete, SHARED.darkConcrete, SHARED.darkConcrete, SHARED.darkConcrete, skin, SHARED.darkConcrete];
        const b = new THREE.Mesh(geo, mats);
        b.position.set(x + w / 2, h / 2 + 0.14, -3.95);
        b.castShadow = true; b.receiveShadow = true;
        this.group.add(b);

        if (ruin) { // rubble on top + spill
          for (let i = 0; i < 4 + Math.floor(rng() * 4); i++) {
            const r = new THREE.Mesh(SHARED.unitBox, SHARED.rubbleMat);
            const s = 0.25 + rng() * 0.7;
            r.scale.set(s, s * (0.5 + rng()), s);
            r.position.set(x + rng() * w, h + 0.14 + s * 0.3, -3.9 + rng() * 0.8);
            r.rotation.set(rng() * 3, rng() * 3, rng() * 3);
            r.castShadow = true;
            this.group.add(r);
          }
          for (let i = 0; i < 3; i++) {
            const r = new THREE.Mesh(SHARED.unitBox, SHARED.rubbleMat);
            const s = 0.2 + rng() * 0.5;
            r.scale.set(s, s * 0.7, s);
            r.position.set(x + rng() * w, s * 0.35, -2.8 + rng() * 1.6);
            r.rotation.set(rng() * 3, rng() * 3, rng() * 3);
            r.castShadow = true;
            this.group.add(r);
          }
        } else {
          // graffiti on street level
          if (rng() > 0.4) {
            const gt = SHARED.graffitiTex[Math.floor(rng() * SHARED.graffitiTex.length)];
            const g = new THREE.Mesh(new THREE.PlaneGeometry(2.6 + rng() * 1.4, 1.4),
              new THREE.MeshBasicMaterial({ map: gt, transparent: true, opacity: 0.8, depthWrite: false }));
            this.disposables.push(g.geometry, g.material);
            g.position.set(x + 1 + rng() * (w - 2), 1 + rng() * 1.4, -3.58);
            this.group.add(g);
          }
          // neon sign
          if (rng() > 0.62 && signCount < 14) {
            signCount++;
            const word = SIGN_WORDS[Math.floor(rng() * SIGN_WORDS.length)];
            const colHex = this.palette.signColors[Math.floor(rng() * this.palette.signColors.length)];
            const tex = signTexture(word, colHex, signCount * 31 + act * 7);
            const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
            this.disposables.push(tex, mat);
            const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.66), mat);
            this.disposables.push(sign.geometry);
            sign.position.set(x + w * (0.2 + rng() * 0.6), 2.6 + rng() * (h - 3.4), -3.56);
            this.group.add(sign);
            this.signs.push({ x: sign.position.x, y: sign.position.y, z: -3.2, mat, flicker: rng() > 0.4, seed: rng() * 100 });
          }
          // hanging blade sign
          if (rng() > 0.78) {
            const bl = new THREE.Mesh(SHARED.unitBox, SHARED.pole);
            bl.scale.set(0.06, 1.1, 0.5);
            bl.position.set(x + w * rng(), 2.4, -3.3);
            bl.castShadow = true;
            this.group.add(bl);
            this.swayMeshes.push({ m: bl, seed: rng() * 10 });
          }
        }
      }
      x += w + (ruin ? 1.5 : 0.1) + rng() * 1.2;
    }
  }

  // ── street-level props ─────────────────────────────────────────────────────
  private buildStreetProps(length: number, act: number, rng: () => number) {
    // street lamps
    for (let x = 4; x < length + 20; x += 11 + rng() * 8) {
      const broken = rng() < 0.45;
      const lampG = new THREE.Group();
      const pole = new THREE.Mesh(SHARED.unitCyl, SHARED.pole);
      pole.scale.set(0.06, 4.4, 0.06); pole.position.y = 2.2; pole.castShadow = true;
      const arm = new THREE.Mesh(SHARED.unitBox, SHARED.pole);
      arm.scale.set(0.06, 0.06, 0.8); arm.position.set(0, 4.35, 0.4);
      const headM = new THREE.Mesh(SHARED.unitBox, SHARED.pole);
      headM.scale.set(0.14, 0.09, 0.34); headM.position.set(0, 4.32, 0.82);
      const lens = new THREE.MeshBasicMaterial({ color: this.palette.lampColor, transparent: true, opacity: broken ? 0.05 : 0.9 });
      this.disposables.push(lens);
      const lensM = new THREE.Mesh(SHARED.unitBox, lens);
      lensM.scale.set(0.1, 0.03, 0.28); lensM.position.set(0, 4.26, 0.82);
      lampG.add(pole, arm, headM, lensM);

      const coneMat = new THREE.MeshBasicMaterial({
        map: SHARED.coneTex, color: this.palette.lampColor, transparent: true,
        opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      const poolMat = new THREE.MeshBasicMaterial({
        map: SHARED.poolTex, color: this.palette.lampColor, transparent: true,
        opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.disposables.push(coneMat, poolMat);
      const cone = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.4), coneMat);
      this.disposables.push(cone.geometry);
      cone.position.set(0.1, 2.05, 0.82); cone.rotation.z = -0.1;
      lampG.add(cone);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), poolMat);
      this.disposables.push(pool.geometry);
      pool.rotation.x = -Math.PI / 2; pool.position.set(0.15, 0.03, 0.85);
      lampG.add(pool);

      const flick = rng() > 0.5;
      lampG.position.set(x, 0, -2.85);
      this.group.add(lampG);
      if (!broken) {
        this.lamps.push({ x, z: -2.0, on: !flick || rng() > 0.3, seed: rng() * 100, lens, cone: coneMat, pool: poolMat });
      } else if (rng() > 0.55) {
        this.emitters.push({ x, y: 4.2, z: -2.05, kind: 'ember', t: rng() * 4 }); // sparking broken lamp
      }
      if (rng() > 0.985) lampG.rotation.z = 0.06;
    }

    // wrecked cars
    for (let i = 0; i < Math.round(length / 42); i++) {
      const cx = 10 + rng() * (length - 24);
      const car = new THREE.Group();
      const bodyMat = rng() > 0.5 ? SHARED.carBodyA : SHARED.carBodyB;
      const body = new THREE.Mesh(SHARED.unitBox, bodyMat);
      body.scale.set(2.3, 0.52, 1.05); body.position.y = 0.44; body.castShadow = true;
      const cab = new THREE.Mesh(SHARED.unitBox, bodyMat);
      cab.scale.set(1.2, 0.42, 0.95); cab.position.set(-0.15, 0.88, 0); cab.castShadow = true;
      const glass = new THREE.Mesh(SHARED.unitBox, SHARED.glass);
      glass.scale.set(1.14, 0.3, 0.99); glass.position.set(-0.15, 0.9, 0);
      car.add(body, cab, glass);
      for (const [wx, wz] of [[-0.75, 0.5], [0.75, 0.5], [-0.75, -0.5], [0.75, -0.5]] as const) {
        const w = new THREE.Mesh(SHARED.unitCyl, SHARED.tyre);
        w.scale.set(0.26, 0.12, 0.26); w.rotation.x = Math.PI / 2;
        w.position.set(wx, 0.26, wz);
        car.add(w);
      }
      const burnt = act >= 1 && rng() > 0.66;
      if (burnt) {
        const glowM = new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
        this.disposables.push(glowM);
        const glow = new THREE.Mesh(SHARED.unitBox, glowM);
        glow.scale.set(0.8, 0.2, 0.7); glow.position.set(0.3, 0.75, 0);
        car.add(glow);
        this.emberGlows.push({ m: glowM, seed: rng() * 9 });
        this.emitters.push({ x: cx, y: 0.9, z: -2.2, kind: 'smoke', t: rng() * 2 });
      }
      car.position.set(cx, 0, -2.3 - rng() * 0.5);
      car.rotation.y = (rng() - 0.5) * 0.35;
      this.group.add(car);
    }

    // chain-link fences
    for (let i = 0; i < Math.round(length / 55); i++) {
      const fx = 8 + rng() * (length - 20);
      const fw = 3 + rng() * 3;
      const f = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(fw, 1.9), fw / 1.4, 1.2), SHARED.fenceMat);
      this.disposables.push(f.geometry);
      f.position.set(fx, 0.95, -1.7);
      f.castShadow = true;
      this.group.add(f);
      for (const px of [fx - fw / 2, fx + fw / 2]) {
        const p = new THREE.Mesh(SHARED.unitCyl, SHARED.pole);
        p.scale.set(0.035, 1.9, 0.035); p.position.set(px, 0.95, -1.7);
        this.group.add(p);
      }
    }

    // barrels / trash / corpses
    for (let i = 0; i < Math.round(length / 16); i++) {
      const px = 5 + rng() * (length - 8);
      const r = rng();
      if (r < 0.3) {
        const toxic = act >= 2 && rng() > 0.6;
        const b = new THREE.Mesh(SHARED.unitCyl, toxic ? SHARED.barrelToxic : SHARED.barrel);
        b.scale.set(0.28, 0.72, 0.28);
        b.position.set(px, 0.36, -1.1 - rng() * 1.6);
        b.castShadow = true;
        this.group.add(b);
        if (toxic) this.emitters.push({ x: px, y: 0.8, z: b.position.z, kind: 'steam', t: rng() * 3 });
      } else if (r < 0.62) {
        const t = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 5), SHARED.trash);
        this.disposables.push(t.geometry);
        t.scale.set(1, 0.72, 1);
        t.position.set(px, 0.2, -1.2 - rng() * 2);
        t.rotation.y = rng() * 3;
        t.castShadow = true;
        this.group.add(t);
      } else {
        // fallen body
        const c = new THREE.Group();
        const torso = new THREE.Mesh(SHARED.unitBox, SHARED.corpseMat);
        torso.scale.set(0.85, 0.16, 0.34); torso.castShadow = true;
        const head = new THREE.Mesh(SHARED.unitBox, SHARED.corpseMat);
        head.scale.set(0.22, 0.14, 0.2); head.position.set(0.6, 0.01, 0.03);
        const legs = new THREE.Mesh(SHARED.unitBox, SHARED.corpseMat);
        legs.scale.set(0.8, 0.12, 0.26); legs.position.set(-0.8, 0, 0);
        c.add(torso, legs, head);
        c.position.set(px, 0.1, -0.9 - rng() * 2.4);
        c.rotation.y = rng() * Math.PI;
        this.group.add(c);
        this.emitters.push({ x: px, y: 0.1, z: c.position.z, kind: 'steam', t: 99 }); // 99 = inactive kind marker? no: keep inactive via kind
        this.emitters.pop();
      }
    }

    // scattered manhole steam
    for (let i = 0; i < Math.round(length / 50); i++) {
      const px = 8 + rng() * (length - 16);
      this.emitters.push({ x: px, y: 0.1, z: -1.4 + rng() * 2, kind: 'steam', t: rng() * 3 });
    }
  }

  // ── the objective ──────────────────────────────────────────────────────────
  private buildSafeHouse(act: number) {
    const hx = this.houseX;
    const g = new THREE.Group();
    // bunker
    const bunker = new THREE.Mesh(SHARED.unitBox, SHARED.bunkerMat);
    bunker.scale.set(6, 3.8, 2.4);
    bunker.position.set(hx + 1.2, 1.9, -1.8);
    bunker.castShadow = true; bunker.receiveShadow = true;
    g.add(bunker);
    // roof lip + antenna
    const lip = new THREE.Mesh(SHARED.unitBox, SHARED.darkConcrete);
    lip.scale.set(6.4, 0.22, 2.7); lip.position.set(hx + 1.2, 3.9, -1.8);
    g.add(lip);
    const ant = new THREE.Mesh(SHARED.unitCyl, SHARED.pole);
    ant.scale.set(0.03, 2.2, 0.03); ant.position.set(hx + 3.4, 5.1, -2.2);
    g.add(ant);
    const antTip = new THREE.Mesh(SHARED.unitBox, new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    this.disposables.push(antTip.material as THREE.Material);
    antTip.scale.set(0.08, 0.08, 0.08); antTip.position.set(hx + 3.4, 6.25, -2.2);
    g.add(antTip);
    this.swayMeshes.push({ m: antTip, seed: 3 });

    // door on the -x face + flood glow
    const door = new THREE.Mesh(SHARED.unitBox, SHARED.pole);
    door.scale.set(0.12, 2.2, 1.2); door.position.set(hx - 1.85, 1.1, -1.6);
    g.add(door);
    const doorFrame = new THREE.Mesh(SHARED.unitBox, SHARED.darkConcrete);
    doorFrame.scale.set(0.3, 2.5, 1.5); doorFrame.position.set(hx - 1.75, 1.25, -1.6);
    g.add(doorFrame);
    this.doorLight = new THREE.PointLight(0xffd9a0, 2, 9, 2);
    this.doorLight.position.set(hx - 2.2, 2.4, -1.2);
    g.add(this.doorLight);

    // sandbag wall in front
    for (let i = 0; i < 8; i++) {
      const sb = new THREE.Mesh(SHARED.unitBox, SHARED.sand);
      sb.scale.set(0.62, 0.3, 0.42);
      sb.position.set(hx - 3.3 + (i % 2) * 0.1, 0.16 + Math.floor(i / 4) * 0.3, -0.4 + (i % 4) * 0.45);
      sb.rotation.y = (i % 3) * 0.2;
      sb.castShadow = true;
      g.add(sb);
    }
    // barbed barricade silhouettes
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(SHARED.unitBox, SHARED.pole);
      bar.scale.set(0.06, 1.2, 0.06); bar.rotation.z = (i - 1) * 0.5;
      bar.position.set(hx - 4.3, 0.6, -0.8 + i * 0.6);
      g.add(bar);
    }

    // neon SAFE HOUSE sign (hero accent)
    const tex = signTexture('SAFE HOUSE', '#51ff7a', act * 91 + 5);
    this.houseSignMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    this.disposables.push(tex, this.houseSignMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), this.houseSignMat);
    this.disposables.push(sign.geometry);
    sign.position.set(hx + 1.2, 3.15, -0.56);
    g.add(sign);

    // flag pole + flag (this is the HUD-linked beacon that LIGHTS UP)
    const pole = new THREE.Mesh(SHARED.unitCyl, SHARED.pole);
    pole.scale.set(0.045, 2.6, 0.045); pole.position.set(hx - 0.6, 5.2, -1.4);
    g.add(pole);
    this.flagMat = new THREE.MeshStandardMaterial({ color: 0x7a1216, emissive: 0xff2030, emissiveIntensity: 0.12, roughness: 0.9, side: THREE.DoubleSide });
    this.flagCloth = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.6, 6, 1), this.flagMat);
    this.disposables.push(this.flagCloth.geometry, this.flagMat);
    this.flagCloth.position.set(0.56, -0.35, 0); // hangs right of the pole, facing the camera
    this.flag = new THREE.Group();
    this.flag.position.set(hx - 0.6, 6.4, -1.4);
    this.flag.add(this.flagCloth);
    g.add(this.flag);

    // rotating searchlight beacon
    this.beacon = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({
      map: SHARED.coneTex, color: 0xbfe8ff, transparent: true, opacity: 0.16,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.disposables.push(beamMat);
    for (const s of [1, -1]) {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9), beamMat);
      this.disposables.push(beam.geometry);
      beam.position.set(0, 4.5, 0);
      beam.rotation.z = 0.5 * s;
      beam.scale.x = s;
      this.beacon.add(beam);
    }
    this.beacon.position.set(hx + 1.2, 4.05, -1.8);
    g.add(this.beacon);

    // approaching floodlight pool on ground
    const poolM = new THREE.MeshBasicMaterial({ map: SHARED.poolTex, color: 0xc9ffe0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    this.disposables.push(poolM);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), poolM);
    this.disposables.push(pool.geometry);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(hx - 2, 0.03, -0.6);
    g.add(pool);

    this.group.add(g);
    // safe zone should be calm: no props emitters past here
  }

  // ── endless arena: sealed barricades at both ends instead of a safe house ────
  private buildBarricades() {
    for (const bx of [6, this.length - 6]) {
      const block = new THREE.Mesh(SHARED.unitBox, SHARED.bunkerMat);
      block.scale.set(3.2, 2.6, 2.4);
      block.position.set(bx, 1.3, -1.8);
      block.castShadow = true; block.receiveShadow = true;
      this.group.add(block);

      for (let i = 0; i < 2; i++) {
        const car = new THREE.Mesh(SHARED.unitBox, i === 0 ? SHARED.carBodyA : SHARED.carBodyB);
        car.scale.set(2.1, 0.5, 1.0);
        car.position.set(bx + (Math.random() - 0.5) * 0.6, 0.35 + i * 0.55, -0.6 - Math.random() * 0.8);
        car.rotation.y = Math.random() * 0.5;
        car.castShadow = true;
        this.group.add(car);
      }

      const fence = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), SHARED.fenceMat);
      this.disposables.push(fence.geometry);
      fence.position.set(bx, 1.5, -3.4);
      fence.castShadow = true;
      this.group.add(fence);

      for (let i = 0; i < 6; i++) {
        const sb = new THREE.Mesh(SHARED.unitBox, SHARED.sand);
        sb.scale.set(0.62, 0.3, 0.42);
        sb.position.set(bx + ((i % 3) - 1) * 0.65, 0.16 + Math.floor(i / 3) * 0.3, -0.2 + (i % 3) * 0.5);
        sb.castShadow = true;
        this.group.add(sb);
      }

      const beaconM = new THREE.MeshBasicMaterial({ color: 0xff2030 });
      this.disposables.push(beaconM);
      const beacon = new THREE.Mesh(SHARED.unitBox, beaconM);
      beacon.scale.set(0.1, 0.1, 0.1);
      beacon.position.set(bx, 3.0, -1.8);
      this.group.add(beacon);
      this.swayMeshes.push({ m: beacon, seed: Math.random() * 10 });

      this.emitters.push({ x: bx, y: 0.8, z: -1.8, kind: 'smoke', t: Math.random() * 2 });
    }
  }

  private buildSilhouettes(length: number, rng: () => number) {
    for (let i = 0; i < 7; i++) {
      const s = buildSilhouette();
      const shadeMat = SHARED.silhouetteMat;
      s.group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = shadeMat; });
      s.group.position.set(rng() * length, 0, -5.6 - rng() * 2.2);
      this.group.add(s.group);
      this.silhouettes.push({ g: s.group, lL: s.legL, lR: s.legR, speed: 0.15 + rng() * 0.35, seed: rng() * 9 });
    }
  }

  setFlagLit(lit: boolean) { this.flagLit = lit; }

  // ── per-frame world animation + light pooling ──────────────────────────────
  update(dt: number, camX: number, t: number) {
    // sky follows camera, moon keeps a fixed offset → infinite parallax sky
    this.skyMesh.position.x = camX;
    this.moonGlow.position.set(camX + 16, 19, -30);
    this.moonCore.position.set(camX + 16, 19, -29);

    // flag + beacon + sign (safe house only — not built in arena mode)
    if (!this.arena) {
      if (this.flagLit) {
        this.flagMat.emissive.setHex(0x28ff5e);
        this.flagMat.color.setHex(0x12b84a);
        this.flagMat.emissiveIntensity = 1.4 + Math.sin(t * 4) * 0.5;
        this.flagCloth.rotation.y = Math.sin(t * 3.2) * 0.35;
        this.doorLight.intensity = 16 + Math.sin(t * 3) * 3;
      } else {
        this.flagMat.emissive.setHex(0xff2030);
        this.flagMat.emissiveIntensity = 0.14 + Math.sin(t * 1.6) * 0.08;
        this.flagCloth.rotation.y = Math.sin(t * 1.2) * 0.12;
        this.doorLight.intensity = 2.5 + Math.sin(t * 2) * 0.6;
      }
      this.beacon.rotation.y += dt * 0.7;
      this.houseSignMat.opacity = 0.92 + Math.sin(t * 7.3) * 0.08;
    }

    for (const s of this.swayMeshes) s.m.rotation.z = Math.sin(t * 0.9 + s.seed) * 0.06;
    for (const e of this.emberGlows) e.m.opacity = 0.28 + Math.abs(Math.sin(t * 5 + e.seed)) * 0.35;

    // silhouette walkers drift leftward, wrap around the camera
    for (const s of this.silhouettes) {
      s.g.position.x -= s.speed * dt;
      const ph = t * 2.2 + s.seed;
      s.lL.rotation.z = Math.sin(ph) * 0.5;
      s.lR.rotation.z = -Math.sin(ph) * 0.5;
      s.g.rotation.y = Math.PI; // face left
      if (s.g.position.x < camX - 32) s.g.position.x = camX + 34 + Math.random() * 12;
      if (s.g.position.x > camX + 46) s.g.position.x = camX - 30;
    }

    // lamps flicker; two nearest lit ones get the pooled point lights
    let li = 0;
    for (const lamp of this.lamps) {
      const near = Math.abs(lamp.x - camX) < 20;
      let f = lamp.on ? 0.8 + 0.2 * Math.sin(t * 11 + lamp.seed) : 0;
      if (lamp.on && Math.sin(t * 3.1 + lamp.seed * 3.7) > 0.965) f = 0.12; // drop-out
      lamp.lens.opacity = 0.06 + f * 0.9;
      lamp.cone.opacity = f * 0.34;
      lamp.pool.opacity = f * 0.4;
      if (near && f > 0.1 && li < this.lampLights.length) {
        const L = this.lampLights[li++];
        L.position.set(lamp.x, 3.6, lamp.z);
        L.intensity = 22 * f;
      }
    }
    for (; li < this.lampLights.length; li++) this.lampLights[li].intensity = 0;

    // neon signs flicker; two nearest get bounce light
    let ni = 0;
    for (const s of this.signs) {
      let f = 1;
      if (s.flicker) {
        f = 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + s.seed) * Math.sin(t * 1.7 + s.seed * 2));
        if (Math.sin(t * 2.3 + s.seed * 5) > 0.93) f = 0.08;
      }
      s.mat.opacity = 0.25 + f * 0.75;
      if (Math.abs(s.x - camX) < 18 && ni < this.neonLights.length) {
        const L = this.neonLights[ni++];
        L.position.set(s.x, s.y, s.z);
        L.intensity = 7 * f;
      }
    }
    for (; ni < this.neonLights.length; ni++) this.neonLights[ni].intensity = 0;

    // ambient emitter timers handled by Game via this.emitters
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
