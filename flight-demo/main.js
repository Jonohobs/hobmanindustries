import * as THREE from 'three';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const liftBar = document.getElementById('liftBar');
const fieldBar = document.getElementById('fieldBar');
const helpEl = document.getElementById('help');
if (matchMedia('(pointer: coarse)').matches) {
  statusEl.textContent = 'Touch: left stick flies, drag right side to look, use UP/DOWN, HOOK, PULSE, BOOST and SAFETY.';
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PLAYER_RADIUS = 0.55;
const PLAYER_HALF_HEIGHT = 0.9;
const CARRIER_SPREAD = 4.6;
const CARRIER_ABOVE_AVATAR = 10;
const CARRIER_ROOF_CLEARANCE = 3.2;
const CHASE_DISTANCE = 8.6;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1a2c);
scene.fog = new THREE.FogExp2(0x0a1626, 0.006);

const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 400);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xb8d2f2, 0x11203a, 1.5));
const sun = new THREE.DirectionalLight(0x9ec8ff, 1.1);
sun.position.set(-30, 60, -20);
scene.add(sun);

// ---------- materials ----------
const towerMat = new THREE.MeshStandardMaterial({ color: 0x27435f, roughness: 0.85, metalness: 0.25, emissive: 0x14273d, emissiveIntensity: 0.5, transparent: true, opacity: 0.95 });
const towerEdgeMat = new THREE.LineBasicMaterial({ color: 0x7eb8ff, transparent: true, opacity: 0.35 });
const cargoMats = {};
function cargoMat(hex) {
  if (!cargoMats[hex]) cargoMats[hex] = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.22, roughness: 0.55, metalness: 0.3 });
  return cargoMats[hex];
}

// ---------- ground ----------
const grid = new THREE.GridHelper(160, 32, 0x33608e, 0x1c3a58);
grid.material.transparent = true; grid.material.opacity = 0.5;
scene.add(grid);
const groundPlane = new THREE.Mesh(
  new THREE.CircleGeometry(90, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 1 })
);
groundPlane.position.y = -0.02;
scene.add(groundPlane);

// ---------- stars ----------
{
  const n = 500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, r = 150 + Math.random() * 120, y = 25 + Math.random() * 140;
    pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9ec8ff, size: 0.55, transparent: true, opacity: 0.75, sizeAttenuation: true })));
}

// ---------- towers ----------
const towers = [];
for (let i = 0; i < 32; i++) {
  const ring = 30 + (i % 8) * 9, a = (i * 2.399) % TAU;
  const h = 6 + Math.random() * 18, w = 1.4 + Math.random() * 2.6;
  const x = Math.cos(a) * ring, z = Math.sin(a) * ring + 22;
  const geo = new THREE.BoxGeometry(w * 2, h, w * 2);
  const mesh = new THREE.Mesh(geo, towerMat);
  mesh.position.set(x, h / 2, z);
  scene.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), towerEdgeMat);
  edges.position.copy(mesh.position);
  scene.add(edges);
  if (i % 4 === 0) { // rooftop antenna
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), new THREE.MeshBasicMaterial({ color: 0x7eb8ff }));
    ant.position.set(x, h + 1.5, z);
    scene.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xff5d7a }));
    tip.position.set(x, h + 3, z);
    tip.userData.blink = Math.random() * TAU;
    scene.add(tip);
    towers.push({ blinkTip: tip });
  }
  towers.push({ x, z, h, w, mesh });
}
const buildingTowers = towers.filter(t => t.mesh);
const towerMeshes = buildingTowers.map(t => t.mesh);
const tallestBuildingTop = buildingTowers.reduce((top, tower) => Math.max(top, tower.h), 0);
const rooftopDrones = [];
const cameraRaycaster = new THREE.Raycaster();

// ---------- pads ----------
const padPositions = [V(-16, 0.04, 16), V(0, 0.04, 24), V(16, 0.04, 16)];
for (const p of padPositions) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.1, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dffcf }));
  ring.position.copy(p);
  scene.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dffcf, transparent: true, opacity: 0.10 }));
  disc.position.copy(p).y += 0.01;
  scene.add(disc);
}

// ---------- blimp drone hubs ----------
function makeBlimp() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16).scale(2.6, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x24405e, roughness: 0.6, metalness: 0.35, emissive: 0x0d1e33, emissiveIntensity: 0.6 })
  );
  g.add(hull);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.004, 24, 16).scale(2.6, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x7eb8ff, wireframe: true, transparent: true, opacity: 0.10 }));
  g.add(stripe);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x30567e, roughness: 0.7 });
  for (const [ry, rz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.7), finMat);
    fin.position.set(-2.3, ry, rz);
    fin.rotation.x = rz !== 0 ? Math.PI / 2 : 0;
    g.add(fin);
  }
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.5), finMat);
  gondola.position.y = -1.15;
  g.add(gondola);
  const nav = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0x7dffcf }));
  nav.position.set(2.55, 0, 0);
  g.add(nav);
  g.userData.nav = nav;
  // load-bearing winch and pulley under the gondola
  const winch = new THREE.Group();
  winch.position.y = -1.35;
  const winchWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.055, 8, 22),
    new THREE.MeshStandardMaterial({ color: 0xc8efff, emissive: 0x2c7898, emissiveIntensity: 0.85, metalness: 0.8, roughness: 0.28 })
  );
  winch.add(winchWheel);
  const winchAxle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.25, 10).rotateX(Math.PI / 2),
    finMat
  );
  winch.add(winchAxle);
  g.add(winch);
  g.userData.winchWheel = winchWheel;
  return g;
}
const blimps = [];
for (let i = 0; i < 5; i++) {
  const b = makeBlimp();
  const a = (i / 5) * TAU;
  if (i < 2) b.scale.setScalar(1.3);
  b.userData.orbit = i < 2
    ? { role: 'carrier', side: i === 0 ? -1 : 1, lead: 3.5, bob: i * Math.PI }
    : { role: 'patrol', a, r: 31 + (i % 3) * 10, y: 44 + (i % 2) * 7, speed: 0.018 + i * 0.004, bob: i * 1.7 };
  scene.add(b);
  blimps.push(b);
}
const carrierBlimps = blimps.slice(0, 2);
function blimpAnchor(b) { return b.localToWorld(V(0, -1.35, 0)); }
function nearestBlimps(p, count = 2) {
  return blimps.map(b => ({ b, d: blimpAnchor(b).distanceTo(p) })).sort((x, y) => x.d - y.d).slice(0, count).map(x => x.b);
}
function fieldAnchorPoint(anchor) {
  return anchor.userData.fieldPoint
    ? anchor.userData.fieldPoint.getWorldPosition(V())
    : blimpAnchor(anchor);
}
function telekinesisAnchorNodes(p) {
  if (rooftopDrones.length === 3) {
    return [...rooftopDrones].sort((a, b) =>
      fieldAnchorPoint(a).distanceToSquared(p) - fieldAnchorPoint(b).distanceToSquared(p)
    );
  }
  const patrol = blimps.slice(2)
    .map(b => ({ b, d: blimpAnchor(b).distanceToSquared(p) }))
    .sort((a, b) => a.d - b.d)[0]?.b;
  return patrol ? [...carrierBlimps, patrol] : [...carrierBlimps];
}

// ---------- player ----------
const player = {
  pos: V(0, 5.5, -14), vel: V(), yaw: 0.12, pitch: -0.18,
  lift: 1, field: 1, grabbed: null, fieldAnchors: [], grabDistance: 7, hoistDrop: 20, load: 0
};
const avatar = new THREE.Group();
const flightRig = new THREE.Group();
const limbs = {};
const suspensionAnchors = {};
const suspensionSwing = V();
{
  avatar.add(flightRig);
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x3f9f83, roughness: 0.7, emissive: 0x123d38, emissiveIntensity: 0.38 });
  const leggingsMat = new THREE.MeshStandardMaterial({ color: 0x789a6a, roughness: 0.78 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe5c4a9, roughness: 0.75 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x49392f, roughness: 0.86 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x91f2c8, roughness: 0.6, emissive: 0x1b5b4d, emissiveIntensity: 0.45 });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.9, 7), suitMat);
  torso.position.y = 0.02;
  flightRig.add(torso);
  const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.48, 0.38, 7), suitMat);
  tunic.position.y = -0.46;
  tunic.rotation.y = Math.PI / 5;
  flightRig.add(tunic);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.405, 0.405, 0.09, 16), bootMat);
  belt.position.y = -0.29;
  flightRig.add(belt);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.18, 10), skinMat);
  neck.position.y = 0.56;
  flightRig.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), skinMat);
  head.scale.set(0.92, 1.08, 0.94);
  head.position.set(0, 0.78, 0.02);
  flightRig.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.285, 14, 9, 0, TAU, 0, Math.PI * 0.56), bootMat);
  hair.position.set(0, 0.85, -0.01);
  flightRig.add(hair);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.72, 7), suitMat);
  cap.position.set(0, 0.98, -0.28);
  cap.rotation.x = -Math.PI / 2;
  flightRig.add(cap);
  const capBand = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.035, 5, 16).rotateX(Math.PI / 2), accentMat);
  capBand.position.set(0, 0.97, -0.01);
  capBand.rotation.x = 0.18;
  flightRig.add(capBand);

  function makeLimb(radius, length, material) {
    const pivot = new THREE.Group();
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 9), material);
    limb.position.y = -(length * 0.5 + radius);
    pivot.add(limb);
    pivot.userData.endY = -(length + radius * 2);
    return pivot;
  }
  limbs.leftArm = makeLimb(0.11, 0.70, suitMat);
  limbs.rightArm = makeLimb(0.11, 0.70, suitMat);
  limbs.leftArm.position.set(-0.31, 0.39, 0);
  limbs.rightArm.position.set(0.31, 0.39, 0);
  for (const arm of [limbs.leftArm, limbs.rightArm]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8), skinMat);
    hand.position.y = arm.userData.endY - 0.04;
    arm.add(hand);
  }
  flightRig.add(limbs.leftArm, limbs.rightArm);
  limbs.leftLeg = makeLimb(0.13, 0.82, leggingsMat);
  limbs.rightLeg = makeLimb(0.13, 0.82, leggingsMat);
  limbs.leftLeg.position.set(-0.17, -0.48, 0);
  limbs.rightLeg.position.set(0.17, -0.48, 0);
  flightRig.add(limbs.leftLeg, limbs.rightLeg);
  for (const leg of [limbs.leftLeg, limbs.rightLeg]) {
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 4, 8), bootMat);
    boot.position.set(0, -1.02, -0.08);
    boot.rotation.x = Math.PI / 2.8;
    leg.add(boot);
  }

  const capeShape = new THREE.Shape();
  capeShape.moveTo(-0.29, 0.38);
  capeShape.lineTo(0.29, 0.38);
  capeShape.lineTo(0.12, -0.62);
  capeShape.lineTo(-0.12, -0.55);
  capeShape.closePath();
  const cape = new THREE.Mesh(
    new THREE.ShapeGeometry(capeShape),
    new THREE.MeshStandardMaterial({ color: 0x247069, roughness: 0.8, side: THREE.DoubleSide })
  );
  cape.position.set(0, 0.24, -0.34);
  cape.rotation.x = -0.16;
  flightRig.add(cape);
  const harness = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.045, 6, 20).rotateX(Math.PI / 2), accentMat);
  harness.position.y = 0.3;
  flightRig.add(harness);

  function addSuspensionAnchor(name, x, y) {
    const anchor = new THREE.Group();
    anchor.name = name;
    anchor.position.set(x, y, -0.12);
    const eyelet = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.025, 6, 14),
      new THREE.MeshBasicMaterial({ color: 0xc9f3ff })
    );
    anchor.add(eyelet);
    flightRig.add(anchor);
    suspensionAnchors[name] = anchor;
  }
  addSuspensionAnchor('leftShoulder', 0.36, 0.4);
  addSuspensionAnchor('leftHip', 0.34, -0.31);
  addSuspensionAnchor('rightShoulder', -0.36, 0.4);
  addSuspensionAnchor('rightHip', -0.34, -0.31);
  flightRig.scale.setScalar(1.1);
}
scene.add(avatar);

// Layered fall-arrest system: helium bladders slow the first drop, then a
// canopy opens if descent continues. Both remain visually attached to the harness.
const safetySystem = { helium: 0, chute: 0, phase: 'stowed' };
const bladderMat = new THREE.MeshStandardMaterial({
  color: 0xffd27d, emissive: 0x8a4b16, emissiveIntensity: 0.45,
  roughness: 0.48, metalness: 0.08, transparent: true, opacity: 0.9
});
const heliumBladders = [];
for (const side of [-1, 1]) {
  const bladder = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12).scale(0.62, 0.9, 0.46), bladderMat.clone());
  bladder.position.set(side * 0.72, 0.24, -0.12);
  bladder.scale.setScalar(0.01);
  bladder.visible = false;
  avatar.add(bladder);
  heliumBladders.push(bladder);
}
const parachute = new THREE.Group();
const canopy = new THREE.Mesh(
  new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0, Math.PI / 2).scale(2.3, 0.78, 2.3),
  new THREE.MeshStandardMaterial({ color: 0xe4f5ff, emissive: 0x2d6680, emissiveIntensity: 0.5, roughness: 0.65, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
);
parachute.add(canopy);
const canopyBand = new THREE.Mesh(
  new THREE.TorusGeometry(2.28, 0.055, 7, 36).rotateX(Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x8fe9ff })
);
parachute.add(canopyBand);
parachute.scale.setScalar(0.01);
parachute.visible = false;
scene.add(parachute);

function makeRooftopDrone(index) {
  const drone = new THREE.Group();
  drone.userData.anchorKind = 'rooftop-drone';
  drone.userData.index = index;
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x4177a6, roughness: 0.55, metalness: 0.48,
    emissive: 0x102d47, emissiveIntensity: 0.7
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x8fe9ff });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10).scale(1.25, 0.58, 1), shellMat);
  drone.add(core);
  for (const [x, z] of [[-0.42, 0], [0.42, 0], [0, -0.34], [0, 0.34]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.055, 0.07), shellMat);
    arm.position.set(x * 0.55, 0, z * 0.55);
    arm.rotation.y = z ? Math.PI / 2 : 0;
    drone.add(arm);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 6, 20).rotateX(Math.PI / 2), glowMat);
  halo.position.y = 0.02;
  drone.add(halo);
  const fieldPoint = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), glowMat);
  fieldPoint.position.y = -0.28;
  drone.add(fieldPoint);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), glowMat);
  beacon.position.y = 0.42;
  drone.add(beacon);
  drone.userData.fieldPoint = fieldPoint;
  drone.scale.setScalar(1.35);
  scene.add(drone);
  return drone;
}
for (let i = 0; i < 3; i++) rooftopDrones.push(makeRooftopDrone(i));

// Travelling block on the taut carrier cable between the two blimps.
// The blimps carry the weight; the drones below steer its vectors.
function makePulleyTrolley() {
  const trolley = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9bc8df, emissive: 0x24586f, emissiveIntensity: 0.8,
    metalness: 0.82, roughness: 0.25
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0x9ff3ff });
  trolley.userData.wheels = [];
  for (const x of [-0.28, 0.28]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.055, 8, 24), metal);
    wheel.position.x = x;
    trolley.add(wheel);
    trolley.userData.wheels.push(wheel);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.16, 0.18), metal);
  frame.position.y = -0.2;
  trolley.add(frame);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 8, 20), glow);
  hook.position.y = -0.5;
  trolley.add(hook);
  trolley.userData.hook = hook;
  scene.add(trolley);
  return trolley;
}
const pulleyTrolley = makePulleyTrolley();

function resolveTowerCollision(position, velocity, horizontalRadius, halfHeight, restitution = 0) {
  let collided = false;
  for (const tower of towers) {
    if (tower.x === undefined) continue;
    const minX = tower.x - tower.w - horizontalRadius;
    const maxX = tower.x + tower.w + horizontalRadius;
    const minY = -halfHeight;
    const maxY = tower.h + halfHeight;
    const minZ = tower.z - tower.w - horizontalRadius;
    const maxZ = tower.z + tower.w + horizontalRadius;
    if (position.x <= minX || position.x >= maxX ||
        position.y <= minY || position.y >= maxY ||
        position.z <= minZ || position.z >= maxZ) continue;

    const faces = [
      { depth: position.x - minX, normal: V(-1, 0, 0), axis: 'x', value: minX },
      { depth: maxX - position.x, normal: V(1, 0, 0), axis: 'x', value: maxX },
      { depth: position.y - minY, normal: V(0, -1, 0), axis: 'y', value: minY },
      { depth: maxY - position.y, normal: V(0, 1, 0), axis: 'y', value: maxY },
      { depth: position.z - minZ, normal: V(0, 0, -1), axis: 'z', value: minZ },
      { depth: maxZ - position.z, normal: V(0, 0, 1), axis: 'z', value: maxZ }
    ];
    const hit = faces.reduce((best, face) => face.depth < best.depth ? face : best);
    position[hit.axis] = hit.value;
    const inwardSpeed = velocity.dot(hit.normal);
    if (inwardSpeed < 0) velocity.addScaledVector(hit.normal, -(1 + restitution) * inwardSpeed);
    collided = true;
  }
  return collided;
}

// ---------- objects ----------
let objects = [];
function cube(name, x, y, z, hex, scale = 1) {
  const r = 1.2 * scale;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r * 2, r * 2), cargoMat(hex).clone());
  mesh.position.set(x, y, z);
  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(r * 0.24, Math.max(0.035, r * 0.045), 7, 20),
    new THREE.MeshStandardMaterial({ color: 0xd9f6ff, emissive: 0x3b8eaa, emissiveIntensity: 0.9, metalness: 0.75, roughness: 0.25 })
  );
  hook.position.y = r + 0.13;
  hook.rotation.x = Math.PI / 2;
  mesh.add(hook);
  scene.add(mesh);
  return { name, mesh, hook, vel: V(), spin: (Math.random() - 0.5) * 1.6, r, held: false, scored: false };
}
function objectHookPoint(object) {
  return object.hook.getWorldPosition(V());
}
function resetObjects() {
  for (const o of objects) scene.remove(o.mesh);
  objects = [
    cube('CARGO-01', -13, 3, 4, 0x7eb8ff), cube('CARGO-02', 3, 2.5, 10, 0x9ee6ff), cube('CARGO-03', 14, 3.8, 2, 0x79a8ff),
    cube('DEBRIS-A', -8, 1.8, 22, 0xb6c4d6, 0.7), cube('DEBRIS-B', 9, 1.6, 20, 0xb6c4d6, 0.55), cube('DEBRIS-C', 0, 1.4, 5, 0xb6c4d6, 0.45)
  ];
}
resetObjects();

// target highlight diamond
const highlight = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: 0xe7f6ff, transparent: true, opacity: 0.9 }));
highlight.visible = false;
scene.add(highlight);

// ---------- filament strings ----------
const SEGS = 18;
function makeString() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGS + 1) * 3), 3));
  const m = new THREE.LineBasicMaterial({ transparent: true });
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  scene.add(line);
  return line;
}
const slackColor = new THREE.Color(0x2a5580), tautColor = new THREE.Color(0xbfe9ff);
// tension 0..1: sagging dim slack -> straight bright taut
function updateString(line, from, to, tension) {
  const attr = line.geometry.attributes.position;
  const sag = (1 - tension) * from.distanceTo(to) * 0.16;
  const mid = from.clone().lerp(to, 0.5); mid.y -= sag;
  const tmp = V();
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    // quadratic bezier through sagged midpoint (approximates catenary)
    tmp.set(0, 0, 0)
      .addScaledVector(from, (1 - t) * (1 - t))
      .addScaledVector(mid, 2 * (1 - t) * t)
      .addScaledVector(to, t * t);
    attr.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  attr.needsUpdate = true;
  line.material.color.copy(slackColor).lerp(tautColor, tension);
  line.material.opacity = lerp(0.28, 0.95, tension);
  line.visible = true;
}
const liftStrings = [makeString(), makeString(), makeString(), makeString()];
const grabStrings = [makeString(), makeString(), makeString()]; // three-point load web
const droneMooringStrings = rooftopDrones.map(() => makeString());
const droneAssistStrings = rooftopDrones.map(() => makeString());
const carrierBridgeString = makeString();
const droneSpanStrings = [makeString(), makeString()];
const safetyStrings = [makeString(), makeString(), makeString(), makeString()];
const padStrings = padPositions.map(() => makeString()); // ambient web flavor

// ---------- input ----------
const keys = new Set(), pressed = new Set();
addEventListener('keydown', e => { keys.add(e.code); pressed.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code));

let mouseLocked = false, mouseDownL = false, mouseDownR = false;
canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => mouseLocked = document.pointerLockElement === canvas);
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousedown', e => { if (e.button === 0) mouseDownL = true; if (e.button === 2) mouseDownR = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseDownL = false; if (e.button === 2) mouseDownR = false; });

let invertY = localStorage.getItem('hobmanInvertY') === '1';
addEventListener('mousemove', e => {
  if (!mouseLocked) return;
  player.yaw -= e.movementX * 0.0022;
  const dy = invertY ? e.movementY : -e.movementY;
  player.pitch = clamp(player.pitch + dy * 0.0018, -1.05, 0.72);
});
addEventListener('wheel', e => {
  if (player.grabbed) {
    player.hoistDrop = clamp(player.hoistDrop + Math.sign(e.deltaY) * 0.8, 7, 32);
  } else {
    player.grabDistance = clamp(player.grabDistance + Math.sign(e.deltaY) * 0.7, 3, 16);
  }
}, { passive: true });

const touchMove = { x: 0, y: 0, pointerId: null };
const touchLook = { x: 0, y: 0, pointerId: null };
const touchStick = document.getElementById('touchStick');
const stickKnob = document.getElementById('stickKnob');
function updateTouchStick(e) {
  const rect = touchStick.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  const radius = rect.width * 0.34;
  const length = Math.hypot(dx, dy) || 1;
  const scale = Math.min(1, radius / length);
  const x = dx * scale, y = dy * scale;
  touchMove.x = clamp(x / radius, -1, 1);
  touchMove.y = clamp(y / radius, -1, 1);
  stickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}
touchStick?.addEventListener('pointerdown', e => {
  touchMove.pointerId = e.pointerId;
  touchStick.setPointerCapture(e.pointerId);
  updateTouchStick(e);
  e.preventDefault();
});
touchStick?.addEventListener('pointermove', e => { if (touchMove.pointerId === e.pointerId) updateTouchStick(e); });
function releaseTouchStick(e) {
  if (touchMove.pointerId !== e.pointerId) return;
  touchMove.pointerId = null;
  touchMove.x = 0;
  touchMove.y = 0;
  stickKnob.style.transform = 'translate(-50%, -50%)';
}
touchStick?.addEventListener('pointerup', releaseTouchStick);
touchStick?.addEventListener('pointercancel', releaseTouchStick);

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' || e.clientX < innerWidth * 0.42) return;
  touchLook.pointerId = e.pointerId;
  touchLook.x = e.clientX;
  touchLook.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (touchLook.pointerId !== e.pointerId) return;
  const dx = e.clientX - touchLook.x;
  const dy = e.clientY - touchLook.y;
  touchLook.x = e.clientX;
  touchLook.y = e.clientY;
  player.yaw -= dx * 0.007;
  player.pitch = clamp(player.pitch - dy * 0.005, -1.05, 0.72);
});
const releaseTouchLook = e => { if (touchLook.pointerId === e.pointerId) touchLook.pointerId = null; };
canvas.addEventListener('pointerup', releaseTouchLook);
canvas.addEventListener('pointercancel', releaseTouchLook);

document.querySelectorAll('[data-hold]').forEach(button => {
  const code = button.dataset.hold;
  const stop = e => { keys.delete(code); button.classList.remove('active'); e.preventDefault(); };
  button.addEventListener('pointerdown', e => {
    button.setPointerCapture(e.pointerId);
    keys.add(code);
    button.classList.add('active');
    e.preventDefault();
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
});
document.querySelectorAll('[data-press]').forEach(button => {
  button.addEventListener('pointerdown', e => {
    pressed.add(button.dataset.press);
    button.classList.add('active');
    setTimeout(() => button.classList.remove('active'), 130);
    e.preventDefault();
  });
});

const forward = () => V(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch));
const flatForward = () => V(Math.sin(player.yaw), 0, Math.cos(player.yaw));
const right = () => { const f = flatForward(); return V(-f.z, 0, f.x); };

let droneAssistStrength = 0;
function updateRooftopDrones(dt, now) {
  const leftWinch = blimpAnchor(carrierBlimps[0]);
  const rightWinch = blimpAnchor(carrierBlimps[1]);
  const bridge = rightWinch.clone().sub(leftWinch);
  const bridgeLengthSq = Math.max(0.001, bridge.lengthSq());
  const focus = player.grabbed ? objectHookPoint(player.grabbed) : player.pos;
  const travel = player.grabbed
    ? clamp(focus.clone().sub(leftWinch).dot(bridge) / bridgeLengthSq, 0.16, 0.84)
    : 0.5 + Math.sin(now / 2400) * 0.08;
  pulleyTrolley.position.copy(leftWinch).lerp(rightWinch, travel);
  pulleyTrolley.position.y -= 0.16;
  pulleyTrolley.rotation.y = player.yaw;
  pulleyTrolley.userData.travel = travel;
  for (const wheel of pulleyTrolley.userData.wheels) wheel.rotation.z += dt * 2.4;

  const center = leftWinch.clone().lerp(rightWinch, 0.5);
  const span = bridge.clone().normalize();
  const ahead = flatForward();
  const targets = [
    center.clone().addScaledVector(span, -3.15).addScaledVector(ahead, 0.7).add(V(0, -3.4, 0)),
    pulleyTrolley.position.clone().addScaledVector(ahead, 1.9).add(V(0, -4.6, 0)),
    center.clone().addScaledVector(span, 3.15).addScaledVector(ahead, 0.7).add(V(0, -3.4, 0))
  ];
  if (player.grabbed) {
    const desiredLoad = player.pos.clone().addScaledVector(forward(), player.grabDistance);
    const targetCenter = targets.reduce((sum, target) => sum.add(target), V()).multiplyScalar(1 / targets.length);
    const steeringOffset = desiredLoad.sub(targetCenter);
    steeringOffset.y = 0;
    if (steeringOffset.length() > 6.5) steeringOffset.setLength(6.5);
    targets.forEach(target => target.add(steeringOffset));
  }
  rooftopDrones.forEach((drone, i) => {
    const target = targets[i];
    target.y += Math.sin(now / 470 + i * 2.1) * 0.12;
    if (!drone.userData.initialized) {
      drone.position.copy(target);
      drone.userData.initialized = true;
    } else {
      drone.position.lerp(target, 1 - Math.pow(0.45, dt));
    }
    drone.rotation.y += dt * (0.65 + i * 0.12);
    drone.userData.settled = drone.position.distanceTo(target) < 0.7;
    drone.userData.carrierPoint = i === 0
      ? leftWinch
      : (i === 2 ? rightWinch : pulleyTrolley.userData.hook.getWorldPosition(V()));
  });
}
function supportSurfaceHeight(position, padding = 1.2) {
  let top = 0;
  for (const tower of buildingTowers) {
    if (Math.abs(position.x - tower.x) <= tower.w + padding &&
        Math.abs(position.z - tower.z) <= tower.w + padding) {
      top = Math.max(top, tower.h);
    }
  }
  return top;
}

function nearestTeleTarget() {
  const f = forward(); let best = null, bestScore = 999;
  for (const o of objects) {
    if (o.scored) continue;
    const to = o.mesh.position.clone().sub(player.pos); const d = to.length();
    if (d > 24) continue;
    const alignment = to.normalize().dot(f);
    const score = d + (1 - alignment) * 22;
    if (alignment > 0.72 && score < bestScore) { best = o; bestScore = score; }
  }
  return best;
}

// ---------- update ----------
function update(dt, now) {
  // blimps drift + bob
  for (const b of blimps) {
    const o = b.userData.orbit;
    if (o.role === 'carrier') {
      const safeAltitude = Math.max(
        player.pos.y + CARRIER_ABOVE_AVATAR,
        tallestBuildingTop + CARRIER_ROOF_CLEARANCE
      );
      const target = player.pos.clone()
        .addScaledVector(right(), o.side * CARRIER_SPREAD)
        .addScaledVector(flatForward(), o.lead)
        .setY(safeAltitude + Math.sin(now / 1500 + o.bob) * 0.18);
      b.position.lerp(target, 1 - Math.pow(0.03, dt));
      b.position.y = Math.max(b.position.y, safeAltitude);
      b.userData.safeAltitude = safeAltitude;
      b.rotation.y = player.yaw + Math.PI / 2;
    } else {
      o.a += o.speed * dt;
      b.position.set(Math.cos(o.a) * o.r, o.y + Math.sin(now / 1900 + o.bob) * 0.7, Math.sin(o.a) * o.r + 22);
      b.rotation.y = -o.a;
    }
    b.userData.nav.material.color.setHex((now / 500 | 0) % 2 ? 0x7dffcf : 0x1c3a58);
  }
  for (const t of towers) if (t.blinkTip) t.blinkTip.material.color.setHex(Math.sin(now / 700 + t.blinkTip.userData.blink) > 0 ? 0xff5d7a : 0x3a1c28);
  updateRooftopDrones(dt, now);

  // flight
  const f = flatForward(), r = right();
  let acc = V();
  if (keys.has('KeyW')) acc.add(f);
  if (keys.has('KeyS')) acc.sub(f);
  if (keys.has('KeyD')) acc.add(r);
  if (keys.has('KeyA')) acc.sub(r);
  acc.addScaledVector(r, touchMove.x);
  acc.addScaledVector(f, -touchMove.y);
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.65 : 1;
  if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(28 * boost);
  if (keys.has('Space')) acc.y += 26;
  if (keys.has('ControlLeft') || keys.has('ControlRight')) acc.y -= 24;
  acc.y += (5.3 - player.pos.y) * 0.55; // filament lift equilibrium
  player.vel.multiplyScalar(Math.pow(0.12, dt)).addScaledVector(acc, dt);
  player.pos.addScaledVector(player.vel, dt);
  player.pos.y = clamp(player.pos.y, 1.5, 36);
  const hitBuilding = resolveTowerCollision(player.pos, player.vel, PLAYER_RADIUS, PLAYER_HALF_HEIGHT);
  if (hitBuilding && player.vel.lengthSq() > 9) player.vel.multiplyScalar(0.86);
  const surfaceClearance = player.pos.y - supportSurfaceHeight(player.pos) - PLAYER_HALF_HEIGHT;
  const descentRisk = clamp((-player.vel.y - 5) / 11, 0, 1);
  const proximityRisk = surfaceClearance < 2.4 && player.vel.y < -0.8
    ? clamp((2.4 - surfaceClearance) / 2.4, 0, 1)
    : 0;

  // F is a deliberate fall test; normal high-speed descents trigger the same system.
  if (pressed.has('KeyF')) {
    player.pos.y = Math.max(player.pos.y, supportSurfaceHeight(player.pos) + 18);
    player.vel.y = -18;
    statusEl.textContent = 'Fall detected: emergency lift system armed.';
  }
  const fallSeverity = clamp((-player.vel.y - 3.5) / 11, 0, 1);
  const heliumTarget = fallSeverity > 0.08 ? clamp(fallSeverity * 1.45, 0, 1) : 0;
  const chuteTarget = player.vel.y < -9 || (surfaceClearance < 7 && player.vel.y < -5) ? 1 : 0;
  safetySystem.helium = lerp(safetySystem.helium, heliumTarget, 1 - Math.pow(heliumTarget > safetySystem.helium ? 0.00008 : 0.12, dt));
  safetySystem.chute = lerp(safetySystem.chute, chuteTarget, 1 - Math.pow(chuteTarget > safetySystem.chute ? 0.000001 : 0.08, dt));
  const nextSafetyPhase = safetySystem.chute > 0.18 ? 'parachute' : (safetySystem.helium > 0.08 ? 'helium' : 'stowed');
  if (nextSafetyPhase !== safetySystem.phase) {
    safetySystem.phase = nextSafetyPhase;
    statusEl.textContent = nextSafetyPhase === 'parachute'
      ? 'Emergency canopy deployed. Helium bladders stabilising descent.'
      : (nextSafetyPhase === 'helium' ? 'Helium fall-arrest bladders inflating.' : 'Fall-arrest system recovered.');
  }
  if (safetySystem.helium > 0.02) {
    player.vel.y += 12 * safetySystem.helium * dt;
  }
  if (safetySystem.chute > 0.02) {
    player.vel.y += 23 * safetySystem.chute * dt;
    player.vel.x *= Math.pow(0.36, safetySystem.chute * dt);
    player.vel.z *= Math.pow(0.36, safetySystem.chute * dt);
  }
  heliumBladders.forEach((bladder, i) => {
    bladder.visible = safetySystem.helium > 0.015;
    const pulse = 1 + Math.sin(now / 230 + i * Math.PI) * 0.025 * safetySystem.helium;
    bladder.scale.setScalar(Math.max(0.01, safetySystem.helium * pulse));
  });
  parachute.visible = safetySystem.chute > 0.015;
  parachute.scale.setScalar(Math.max(0.01, safetySystem.chute));
  const canopyTarget = player.pos.clone().add(V(0, 4.8 + safetySystem.chute * 0.5, 0));
  parachute.position.lerp(canopyTarget, 1 - Math.pow(0.0005, dt));

  droneAssistStrength = Math.max(descentRisk, proximityRisk, hitBuilding ? 0.72 : 0);
  if (droneAssistStrength > 0.01) {
    const assistTarget = rooftopDrones.reduce((sum, drone) => sum.add(fieldAnchorPoint(drone)), V())
      .multiplyScalar(1 / rooftopDrones.length);
    const pull = assistTarget.sub(player.pos);
    pull.y = Math.max(5, pull.y);
    player.vel.addScaledVector(pull.normalize(), 12 * droneAssistStrength * dt);
    player.vel.y += 10 * droneAssistStrength * dt;
  }
  player.lift = clamp(1 - Math.abs(player.vel.y) / 42 + (boost > 1 ? -0.12 : 0), 0.12, 1);
  // string tension follows how hard the web is working
  player.load = lerp(player.load, clamp(0.18 + Math.abs(acc.y) / 45 + player.vel.length() / 34 + (boost > 1 ? 0.2 : 0), 0, 1), 1 - Math.pow(0.002, dt));

  const swingTarget = player.vel.clone().setY(0).multiplyScalar(-0.13);
  swingTarget.y = -clamp(Math.max(0, -player.vel.y) * 0.10 + swingTarget.length() * 0.07, 0, 2.3);
  suspensionSwing.lerp(swingTarget, 1 - Math.pow(0.08, dt));
  avatar.position.copy(player.pos).add(suspensionSwing);
  avatar.rotation.y = player.yaw;
  const horizontalSpeed = Math.hypot(player.vel.x, player.vel.z);
  const flightAmount = clamp(horizontalSpeed / 18 + Math.max(0, player.vel.y) / 30, 0, 1);
  const poseResponse = 1 - Math.pow(0.002, dt);
  flightRig.rotation.x = lerp(flightRig.rotation.x, lerp(0.72, 1.18, flightAmount), poseResponse);
  flightRig.rotation.z = lerp(flightRig.rotation.z, clamp(-player.vel.dot(right()) / 45, -0.22, 0.22), poseResponse);
  limbs.leftArm.rotation.z = lerp(limbs.leftArm.rotation.z, -1.30 - flightAmount * 0.18, poseResponse);
  limbs.rightArm.rotation.z = lerp(limbs.rightArm.rotation.z, 1.30 + flightAmount * 0.18, poseResponse);
  limbs.leftArm.rotation.x = lerp(limbs.leftArm.rotation.x, -0.20 - flightAmount * 0.35, poseResponse);
  limbs.rightArm.rotation.x = lerp(limbs.rightArm.rotation.x, -0.20 - flightAmount * 0.35, poseResponse);
  const stride = Math.sin(now / 260) * 0.12 * flightAmount;
  limbs.leftLeg.rotation.x = lerp(limbs.leftLeg.rotation.x, 0.58 + flightAmount * 0.52 + stride, poseResponse);
  limbs.rightLeg.rotation.x = lerp(limbs.rightLeg.rotation.x, 0.42 + flightAmount * 0.64 - stride, poseResponse);
  limbs.leftLeg.rotation.z = lerp(limbs.leftLeg.rotation.z, 0.18, poseResponse);
  limbs.rightLeg.rotation.z = lerp(limbs.rightLeg.rotation.z, -0.18, poseResponse);

  // grab / release
  const grabPressed = pressed.has('KeyE') || (mouseDownR && !player.grabbed);
  if (grabPressed && !player.grabbed) {
    const t = nearestTeleTarget();
    if (t && player.field > 0.12) {
      player.grabbed = t;
      player.fieldAnchors = telekinesisAnchorNodes(t.mesh.position);
      const webCenter = rooftopDrones.reduce((sum, drone) => sum.add(fieldAnchorPoint(drone)), V())
        .multiplyScalar(1 / rooftopDrones.length);
      player.hoistDrop = clamp(webCenter.y - objectHookPoint(t).y, 7, 32);
      t.held = true;
      statusEl.textContent = `Three-point field lock: ${t.name}. Scroll reels, LMB throws.`;
    }
  } else if (pressed.has('KeyE') && player.grabbed) {
    player.grabbed.held = false;
    player.grabbed = null;
    player.fieldAnchors = [];
    statusEl.textContent = 'Field released.';
  }

  if (player.grabbed) {
    const o = player.grabbed;
    // The load follows the actual drone web, never the player's target directly.
    // This ensures the vector drones visibly lead and pull before the cube moves.
    const target = rooftopDrones.reduce((sum, drone) => sum.add(fieldAnchorPoint(drone)), V())
      .multiplyScalar(1 / rooftopDrones.length);
    target.y -= player.hoistDrop;
    const spring = target.sub(objectHookPoint(o));
    o.vel.multiplyScalar(Math.pow(0.075, dt)).addScaledVector(spring, 6.5 * dt);
    for (const anchor of player.fieldAnchors) {
      const tetherPull = fieldAnchorPoint(anchor).sub(objectHookPoint(o));
      const stretch = tetherPull.length() - player.hoistDrop * 1.15;
      if (stretch > 0) o.vel.addScaledVector(tetherPull.normalize(), stretch * 0.9 * dt);
    }
    o.mesh.rotation.y += dt * 2.5;
    player.field = clamp(player.field - dt * 0.055, 0.05, 1);
    if (mouseDownL || pressed.has('TouchPulse')) {
      o.vel.addScaledVector(forward(), 32);
      o.held = false;
      player.grabbed = null;
      player.fieldAnchors = [];
      player.field = clamp(player.field - 0.18, 0, 1);
      mouseDownL = false; statusEl.textContent = 'Impulse thrown.';
    }
  } else {
    player.field = clamp(player.field + dt * 0.16, 0, 1);
    if ((mouseDownL || pressed.has('TouchPulse')) && player.field > 0.18) {
      const t = nearestTeleTarget();
      if (t) { t.vel.addScaledVector(forward(), 22); player.field -= 0.18; statusEl.textContent = `Impulse pulse hit ${t.name}.`; }
      mouseDownL = false;
    }
  }

  // object physics
  for (const o of objects) {
    if (!o.held) o.vel.y -= 13 * dt;
    o.vel.multiplyScalar(Math.pow(0.55, dt));
    o.mesh.position.addScaledVector(o.vel, dt);
    if (!o.held) o.mesh.rotation.y += o.spin * dt;
    resolveTowerCollision(o.mesh.position, o.vel, o.r, o.r, 0.16);
    if (o.mesh.position.y < o.r) {
      o.mesh.position.y = o.r;
      o.vel.y = Math.abs(o.vel.y) * 0.32; o.vel.x *= 0.82; o.vel.z *= 0.82;
    }
    for (const p of padPositions) {
      if (!o.scored && o.name.startsWith('CARGO') &&
          Math.hypot(o.mesh.position.x - p.x, o.mesh.position.z - p.z) < 2.5 && o.mesh.position.y < 2.6) {
        o.scored = true;
        o.mesh.material.color.setHex(0x7dffcf); o.mesh.material.emissive.setHex(0x7dffcf);
        statusEl.textContent = `${o.name} secured on filament pad.`;
      }
    }
    o.mesh.material.emissiveIntensity = o.held ? 0.6 : (o.scored ? 0.35 : 0.22);
  }

  // strings
  const leftWinch = blimpAnchor(carrierBlimps[0]);
  const rightWinch = blimpAnchor(carrierBlimps[1]);
  updateString(carrierBridgeString, leftWinch, rightWinch, 0.99);
  rooftopDrones.forEach((drone, i) => {
    const carrierPoint = drone.userData.carrierPoint;
    if (carrierPoint) {
      updateString(
        droneMooringStrings[i],
        carrierPoint,
        fieldAnchorPoint(drone),
        drone.userData.settled ? 0.96 : 0.62
      );
    } else {
      droneMooringStrings[i].visible = false;
    }
  });
  updateString(droneSpanStrings[0], fieldAnchorPoint(rooftopDrones[0]), fieldAnchorPoint(rooftopDrones[1]), 0.9);
  updateString(droneSpanStrings[1], fieldAnchorPoint(rooftopDrones[1]), fieldAnchorPoint(rooftopDrones[2]), 0.9);

  const safetyAttachments = [
    suspensionAnchors.leftShoulder,
    suspensionAnchors.rightShoulder,
    suspensionAnchors.leftHip,
    suspensionAnchors.rightHip
  ];
  const canopyRigPoints = [V(-1.65, 0.08, 0.72), V(1.65, 0.08, 0.72), V(-1.65, 0.08, -0.72), V(1.65, 0.08, -0.72)];
  safetyStrings.forEach((line, i) => {
    if (safetySystem.chute > 0.04) {
      updateString(
        line,
        parachute.localToWorld(canopyRigPoints[i].clone()),
        safetyAttachments[i].getWorldPosition(V()),
        clamp(0.65 + safetySystem.chute * 0.35, 0, 1)
      );
    } else {
      line.visible = false;
    }
  });
  const assistAttachments = [
    suspensionAnchors.leftShoulder,
    suspensionAnchors.rightShoulder,
    suspensionAnchors.leftHip
  ];
  droneAssistStrings.forEach((line, i) => {
    if (droneAssistStrength > 0.05) {
      updateString(
        line,
        fieldAnchorPoint(rooftopDrones[i]),
        assistAttachments[i].getWorldPosition(V()),
        clamp(0.35 + droneAssistStrength * 0.65, 0, 1)
      );
    } else {
      line.visible = false;
    }
  });
  const liftTension = clamp(0.82 + player.load * 0.18, 0, 1);
  const suspensionAttachments = [
    { carrier: 0, anchor: suspensionAnchors.leftShoulder },
    { carrier: 0, anchor: suspensionAnchors.leftHip },
    { carrier: 1, anchor: suspensionAnchors.rightShoulder },
    { carrier: 1, anchor: suspensionAnchors.rightHip }
  ];
  liftStrings.forEach((s, i) => {
    const attachment = suspensionAttachments[i];
    const carrier = carrierBlimps[attachment.carrier];
    const harnessPoint = attachment.anchor.getWorldPosition(V());
    updateString(s, blimpAnchor(carrier), harnessPoint, liftTension);
  });
  if (player.grabbed) {
    const o = player.grabbed;
    const tension = clamp(0.35 + o.vel.length() / 18, 0, 1);
    if (player.fieldAnchors.length !== 3) player.fieldAnchors = telekinesisAnchorNodes(o.mesh.position);
    grabStrings.forEach((s, i) => {
      const anchor = player.fieldAnchors[i];
      if (anchor) updateString(s, fieldAnchorPoint(anchor), objectHookPoint(o), clamp(tension + 0.12, 0, 1));
      else s.visible = false;
    });
  } else {
    grabStrings.forEach(s => s.visible = false);
  }
  padStrings.forEach((s, i) => updateString(s, blimpAnchor(nearestBlimps(padPositions[i], 1)[0]), padPositions[i], 0.06));

  // highlight
  const target2 = player.grabbed ? null : nearestTeleTarget();
  highlight.visible = !!target2;
  if (target2) {
    highlight.position.copy(target2.mesh.position); highlight.position.y += target2.r * 1.9;
    highlight.rotation.y = now / 400;
  }

  if (pressed.has('KeyI')) {
    invertY = !invertY;
    localStorage.setItem('hobmanInvertY', invertY ? '1' : '0');
    statusEl.textContent = `Mouse look: ${invertY ? 'inverted' : 'standard'}.`;
  }
  if (pressed.has('KeyR')) {
    resetObjects();
    player.grabbed = null;
    player.fieldAnchors = [];
    statusEl.textContent = 'Simulation reset.';
  }

  liftBar.style.transform = `scaleX(${player.lift})`;
  fieldBar.style.transform = `scaleX(${player.field})`;
  helpEl.classList.toggle('load-active', !!player.grabbed);
  pressed.clear();

  // chase camera
  const carrierCenter = carrierBlimps[0].position.clone().lerp(carrierBlimps[1].position, 0.5);
  const suspensionHeight = Math.max(0, carrierCenter.y - avatar.position.y);
  const framedDistance = Math.max(CHASE_DISTANCE, suspensionHeight * 0.78);
  let camPos = player.pos.clone()
    .addScaledVector(flatForward(), -framedDistance * Math.cos(player.pitch))
    .add(V(0, 2.75 - 4.0 * Math.sin(player.pitch), 0));
  camPos.y = Math.max(camPos.y, 1.2);
  const carrierBlend = player.grabbed ? 0.30 : 0.42;
  const cameraTarget = avatar.position.clone()
    .lerp(carrierCenter, carrierBlend)
    .addScaledVector(forward(), 2.2);
  if (player.grabbed) cameraTarget.lerp(objectHookPoint(player.grabbed), 0.24);
  const cameraRay = camPos.clone().sub(cameraTarget);
  const desiredCameraDistance = cameraRay.length();
  cameraRay.normalize();
  cameraRaycaster.set(cameraTarget, cameraRay);
  cameraRaycaster.far = desiredCameraDistance;
  const cameraHit = cameraRaycaster.intersectObjects(towerMeshes, false)[0];
  if (cameraHit) {
    camPos = cameraTarget.clone().addScaledVector(cameraRay, Math.max(1.5, cameraHit.distance - 0.8));
  }
  camera.position.lerp(camPos, 1 - Math.pow(0.0001, dt));
  camera.lookAt(cameraTarget);

  const done = objects.filter(o => o.scored).length;
  if (done === 3) statusEl.textContent = 'All cargo cores secured. Free-flight sandbox unlocked — throw debris around.';
}

let last = performance.now();
function loop(now) {
  const dt = clamp((now - last) / 1000, 0.001, 0.05); last = now;
  update(dt, now);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.__hobmanDemo = {
  player,
  avatar,
  camera,
  suspensionAnchors,
  objects: () => objects,
  resetObjects,
  blimps,
  carrierBlimps,
  pulleyTrolley,
  carrierBridgeString,
  droneSpanStrings,
  safetySystem,
  heliumBladders,
  parachute,
  safetyStrings,
  tallestBuildingTop,
  liftStrings,
  grabStrings,
  rooftopDrones,
  droneMooringStrings,
  droneAssistStrings,
  droneAssistStrength: () => droneAssistStrength,
  towers,
  resolveTowerCollision,
  supportSurfaceHeight,
  telekinesisAnchorNodes,
  nearestTeleTarget,
  objectHookPoint,
  hookObject(index = 0) {
    const object = objects[index];
    if (!object) return false;
    if (player.grabbed) player.grabbed.held = false;
    player.grabbed = object;
    player.fieldAnchors = telekinesisAnchorNodes(object.mesh.position);
    const webCenter = rooftopDrones.reduce((sum, drone) => sum.add(fieldAnchorPoint(drone)), V())
      .multiplyScalar(1 / rooftopDrones.length);
    player.hoistDrop = clamp(webCenter.y - objectHookPoint(object).y, 7, 32);
    object.held = true;
    statusEl.textContent = `Pulley web hooked to ${object.name}.`;
    return true;
  }
};
