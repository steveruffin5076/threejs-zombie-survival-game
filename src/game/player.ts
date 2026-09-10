// ─────────────────────────────────────────────────────────────────────────────
// player.ts — survivor controller: run/sprint/jump physics with coyote time,
// cursor-driven aim rig (the arm+glock tracks the mouse position on the
// gameplay plane), Glock 19 fire cadence (15-round magazine, unlimited
// reserve), reload cycles, shell ejection, procedural walk/idle animation.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { buildPlayer, type PlayerRig } from './models';
import {
  PLAYER_HP, RUN_SPEED, SPRINT_SPEED, JUMP_VEL, GRAVITY,
  MAG_SIZE, RELOAD_TIME, FIRE_COOLDOWN,
} from './state';
import type { Effects } from './effects';
import type { AudioManager } from './audio';

export class Player {
  rig: PlayerRig;
  x = 2; y = 0; vy = 0;
  vx = 0;
  grounded = true;
  private coyote = 0;
  hp = PLAYER_HP;
  alive = true;
  ammo = MAG_SIZE;
  reloading = false;
  private reloadT = 0;
  private fireT = 0;
  facing = 1;
  aimX = 10; aimY = 1.6;             // world-space aim point (from mouse)
  private walkPhase = 0;
  private airT = 0;
  deathT = -1;
  kick = 0;                           // visual recoil

  moveAxis = 0;     // -1..1
  sprint = false;
  jumpQueued = false;
  triggerHeld = false;

  constructor(scene: THREE.Scene) {
    this.rig = buildPlayer();
    scene.add(this.rig.group);
  }

  reset(x: number) {
    this.x = x; this.y = 0; this.vy = 0; this.vx = 0;
    this.hp = PLAYER_HP; this.alive = true;
    this.ammo = MAG_SIZE; this.reloading = false; this.reloadT = 0;
    this.deathT = -1; this.kick = 0;
    this.rig.group.rotation.set(0, 0, 0);
    this.rig.group.position.set(x, 0, 0);
    this.rig.group.visible = true;
  }

  heal(n: number) { this.hp = Math.min(PLAYER_HP, this.hp + n); }

  damage(n: number): boolean {
    if (!this.alive) return false;
    this.hp -= n;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deathT = 0; return true; }
    return false;
  }

  startReload() {
    if (this.reloading || this.ammo === MAG_SIZE || !this.alive) return;
    this.reloading = true;
    this.reloadT = RELOAD_TIME;
  }

  /** attempt a shot — Game performs the actual hitscan when it returns 'fired' */
  tryFire(): 'fired' | 'auto' | 'blocked' {
    if (!this.alive || this.reloading || this.fireT > 0) return 'blocked';
    if (this.ammo <= 0) { this.fireT = 0.3; this.startReload(); return 'auto'; }
    this.ammo--;
    this.fireT = FIRE_COOLDOWN;
    this.kick = Math.min(1, this.kick + 0.55);
    return 'fired';
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.rig.gun.muzzle.getWorldPosition(out);
  }

  update(dt: number, fx: Effects, audio: AudioManager, locked: boolean) {
    const g = this.rig.group;

    // ── death anim ──
    if (!this.alive) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.7);
      g.rotation.z = -Math.PI / 2 * (t * (2 - t)) * 0.9; // crumple backward
      if (this.deathT > 0.5) g.position.y = Math.max(-0.35, g.position.y - dt * 0.5);
      fx.groundDust(this.x, 0, 1);
      return;
    }

    // ── movement ──
    const speed = this.sprint ? SPRINT_SPEED : RUN_SPEED;
    const targetVx = locked ? 0 : this.moveAxis * speed;
    this.vx = THREE.MathUtils.damp(this.vx, targetVx, 14, dt);
    this.x += this.vx * dt;

    if (this.grounded) this.coyote = 0.09; else this.coyote -= dt;
    if (this.jumpQueued && this.coyote > 0 && !locked) {
      this.vy = JUMP_VEL; this.grounded = false; this.coyote = 0;
      audio.jump();
      fx.groundDust(this.x, 0, 3);
    }
    this.jumpQueued = false;

    if (!this.grounded) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      this.airT += dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0; this.grounded = true;
        if (this.airT > 0.18) { audio.land(); fx.groundDust(this.x, 0, 4); }
      }
    } else { this.airT = 0; if (this.vy < 0) this.vy = 0; }

    // ── fire-rate & reload timers ──
    this.fireT -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloading = false; this.ammo = MAG_SIZE; }
    }

    // ── facing + aim ──
    const wantFace = this.aimX >= this.x ? 1 : -1;
    this.facing = targetVx !== 0 ? Math.sign(targetVx) : wantFace;
    const shoulderY = this.y + 1.4;
    let ang = Math.atan2(this.aimY - shoulderY, this.aimX - this.x);
    if (this.facing < 0) ang = Math.PI - ang;
    ang = THREE.MathUtils.clamp(ang, -1.05, 1.05);
    this.kick = Math.max(0, this.kick - dt * 6);
    const aimAngle = ang + this.kick * 0.06;
    g.rotation.y = this.facing > 0 ? 0 : Math.PI;
    this.rig.aim.rotation.z = THREE.MathUtils.damp(this.rig.aim.rotation.z, aimAngle, 22, dt);
    this.rig.aim.position.x = 0.04 - this.kick * 0.05;

    // ── procedural animation ──
    const speed01 = Math.min(1, Math.abs(this.vx) / SPRINT_SPEED);
    if (this.grounded && speed01 > 0.03) {
      this.walkPhase += dt * (6 + speed01 * 7);
      const sw = Math.sin(this.walkPhase) * (0.35 + speed01 * 0.4);
      this.rig.legL.rotation.z = sw;
      this.rig.legR.rotation.z = -sw;
      this.rig.torso.position.y = 0.92 + Math.abs(Math.sin(this.walkPhase)) * 0.04;
      this.rig.torso.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.03 - speed01 * 0.06 * this.facing * 0; // lean handled by aim
      this.rig.head.rotation.z = -ang * 0.2;
    } else if (!this.grounded) {
      // air pose: trail leg back, lead leg tucked
      this.rig.legL.rotation.z = THREE.MathUtils.damp(this.rig.legL.rotation.z, 0.55, 10, dt);
      this.rig.legR.rotation.z = THREE.MathUtils.damp(this.rig.legR.rotation.z, -0.75, 10, dt);
    } else {
      // idle breathing
      const b = Math.sin(performance.now() * 0.002) * 0.02;
      this.rig.legL.rotation.z = THREE.MathUtils.damp(this.rig.legL.rotation.z, 0, 12, dt);
      this.rig.legR.rotation.z = THREE.MathUtils.damp(this.rig.legR.rotation.z, 0, 12, dt);
      this.rig.torso.position.y = 0.92 + b;
      this.rig.head.rotation.z = -ang * 0.2;
    }
    this.rig.aim.position.y = 1.4 + (this.grounded && speed01 > 0.03 ? Math.abs(Math.sin(this.walkPhase)) * 0.03 : 0);

    g.position.set(this.x, this.y, 0);
  }
}
