// ─────────────────────────────────────────────────────────────────────────────
// effects.ts — pooled particle/vfx systems. Everything is allocated up-front
// and recycled so the 60fps loop never triggers GC spikes:
//   • SparkSystem  — one GPU point cloud (embers, blood spray, muzzle sparks)
//   • Puffs        — sprite pool (blood mist, smoke, dust) w/ gravity + fade
//   • Casings      — ejected 9mm brass with bounce physics
//   • Tracers      — hitscan tracer streaks
//   • Flash/lights — muzzle flash sprite+light, explosion flash lights
//   • Splats       — persistent ground blood decals
//   • AmbientDust  — drifting ash/motes around the camera
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { softSpriteTexture, bloodSpriteTexture, muzzleSpriteTexture, mulberry32 } from './textures';

const rng = mulberry32(0xC0FFEE);
const R = () => rng();
const RS = (s: number) => (rng() - 0.5) * 2 * s;

// ─── GPU point sparks ────────────────────────────────────────────────────────
class SparkSystem {
  private pts: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private cursor = 0;
  private cap: number;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, cap = 900) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softSpriteTexture() } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aLife;
        varying vec3 vColor; varying float vA;
        void main(){
          vColor = aColor;
          vA = smoothstep(0.0, 0.15, aLife) * aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (170.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec3 vColor; varying float vA;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vColor * a * vA, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.pts = new THREE.Points(this.geo, mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    r: number, g: number, b: number, size: number, life: number, grav: number) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.life[i] = 1; this.maxLife[i] = life; this.grav[i] = grav;
  }

  update(dt: number) {
    const n = this.cap;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) { this.life[i] = 0; continue; }
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] < -4) { // ground stop for droplets
        this.pos[i * 3 + 1] = 0.02; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] *= 0.6;
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ─── sprite puffs (blood mist / smoke / dust) ────────────────────────────────
interface Puff {
  s: THREE.Sprite; m: THREE.SpriteMaterial;
  vel: THREE.Vector3; life: number; maxLife: number;
  s0: number; s1: number; grav: number; drag: number; spin: number; a0: number;
}
class PuffPool {
  private pool: Puff[] = [];
  constructor(scene: THREE.Scene, cap: number, tex: THREE.Texture, blending: THREE.Blending) {
    for (let i = 0; i < cap; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false; s.scale.setScalar(0.001);
      scene.add(s);
      this.pool.push({ s, m, vel: new THREE.Vector3(), life: 0, maxLife: 1, s0: 1, s1: 2, grav: 0, drag: 1, spin: 0, a0: 0.8 });
    }
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    color: THREE.Color, a0: number, s0: number, s1: number, life: number, grav = 0, drag = 1) {
    const p = this.pool.find(q => q.life <= 0) ?? this.pool[0];
    p.s.visible = true;
    p.s.position.set(x, y, z);
    p.m.color.copy(color); p.m.opacity = a0; p.m.rotation = R() * Math.PI * 2;
    p.vel.set(vx, vy, vz);
    p.life = life; p.maxLife = life; p.s0 = s0; p.s1 = s1; p.grav = grav; p.drag = drag; p.a0 = a0;
    p.spin = RS(2);
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; p.m.opacity = 0; continue; }
      const t = 1 - p.life / p.maxLife;
      p.vel.y += p.grav * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.s.position.addScaledVector(p.vel, dt);
      const sc = p.s0 + (p.s1 - p.s0) * t;
      p.s.scale.set(sc, sc, 1);
      p.m.opacity = p.a0 * (1 - t) * (1 - t);
      p.m.rotation += p.spin * dt;
    }
  }
}

// ─── main effects facade ─────────────────────────────────────────────────────
export class Effects {
  private sparks: SparkSystem;
  private blood: PuffPool;
  private smoke: PuffPool;
  private casings: { m: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  private casingCursor = 0;
  private tracers: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private splats: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private splatCursor = 0;
  private flash: THREE.Sprite;
  private flashMat: THREE.SpriteMaterial;
  private flashT = 0;
  muzzleLight: THREE.PointLight;
  private boomLights: THREE.PointLight[] = [];
  private boomCursor = 0;
  private dust!: THREE.Points;
  private dustPos!: Float32Array;
  private dustBase: Float32Array = new Float32Array(0);
  private hitmark: THREE.Sprite;
  private hitmarkMat: THREE.SpriteMaterial;
  private hitmarkT = 0;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparks = new SparkSystem(scene);
    this.blood = new PuffPool(scene, 160, bloodSpriteTexture(), THREE.NormalBlending);
    this.smoke = new PuffPool(scene, 150, softSpriteTexture(), THREE.NormalBlending);

    // muzzle flash sprite + light
    this.flashMat = new THREE.SpriteMaterial({ map: muzzleSpriteTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.visible = false; this.flash.renderOrder = 20;
    scene.add(this.flash);
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 7, 2);
    scene.add(this.muzzleLight);

    for (let i = 0; i < 2; i++) { // explosion flash lights
      const l = new THREE.PointLight(0xff7a30, 0, 16, 2);
      scene.add(l); this.boomLights.push(l);
    }

    // shell casings
    const brassGeo = new THREE.BoxGeometry(0.07, 0.028, 0.028);
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xb8934a, metalness: 0.75, roughness: 0.35 });
    for (let i = 0; i < 110; i++) {
      const m = new THREE.Mesh(brassGeo, brassMat);
      m.visible = false; m.castShadow = false;
      scene.add(m);
      this.casings.push({ m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }

    // hitscan tracers
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.016, 0.016), mat);
      m.visible = false;
      scene.add(m);
      this.tracers.push({ m, mat, life: 0 });
    }

    // persistent ground blood splats
    const splatTex = bloodSpriteTexture(21);
    for (let i = 0; i < 44; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: splatTex, color: 0x5c0a0e, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2;
      scene.add(m);
      this.splats.push({ m, mat, life: 0 });
    }

    // hit marker
    this.hitmarkMat = new THREE.SpriteMaterial({ map: softSpriteTexture(), color: 0xff5040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.hitmark = new THREE.Sprite(this.hitmarkMat);
    this.hitmark.visible = false;
    scene.add(this.hitmark);

    this.buildDust();
  }

  // drifting ash / dust motes around the camera
  private buildDust() {
    const cap = 210;
    this.dustPos = new Float32Array(cap * 3);
    this.dustBase = new Float32Array(cap * 3);
    for (let i = 0; i < cap; i++) {
      this.dustBase[i * 3] = RS(20); this.dustBase[i * 3 + 1] = 0.2 + R() * 7; this.dustBase[i * 3 + 2] = -5 + R() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      map: softSpriteTexture(), size: 0.14, transparent: true, opacity: 0.32,
      color: 0x93a2b8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  // ── spawners ───────────────────────────────────────────────────────────────
  muzzle(x: number, y: number, z: number, angle: number, scale = 1) {
    this.flash.visible = true;
    this.flash.position.set(x, y, z);
    this.flash.scale.setScalar((0.55 + R() * 0.35) * scale);
    this.flashMat.rotation = angle + RS(0.35);
    this.flashMat.opacity = 0.95;
    this.flashT = 0.05;
    this.muzzleLight.position.set(x, y, z + 0.4);
    this.muzzleLight.intensity = 26 * scale;
    for (let i = 0; i < 3; i++) {
      const a = angle + RS(0.4);
      this.sparks.spawn(x, y, z, Math.cos(a) * (5 + R() * 4), Math.sin(a) * (5 + R() * 4) + 1, RS(1.4), 1, 0.75, 0.35, 0.16, 0.1 + R() * 0.08, -6);
    }
  }

  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w = 0.016, color = 0xffe8b0) {
    const t = this.tracers.find(q => q.life <= 0) ?? this.tracers[0];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    t.m.visible = true;
    t.m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    t.m.scale.set(len, w / 0.016, w / 0.016);
    t.m.rotation.z = Math.atan2(dy, dx);
    t.mat.color.setHex(color);
    t.mat.opacity = 0.85; t.life = 0.07;
  }

  casing(x: number, y: number, z: number, face: number) {
    let c = this.casings.find(q => q.life <= 0);
    if (!c) { c = this.casings[this.casingCursor]; this.casingCursor = (this.casingCursor + 1) % this.casings.length; }
    c.m.visible = true;
    c.m.position.set(x, y, z);
    c.vel.set(-face * (0.7 + R() * 0.9), 2.3 + R() * 1.2, RS(1.4));
    c.spin.set(RS(20), RS(20), RS(20));
    c.life = 5 + R() * 2;
  }

  bloodBurst(x: number, y: number, z: number, dirX: number, amount = 1, headshot = false) {
    const c = new THREE.Color(0.28, 0.02, 0.03);
    const n = Math.max(1, Math.round((headshot ? 7 : 4) * amount));
    for (let i = 0; i < n; i++) {
      this.blood.spawn(x, y + RS(0.2), z + RS(0.12), dirX * (0.8 + R() * 2) + RS(1), 1 + R() * 2.4, RS(0.8),
        c, 0.85, 0.1 + R() * 0.12, 0.34 + R() * 0.3, 0.5 + R() * 0.4, -11, 0.94);
    }
    for (let i = 0; i < (headshot ? 8 : 4); i++) { // dark red droplet sparks
      this.sparks.spawn(x, y, z, dirX * (1 + R() * 3) + RS(1.4), 1.5 + R() * 2.5, RS(1),
        0.5, 0.03, 0.04, 0.12, 0.4 + R() * 0.3, -12);
    }
  }

  splat(x: number, z: number, big = false) {
    const s = this.splats[this.splatCursor]; this.splatCursor = (this.splatCursor + 1) % this.splats.length;
    s.m.visible = true;
    s.m.position.set(x + RS(0.2), 0.02 + this.splatCursor * 0.0004, z + RS(0.2) - 0.6);
    s.m.rotation.z = R() * Math.PI * 2;
    const sc = big ? 1.5 + R() : 0.55 + R() * 0.6;
    s.m.scale.set(sc, sc, 1);
    s.mat.opacity = 0.85; s.life = 26;
  }

  groundDust(x: number, z: number, n = 4) {
    const c = new THREE.Color(0.23, 0.22, 0.2);
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(x + RS(0.25), 0.12, z + RS(0.2), RS(1), 0.4 + R() * 0.6, RS(0.5), c, 0.4, 0.16, 0.7 + R() * 0.5, 0.7 + R() * 0.5, 0.4, 0.9);
    }
  }

  sparkImpact(x: number, y: number, z: number) {
    for (let i = 0; i < 6; i++) {
      this.sparks.spawn(x, y, z, RS(4), R() * 3.5, RS(2), 1, 0.8, 0.5, 0.1, 0.22 + R() * 0.12, -10);
    }
    this.groundDust(x, z, 2);
  }

  hitMarker(x: number, y: number, z: number, headshot: boolean) {
    this.hitmark.visible = true;
    this.hitmark.position.set(x, y, z + 0.3);
    this.hitmark.scale.setScalar(headshot ? 0.42 : 0.26);
    this.hitmarkMat.color.setHex(headshot ? 0xff2828 : 0xffd0c0);
    this.hitmarkMat.opacity = 0.9;
    this.hitmarkT = 0.12;
  }

  explosion(x: number, y: number, z: number) {
    for (let i = 0; i < 34; i++) { // fireball sparks
      const a = R() * Math.PI * 2, sp = 2 + R() * 7;
      this.sparks.spawn(x, y + 0.4, z, Math.cos(a) * sp, R() * 6, Math.sin(a) * sp * 0.4,
        1, 0.42 + R() * 0.3, 0.1, 0.34, 0.5 + R() * 0.5, -7);
    }
    const smokeC = new THREE.Color(0.16, 0.13, 0.11);
    for (let i = 0; i < 10; i++) {
      this.smoke.spawn(x + RS(0.6), y + 0.5 + R() * 0.8, z + RS(0.3), RS(1.2), 1 + R() * 1.6, RS(0.5),
        smokeC, 0.55, 0.5, 2.2 + R() * 1.4, 1.4 + R() * 0.8, 1.2, 0.93);
    }
    const fireC = new THREE.Color(1, 0.45, 0.12);
    for (let i = 0; i < 5; i++) {
      this.smoke.spawn(x + RS(0.4), y + 0.4, z + RS(0.2), RS(1), 1 + R() * 2, RS(0.5),
        fireC, 0.9, 0.4, 1.5 + R(), 0.35 + R() * 0.2, 0, 0.92);
    }
    const l = this.boomLights[this.boomCursor]; this.boomCursor = (this.boomCursor + 1) % this.boomLights.length;
    l.position.set(x, y + 1, z + 0.6);
    l.intensity = 160;
  }

  zombiePoof(x: number, y: number, z: number, color: THREE.Color) { // despawn mist for far zombies
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn(x, y + R(), z, RS(0.4), 0.5 + R() * 0.5, RS(0.3), color, 0.3, 0.3, 1.1, 0.8, 0.3, 0.95);
    }
  }

  /** ambient environmental emitters fed by StageWorld.emitters */
  ambient(x: number, y: number, z: number, kind: 'smoke' | 'ember' | 'steam') {
    if (kind === 'smoke') {
      const c = new THREE.Color(0.05, 0.045, 0.04);
      this.smoke.spawn(x, y, z, RS(0.15), 0.45 + R() * 0.35, RS(0.08), c, 0.34, 0.3, 1.4 + R(), 2.4 + R(), 0.3, 0.97);
    } else if (kind === 'ember') {
      for (let i = 0; i < 7; i++) {
        this.sparks.spawn(x, y, z, RS(2.4), 1 + R() * 2.4, RS(1.2), 1, 0.62, 0.18, 0.14, 0.5 + R() * 0.4, -9);
      }
      const c = new THREE.Color(0.1, 0.08, 0.06);
      this.smoke.spawn(x, y - 0.2, z, 0, 0.5, 0, c, 0.4, 0.2, 0.9, 1.2, 0.4, 0.95);
    } else {
      const c = new THREE.Color(0.32, 0.36, 0.4);
      this.smoke.spawn(x, y, z, RS(0.2), 0.5 + R() * 0.4, 0.12, c, 0.16, 0.24, 0.9 + R() * 0.5, 1.6 + R(), 0.5, 0.97);
    }
  }

  // ── frame update ───────────────────────────────────────────────────────────
  update(dt: number, camX: number, tNow: number) {
    this.sparks.update(dt);
    this.blood.update(dt);
    this.smoke.update(dt);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashMat.opacity = 0; }
    }
    this.muzzleLight.intensity *= Math.pow(0.0001, dt);
    if (this.muzzleLight.intensity < 0.05) this.muzzleLight.intensity = 0;
    for (const l of this.boomLights) {
      l.intensity *= Math.pow(0.001, dt);
      if (l.intensity < 0.05) l.intensity = 0;
    }

    if (this.hitmarkT > 0) {
      this.hitmarkT -= dt;
      this.hitmarkMat.opacity = Math.max(0, this.hitmarkT / 0.12) * 0.9;
      if (this.hitmarkT <= 0) this.hitmark.visible = false;
    }

    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.m.visible = false; continue; }
      c.vel.y -= 13 * dt;
      c.m.position.addScaledVector(c.vel, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
      if (c.m.position.y < 0.035) {
        c.m.position.y = 0.035;
        if (Math.abs(c.vel.y) > 0.6) { c.vel.y *= -0.38; c.vel.x *= 0.55; c.vel.z *= 0.55; }
        else { c.vel.set(0, 0, 0); c.spin.multiplyScalar(0.1); }
      }
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.m.visible = false;
    }

    for (const s of this.splats) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life < 4) s.mat.opacity = Math.max(0, s.life / 4) * 0.85;
      if (s.life <= 0) s.m.visible = false;
    }

    // ambient dust: lazy spiral drift around the camera, wraps in a 40u volume
    const cap = this.dustBase.length / 3;
    for (let i = 0; i < cap; i++) {
      const bx = this.dustBase[i * 3], by = this.dustBase[i * 3 + 1], bz = this.dustBase[i * 3 + 2];
      const drift = tNow * (0.12 + (i % 7) * 0.02);
      let x = camX + ((bx - drift) % 40);
      if (x < camX - 20) x += 40;
      this.dustPos[i * 3] = x;
      this.dustPos[i * 3 + 1] = by + Math.sin(tNow * 0.4 + i) * 0.35;
      this.dustPos[i * 3 + 2] = bz;
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  reset() { // clear transient fx between stages (splats fade out fast)
    for (const s of this.splats) { s.life = Math.min(s.life, 1.2); }
    for (const c of this.casings) { c.life = Math.min(c.life, 0.4); }
  }
}
