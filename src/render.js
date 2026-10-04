// Three.js rendering. Reads a "view" (the Sim on host/offline, a ClientView online)
// and never changes game state. Meshes are built in models.js.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CHARACTERS, TEAM_COLORS, WEAPONS, GAME } from './config.js';
import { lookDir } from './physics.js';
import {
  buildWeapon, buildCharacter, buildViewArm, buildTower, buildArena, buildClouds,
  boxGeo, mat,
} from './models.js';

// Graphics presets: post-processing, shadow resolution and render resolution
export const QUALITY = {
  low: { label: 'Low', post: false, ao: false, shadow: 1024, maxDpr: 1 },
  medium: { label: 'Medium', post: true, ao: false, shadow: 2048, maxDpr: 1.5 },
  high: { label: 'High', post: true, ao: true, shadow: 4096, maxDpr: 2 },
};

// How each weapon is held at rest in first person (rotation about x: + points up)
// Choppers are held up with the flat of the blade toward the camera and the
// edge leaning toward the crosshair, ready to chop.
const VM_REST = {
  machete: { rx: 0.85, ry: -0.1, rz: -0.3 }, axe: { rx: 0.95, ry: -0.15, rz: -0.3 },
  dagger: { rx: 0.15, ry: 0, rz: 0 }, knife: { rx: 0.15, ry: 0, rz: 0 },
  wrench: { rx: 0.55, ry: 0.2, rz: -0.35 }, nailgun: { rx: 0, ry: 0, rz: 0 },
};
const CHOPPERS = new Set(['machete', 'axe']);

// ---------- Text / heart sprites ----------
function makeLabelSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(material);
  s.scale.set(1.6, 0.5, 1);
  s.renderOrder = 10;
  return { sprite: s, canvas, tex, key: '' };
}

function drawLabel(L, name, hearts, max, team, showName) {
  const key = `${name}|${hearts}|${max}|${team}|${showName}`;
  if (L.key === key) return;
  L.key = key;
  const c = L.canvas.getContext('2d');
  c.clearRect(0, 0, 256, 80);
  c.textAlign = 'center';
  if (showName) {
    c.font = 'bold 22px system-ui, sans-serif';
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.strokeText(name, 128, 26);
    c.fillStyle = team === 'yellow' ? '#ffe066' : '#6ff2e8';
    c.fillText(name, 128, 26);
  }
  const size = 26;
  const total = max * size;
  c.font = `${size}px system-ui, sans-serif`;
  for (let i = 0; i < max; i++) {
    const x = 128 - total / 2 + i * size + size / 2;
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.strokeText('♥', x, 66);
    c.fillStyle = i < hearts ? '#ff3b4e' : 'rgba(60,60,60,0.8)';
    c.fillText('♥', x, 66);
  }
  L.tex.needsUpdate = true;
}

function textSprite(text, color, size = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const c = canvas.getContext('2d');
  c.font = `bold ${size}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 6;
  c.strokeStyle = 'rgba(0,0,0,0.75)';
  c.strokeText(text, 64, 32);
  c.fillStyle = color;
  c.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(0.9, 0.45, 1);
  s.renderOrder = 11;
  return s;
}

// ---------- Renderer ----------
export class Renderer {
  constructor(canvas, quality = 'medium') {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcfe8f7);
    this.scene.fog = new THREE.Fog(0xcfe8f7, 70, 260);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Soft image-based light for reflections and fill
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x7a6a4a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
    sun.position.set(25, 45, 15);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.models = new Map();
    this.towerMeshes = new Map();
    this.projMeshes = new Map();
    this.particles = [];
    this.buildPreview = null;
    this.clouds = null;

    // Flashlight pool: fixed count so materials never recompile
    this.spots = [];
    const coneLen = CHARACTERS.longman.flashlightRange;
    const coneR = Math.tan(CHARACTERS.longman.flashlightAngle * Math.PI / 180) * coneLen;
    const coneGeo = new THREE.ConeGeometry(coneR, coneLen, 32, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(Math.PI / 2); // apex at origin, opening toward -z (forward)
    for (let i = 0; i < 5; i++) {
      const light = new THREE.SpotLight(0xfff1c8, 0, coneLen * 1.5, CHARACTERS.longman.flashlightAngle * Math.PI / 180 * 1.15, 0.4, 1.2);
      this.scene.add(light);
      this.scene.add(light.target);
      const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
        color: 0xfff1c8, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }));
      cone.visible = false;
      this.scene.add(cone);
      this.spots.push({ light, cone });
    }

    // First-person viewmodel
    this.vm = new THREE.Group();
    this.camera.add(this.vm);
    this.vmKey = '';
    this.vmSwingT = 9;
    this.vmAnim = 'swing';
    this.vmBob = 0;
    this.vmAttackSeq = -1;

    this.ghostMats = {
      yellow: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.yellow, transparent: true, opacity: 0.22, depthWrite: false }),
      teal: new THREE.MeshBasicMaterial({ color: TEAM_COLORS.teal, transparent: true, opacity: 0.22, depthWrite: false }),
    };
    // Brighter than 1 so the bloom pass makes a revealed Spy shimmer
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.1), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });

    this.composer = null;
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'medium';
    const Q = QUALITY[this.quality];
    this.dpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr);
    this.gl.setPixelRatio(this.dpr);
    if (this.sun.shadow.mapSize.x !== Q.shadow) {
      this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (Q.post) {
      const w = window.innerWidth, h = window.innerHeight;
      // Multisampled HDR target: keeps edges smooth with post-processing on
      const rt = new THREE.WebGLRenderTarget(w * this.dpr, h * this.dpr, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.gl, rt);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (Q.ao) {
        const ao = new GTAOPass(this.scene, this.camera, w, h);
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.2, samples: 12 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        ao.blendIntensity = 0.9;
        composer.addPass(ao);
      }
      // High threshold: only emissive things (visors, nails, glowing Spies) bloom
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.5, 1.6));
      composer.addPass(new OutputPass());
      this.composer = composer;
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.dpr);
      this.composer.setSize(w, h);
    }
  }

  buildMap(map) {
    buildArena(this.scene, map);
    this.clouds = buildClouds(this.scene);
  }

  // ---------- Per-frame ----------

  render(view, opts, dt) {
    // opts: { localId, viewerTeam, camera: {x,y,z,yaw,pitch}, firstPerson: bool, time }
    const cam = this.camera;
    cam.position.set(opts.camera.x, opts.camera.y, opts.camera.z);
    cam.rotation.set(opts.camera.pitch, opts.camera.yaw, 0);

    this.updateCharacters(view, opts, dt);
    this.updateTowers(view, dt, opts.time);
    this.updateProjectiles(view, dt);
    this.updateFlashlights(view, opts);
    this.updateViewmodel(view, opts, dt);
    this.updateParticles(dt);
    if (this.clouds) this.clouds.rotation.y += dt * 0.004;
    if (this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, cam);
  }

  setMode(m, mode, team) {
    const key = mode + team;
    if (m.modeKey === key) return;
    m.modeKey = key;
    m.parts.root.visible = mode !== 'hidden';
    m.parts.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.orig) o.userData.orig = o.material;
      o.material = mode === 'ghost' ? this.ghostMats[team] : mode === 'glow' ? this.glowMat : o.userData.orig;
      o.castShadow = mode === 'normal';
    });
  }

  updateCharacters(view, opts, dt) {
    const seen = new Set();
    for (const e of view.entities) {
      const isLocal = e.id === opts.localId;
      const showDead = !e.alive && e.deathAt !== undefined && opts.time - e.deathAt < 4 && e.char;
      if (!e.alive && !showDead) continue;
      if (view.phase === 'pick' || view.phase === 'lobby') continue;
      seen.add(e.id);
      let m = this.models.get(e.id);
      if (!m || m.char !== e.char || m.team !== e.team) {
        if (m) this.removeModel(m);
        m = this.createModel(e);
        this.models.set(e.id, m);
      }
      const P = m.parts;
      // Visibility mode for the viewer
      let mode = 'normal';
      if (isLocal && opts.firstPerson) mode = 'hidden';
      else if (e.char === 'spy' && e.alive) {
        if (e.team === opts.viewerTeam) mode = 'ghost';
        else mode = e.revealed ? 'glow' : 'hidden';
      }
      this.setMode(m, mode, e.team);
      if (mode === 'glow') this.glowMat.opacity = 0.35 + Math.sin(opts.time * 18) * 0.15;
      if (P.lensMat) P.lensMat.emissiveIntensity = e.flashlight ? 4 : 0;

      P.root.position.set(e.pos.x, e.pos.y, e.pos.z);
      P.root.rotation.y = e.yaw;
      // Walk animation from horizontal movement
      const dx = e.pos.x - (m.lastX ?? e.pos.x), dz = e.pos.z - (m.lastZ ?? e.pos.z);
      m.lastX = e.pos.x; m.lastZ = e.pos.z;
      const speed = dt > 0 ? Math.min(10, Math.hypot(dx, dz) / dt) : 0;
      m.speed += (speed - m.speed) * Math.min(1, dt * 10);
      m.walk += m.speed * dt * 2.6;
      const sw = Math.sin(m.walk) * Math.min(1, m.speed / 3) * 0.7;
      if (P.legL) P.legL.rotation.x = sw;
      if (P.legR) P.legR.rotation.x = -sw;
      if (P.armL) P.armL.rotation.x = e.climbing ? 2.6 - Math.sin(opts.time * 10) * 0.3 : -sw * 0.6;
      if (e.char === 'longman' && e.flashlight && P.armL) P.armL.rotation.x = 1.4 + e.pitch;
      // Footsteps (spies are quiet but audible)
      if (e.alive && e.onGround && m.speed > 1 && !isLocal) {
        m.stepAcc += m.speed * dt;
        if (m.stepAcc > 1.6) { m.stepAcc = 0; this.onStep && this.onStep(e); }
      }

      // Weapon model in hand
      const w = e.weapon || '';
      if (m.weaponId !== w) {
        P.hand.clear();
        P.hand.add(buildWeapon(w));
        m.weaponId = w;
        m.modeKey = '';
      }
      // Attack animation
      if (e.attackSeq !== m.attackSeq) {
        if (m.attackSeq !== undefined) m.swingT = 0;
        m.attackSeq = e.attackSeq;
        m.anim = (WEAPONS[w] || {}).anim || 'swing';
      }
      m.swingT += dt;
      const st = Math.min(1, m.swingT / 0.3);
      // Positive x rotation swings a hanging limb forward
      const gun = w === 'nailgun';
      let armR = (gun ? 1.45 : 0.9) + e.pitch * 0.8; // hold weapon forward
      let spin = 0;
      if (m.swingT < 0.3) {
        if (m.anim === 'swing') armR = 2.8 - st * 2.6;
        else if (m.anim === 'stab' || m.anim === 'punch') armR = 1.5 + Math.sin(st * Math.PI) * 0.2;
        else if (m.anim === 'spin') { armR = 1.6; spin = st * Math.PI * 2; }
        else if (m.anim === 'kick' && P.legR) P.legR.rotation.x = Math.sin(st * Math.PI) * 1.4;
        else if (m.anim === 'shoot') armR += Math.sin(st * Math.PI) * 0.3;
      }
      if (e.climbing) armR = 2.6 + Math.sin(opts.time * 10) * 0.3;
      P.armR.rotation.x = armR;
      // Guns point along the arm; choppers are held up, ready to swing
      P.hand.rotation.x = gun ? Math.PI / 2 - armR : CHOPPERS.has(w) ? 0.25 : -0.4;
      P.body.rotation.y = spin;
      P.body.scale.y = e.crouch ? 0.72 : 1;

      // Death: tip over and sink
      if (!e.alive) {
        const t = Math.min(1, (opts.time - e.deathAt) / 0.5);
        P.body.rotation.x = -t * Math.PI / 2;
        P.root.position.y = e.pos.y - Math.max(0, (opts.time - e.deathAt - 2.5) * 0.5);
      } else {
        P.body.rotation.x = 0;
      }

      // Floating name + hearts
      const showLabel = e.alive && mode !== 'hidden' && !(isLocal && opts.firstPerson);
      m.label.sprite.visible = showLabel;
      if (showLabel) {
        drawLabel(m.label, e.name, e.hearts, e.maxHearts, e.team, e.team === opts.viewerTeam);
        m.label.sprite.position.set(e.pos.x, e.pos.y + CHARACTERS[e.char].height * (e.crouch ? 0.75 : 1) + 0.55, e.pos.z);
      }
    }
    for (const [id, m] of this.models) {
      if (!seen.has(id)) { this.removeModel(m); this.models.delete(id); }
    }
  }

  createModel(e) {
    const parts = buildCharacter(e.char, e.team);
    this.scene.add(parts.root);
    const label = makeLabelSprite();
    this.scene.add(label.sprite);
    return { parts, label, char: e.char, team: e.team, walk: 0, speed: 0, swingT: 9, stepAcc: 0, modeKey: '' };
  }

  removeModel(m) {
    this.scene.remove(m.parts.root);
    this.scene.remove(m.label.sprite);
    if (m.parts.lensMat) m.parts.lensMat.dispose();
  }

  updateTowers(view, dt, time) {
    const seen = new Set();
    for (const t of view.towers) {
      seen.add(t.id);
      let tm = this.towerMeshes.get(t.id);
      if (!tm) {
        tm = this.createTower(t);
        this.towerMeshes.set(t.id, tm);
        tm.grow = 0;
      }
      tm.grow = Math.min(1, tm.grow + dt * 4);
      tm.group.scale.y = tm.grow;
      tm.group.position.set(t.x, t.y, t.z);
      const flag = tm.group.userData.flag;
      if (flag) flag.rotation.y = Math.PI / 2 + Math.sin(time * 4 + t.id) * 0.35;
      if (tm.hp !== t.hp) { tm.shake = 0.3; tm.hp = t.hp; }
      if (tm.shake > 0) {
        tm.shake -= dt;
        tm.group.position.x += (Math.random() - 0.5) * 0.08;
        tm.group.position.z += (Math.random() - 0.5) * 0.08;
      }
    }
    for (const [id, tm] of this.towerMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(tm.group);
        this.scene.remove(tm.ring);
        tm.ring.geometry.dispose();
        tm.ring.material.dispose();
        this.towerMeshes.delete(id);
      }
    }
  }

  createTower(t) {
    const g = buildTower(t);
    this.scene.add(g);
    // Ground ring marking the nail gun's blind spot: enemies inside it are safe from nails
    const r = CHARACTERS.builder.nailMinRange;
    const rg = new THREE.RingGeometry(r - 0.15, r, 64);
    rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: TEAM_COLORS[t.team], transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.set(t.x, t.y + 0.03, t.z);
    this.scene.add(ring);
    return { group: g, ring, hp: t.hp, shake: 0 };
  }

  updateProjectiles(view, dt) {
    const seen = new Set();
    for (const p of view.projectiles) {
      seen.add(p.id);
      let pm = this.projMeshes.get(p.id);
      if (!pm && p.type === 'nail') {
        const g = new THREE.Group();
        // Hot, glowing nail so it reads at speed (and blooms)
        const n = new THREE.Mesh(boxGeo(0.035, 0.035, 0.34), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.5, 1.6) }));
        g.add(n);
        const headM = new THREE.Mesh(boxGeo(0.08, 0.08, 0.03), mat(0x8a929c, 'metal'));
        headM.position.z = -0.17;
        g.add(headM);
        this.scene.add(g);
        pm = { group: g, nail: true };
        this.projMeshes.set(p.id, pm);
      }
      if (!pm) {
        const g = new THREE.Group();
        const glass = new THREE.MeshStandardMaterial({ color: 0x47e08a, transparent: true, opacity: 0.85, roughness: 0.1, emissive: 0x1fd16a, emissiveIntensity: 0.8 });
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 14), glass));
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 10), glass);
        neck.position.y = 0.16;
        g.add(neck);
        const cork = new THREE.Mesh(boxGeo(0.05, 0.04, 0.05), mat(0x8a5a2b, 'wood'));
        cork.position.y = 0.24;
        g.add(cork);
        g.traverse((o) => { o.castShadow = true; });
        this.scene.add(g);
        pm = { group: g };
        this.projMeshes.set(p.id, pm);
      }
      pm.group.position.set(p.x, p.y, p.z);
      if (pm.nail) {
        pm.group.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      } else {
        pm.group.rotation.x += dt * 10;
        pm.group.rotation.z += dt * 4;
      }
    }
    for (const [id, pm] of this.projMeshes) {
      if (!seen.has(id)) { this.scene.remove(pm.group); this.projMeshes.delete(id); }
    }
  }

  updateFlashlights(view, opts) {
    let i = 0;
    for (const e of view.entities) {
      if (i >= this.spots.length) break;
      if (!e.alive || !e.flashlight || view.phase === 'pick') continue;
      const S = this.spots[i++];
      const def = CHARACTERS[e.char];
      const eyeY = e.pos.y + def.eye * (e.crouch ? GAME.crouchHeightScale : 1);
      const d = lookDir(e.yaw, e.pitch);
      const isLocalFP = e.id === opts.localId && opts.firstPerson;
      const ox = e.pos.x + (isLocalFP ? 0 : d.x * 0.3), oz = e.pos.z + (isLocalFP ? 0 : d.z * 0.3);
      S.light.intensity = 60;
      S.light.position.set(ox, eyeY - 0.15, oz);
      S.light.target.position.set(ox + d.x * 10, eyeY - 0.15 + d.y * 10, oz + d.z * 10);
      S.cone.visible = !isLocalFP;
      S.cone.position.set(ox, eyeY - 0.15, oz);
      S.cone.rotation.set(e.pitch, e.yaw, 0, 'YXZ');
    }
    for (; i < this.spots.length; i++) {
      this.spots[i].light.intensity = 0;
      this.spots[i].cone.visible = false;
    }
  }

  updateViewmodel(view, opts, dt) {
    const e = view.entities.find((x) => x.id === opts.localId);
    const show = e && e.alive && opts.firstPerson && view.phase !== 'pick';
    this.vm.visible = !!show;
    if (this.buildPreview) this.buildPreview.visible = false;
    if (!show) return;
    const key = `${e.char}|${e.weapon}|${e.team}`;
    if (key !== this.vmKey) {
      this.vmKey = key;
      this.vm.clear();
      const pivot = new THREE.Group();
      pivot.scale.setScalar(0.55);
      const holder = new THREE.Group();
      pivot.add(holder);
      holder.add(buildViewArm(e.char, e.team));
      holder.add(buildWeapon(e.weapon));
      if (e.weapon === 'kick') {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.5, 4, 8), mat(0x8a929c, 'metal'));
        leg.rotation.x = Math.PI / 2;
        leg.position.set(-0.1, -0.15, -0.2);
        leg.visible = false;
        holder.add(leg);
        this.vmLeg = leg;
      } else this.vmLeg = null;
      if (e.char === 'longman') {
        const lh = new THREE.Group();
        lh.position.set(-0.34, -0.34, -0.45);
        lh.add(buildViewArm('longman', e.team));
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 14), mat(0x2b2f38, 'metal'));
        body.rotation.x = Math.PI / 2;
        body.position.set(0, 0.02, -0.1);
        lh.add(body);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.3, 1.8) }));
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, 0.02, -0.215);
        lh.add(lens);
        pivot.add(lh);
        this.vmTorch = lh;
      } else this.vmTorch = null;
      this.vm.add(pivot);
      this.vmPivot = pivot;
      this.vmHolder = holder;
      // Spy sees his own hands faintly
      const spy = e.char === 'spy';
      pivot.traverse((o) => {
        if (!o.isMesh) return;
        if (spy) o.material = new THREE.MeshBasicMaterial({ color: o.material.color, transparent: true, opacity: 0.35, depthWrite: false });
        o.castShadow = false;
        o.receiveShadow = false;
      });
    }
    if (e.attackSeq !== this.vmAttackSeq) {
      if (this.vmAttackSeq !== -1) this.vmSwingT = 0;
      this.vmAttackSeq = e.attackSeq;
      this.vmAnim = (WEAPONS[e.weapon] || {}).anim || 'swing';
    }
    this.vmSwingT += dt;
    const speed = Math.hypot(e.vel.x, e.vel.z);
    if (e.onGround) this.vmBob += dt * speed * 1.6;
    const bob = Math.sin(this.vmBob) * 0.015 * Math.min(1, speed / 3);
    const sway = Math.cos(this.vmBob * 0.5) * 0.01 * Math.min(1, speed / 3);
    const H = this.vmHolder, Pv = this.vmPivot;
    const rest = VM_REST[e.weapon] || { rx: 0, ry: 0, rz: 0 };
    if (e.weapon === 'nailgun') H.position.set(0.42, -0.42 + bob, -0.55);
    else if (CHOPPERS.has(e.weapon)) H.position.set(0.42 + sway, -0.4 + bob, -0.5);
    else H.position.set(0.34 + sway, -0.36 + bob, -0.5);
    H.rotation.set(rest.rx, rest.ry, rest.rz);
    Pv.rotation.set(0, 0, 0);
    if (this.vmLeg) this.vmLeg.visible = false;
    const T = 0.28;
    if (this.vmSwingT < T) {
      const t = this.vmSwingT / T;
      const s = Math.sin(t * Math.PI);
      switch (this.vmAnim) {
        case 'swing':
          // From raised overhead to a diagonal chop down and across
          H.rotation.y = rest.ry * (1 - t);
          H.rotation.x = 1.6 - t * 2.2;
          H.rotation.z = -0.35 + t * 0.8;
          H.position.x = 0.45 - t * 0.55;
          H.position.y = -0.1 - t * 0.3;
          break;
        case 'stab':
        case 'punch':
          H.position.z = -0.5 - s * 0.35;
          H.position.x = 0.34 - s * 0.12;
          break;
        case 'spin':
          Pv.rotation.y = Math.PI * 0.8 - t * Math.PI * 1.6;
          H.position.set(0.0, -0.25, -0.75);
          H.rotation.set(0.3, Math.PI / 2, 0);
          break;
        case 'shoot':
          H.position.z = -0.5 + s * 0.12;
          H.rotation.x = s * 0.3;
          break;
        case 'kick':
          if (this.vmLeg) { this.vmLeg.visible = true; this.vmLeg.position.z = -0.2 - s * 0.4; this.vmLeg.position.y = -0.3 + s * 0.15; }
          break;
      }
    }
    if (e.buildT > 0) { H.position.y -= 0.15; H.rotation.x = Math.sin(opts.time * 20) * 0.3; }
    if (this.vmTorch) this.vmTorch.visible = e.flashlight;

    // Tower placement preview while building
    if (e.char === 'builder' && e.buildT > 0) {
      if (!this.buildPreview) {
        const d = CHARACTERS.builder;
        this.buildPreview = new THREE.Mesh(boxGeo(d.towerSize, d.towerHeight, d.towerSize),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
        this.scene.add(this.buildPreview);
      }
      const d = CHARACTERS.builder;
      const p = Math.min(1, e.buildT / d.buildTime);
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      this.buildPreview.visible = true;
      this.buildPreview.scale.y = Math.max(0.05, p);
      this.buildPreview.position.set(e.pos.x + fx * 1.9, e.pos.y + d.towerHeight * p / 2, e.pos.z + fz * 1.9);
      this.buildPreview.material.color.setHex(TEAM_COLORS[e.team]);
    }
  }

  // ---------- Effects ----------

  ping(x, y, z, team, life = 2.5) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d');
    const col = team === 'yellow' ? '#ffd43b' : '#4ee6dc';
    c.lineWidth = 10;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.beginPath(); c.arc(64, 64, 50, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 6;
    c.strokeStyle = col;
    c.beginPath(); c.arc(64, 64, 50, 0, Math.PI * 2); c.stroke();
    c.font = 'bold 72px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.fillText('!', 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Constant on-screen size so a far-away ping is still easy to spot
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.1, 0.1, 1);
    sp.position.set(x, y + 2.2, z);
    sp.renderOrder = 20;
    this.scene.add(sp);
    this.particles.push({ obj: sp, vx: 0, vy: 0, vz: 0, life, max: life, gravity: 0, fade: true, sprite: true });
    this.ring(x, y, z, team === 'yellow' ? 0xffd43b : 0x4ee6dc, 3, Math.min(1.2, life));
  }

  spawnText(text, color, x, y, z) {
    const s = textSprite(text, color);
    s.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
    this.scene.add(s);
    this.particles.push({ obj: s, vx: 0, vy: 1.2, vz: 0, life: 1.0, max: 1.0, gravity: 0, fade: true, sprite: true });
  }

  burst(x, y, z, color, n = 10, speed = 3, size = 0.08, life = 0.7, gravity = -9) {
    const m0 = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(boxGeo(size, size, size), m0);
      m.position.set(x, y, z);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      this.particles.push({ obj: m, vx: Math.cos(a) * r * speed, vy: Math.abs(u) * speed + 1, vz: Math.sin(a) * r * speed, life, max: life, gravity, fade: true, mat: m0, spin: true });
    }
  }

  ring(x, y, z, color, radius, life = 0.6) {
    const geo = new THREE.RingGeometry(0.2, 0.45, 32);
    geo.rotateX(-Math.PI / 2);
    const m0 = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, m0);
    m.position.set(x, y + 0.05, z);
    this.scene.add(m);
    this.particles.push({ obj: m, vx: 0, vy: 0, vz: 0, life, max: life, gravity: 0, fade: true, mat: m0, grow: radius / 0.45 });
  }

  debris(x, y, z, height, team) {
    const colors = [0x8a5a2b, 0x5c3a1a, 0xc49a5a, TEAM_COLORS[team]];
    for (let i = 0; i < 22; i++) {
      const s = 0.15 + Math.random() * 0.35;
      const m0 = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.85, transparent: true });
      const m = new THREE.Mesh(boxGeo(s, s * 0.6, s * 1.5), m0);
      m.position.set(x + (Math.random() - 0.5) * 1.2, y + Math.random() * height, z + (Math.random() - 0.5) * 1.2);
      m.castShadow = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.particles.push({ obj: m, vx: Math.cos(a) * sp, vy: Math.random() * 4, vz: Math.sin(a) * sp, life: 1.6, max: 1.6, gravity: -14, fade: true, mat: m0, spin: true, floor: y, own: true });
    }
    this.ring(x, y, z, 0xd9c7a0, CHARACTERS.builder.collapseRadius, 0.7);
  }

  updateParticles(dt) {
    const keep = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        if (p.sprite) { p.obj.material.map.dispose(); p.obj.material.dispose(); }
        else if (p.mat && p.grow) { p.obj.geometry.dispose(); p.mat.dispose(); }
        else if (p.own) p.mat.dispose();
        continue;
      }
      p.vy += p.gravity * dt;
      p.obj.position.x += p.vx * dt;
      p.obj.position.y += p.vy * dt;
      p.obj.position.z += p.vz * dt;
      const floor = p.floor ?? 0;
      if (p.obj.position.y < floor + 0.05 && p.gravity) { p.obj.position.y = floor + 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      if (p.spin) { p.obj.rotation.x += dt * 5; p.obj.rotation.y += dt * 3; }
      if (p.grow) { const s = 1 + (1 - p.life / p.max) * (p.grow - 1); p.obj.scale.set(s, 1, s); }
      const a = p.life / p.max;
      if (p.fade) {
        if (p.sprite) p.obj.material.opacity = Math.min(1, a * 2);
        else if (p.mat) p.mat.opacity = Math.min(1, a * 2);
      }
      keep.push(p);
    }
    this.particles = keep;
  }
}
