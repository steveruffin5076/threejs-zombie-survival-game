// ─────────────────────────────────────────────────────────────────────────────
// postfx.ts — HDR post-processing stack:
//   RenderPass → UnrealBloomPass (neon / muzzle / explosions glow)
//   → OutputPass (ACES tone mapping + sRGB) → GradePass
// GradePass adds filmic grain, chromatic aberration, vignette, damage flash,
// low-health pulse and scene fades — all LDR-safe after the OutputPass.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    grain: { value: 0.055 },
    vignette: { value: 0.55 },
    ca: { value: 0.0016 },
    damage: { value: 0 },
    lowHp: { value: 0 },
    fade: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, grain, vignette, ca, damage, lowHp, fade;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // chromatic aberration, stronger at edges
      vec2 off = d * (ca * (1.0 + r2 * 6.0)) * 60.0 / 60.0 * 10.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off * 0.1).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + off * 0.1).b;
      // vignette
      float vig = 1.0 - vignette * smoothstep(0.12, 0.62, r2);
      col *= vig;
      // grain
      float g = rand(vUv * 1.7 + fract(time) * 13.7);
      col += (g - 0.5) * grain * (0.6 + r2);
      // damage + low-hp red creep from the edges
      float edge = smoothstep(0.08, 0.55, r2);
      float red = damage * (0.24 + 0.5 * edge) + lowHp * edge * 0.55;
      col = mix(col, vec3(0.42, 0.015, 0.02), clamp(red, 0.0, 0.85));
      // fade to black
      col *= (1.0 - fade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.75, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); this.bloom.setSize(w, h); }

  setBloom(strength: number) { this.bloom.strength = strength; }

  /** all values 0..1 unless noted */
  set(opts: { damage?: number; lowHp?: number; fade?: number }) {
    if (opts.damage !== undefined) this.grade.uniforms.damage.value = opts.damage;
    if (opts.lowHp !== undefined) this.grade.uniforms.lowHp.value = opts.lowHp;
    if (opts.fade !== undefined) this.grade.uniforms.fade.value = opts.fade;
  }

  render(dt: number) {
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }

  dispose() { this.composer.dispose(); }
}
