import * as THREE from 'three';
import { createSimulation } from './simulation.js';
import { CanvasArenaRenderer } from './canvas-renderer.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const seed = Number(new URLSearchParams(location.search).get('seed') || 41026) >>> 0;
const sim = createSimulation({seed});
sim.setRunning(false);
document.body.classList.add('lobby');
let started=false, cameraMode='arena', cableCount=4, reveal=true, showField=false;
let quality='standard', transition=null, lastTime=null, hudAt=0, orbitYaw=.48;
const keys=new Set(), stick={x:0,y:0,z:0};
const primary={sources:new Set(),queued:false,sent:false,throwCount:0};
let touchDepth=false;
let firstServe={moved:false,usedAction:false};
function setText(id,value){const element=$(id);if(element.textContent!==value)element.textContent=value;}

function fatal(message) {
  $('loading').hidden=true; $('fatal').hidden=false;
  $('fatal').textContent=`The arena could not start. ${message}`;
}
addEventListener('error', e=>fatal(e.message));
addEventListener('unhandledrejection', e=>fatal(String(e.reason)));
let renderer, canvasFallback=false;
try {
  if(new URLSearchParams(location.search).get('renderer')==='canvas')throw new Error('Canvas view selected');
  if(!$('arena').getContext('webgl2',{antialias:true,alpha:false}))throw new Error('WebGL 2 unavailable');
  renderer=new THREE.WebGLRenderer({canvas:$('arena'),antialias:true,alpha:false});
} catch(error) {
  // A failed/claimed WebGL canvas cannot reliably be reused as a 2D canvas.
  const replacement=$('arena').cloneNode(false);$('arena').replaceWith(replacement);
  renderer=new CanvasArenaRenderer({canvas:replacement,simulation:sim});canvasFallback=true;
  $('rendererNote').hidden=false;
}
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.25;
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x193039);
scene.fog=new THREE.Fog(0x193039,42,125);
const camera=new THREE.PerspectiveCamera(58,1,.1,180);
const poseCamera=new THREE.PerspectiveCamera(58,1,.1,180);
camera.position.set(27,21,-34);camera.lookAt(0,5,0);
scene.add(new THREE.HemisphereLight(0xc8eee5,0x1c2630,2.0));
const sun=new THREE.DirectionalLight(0xffedc9,3.0);sun.position.set(-15,28,7);scene.add(sun);
const rim=new THREE.DirectionalLight(0x86cfed,2.0);rim.position.set(16,12,-18);scene.add(rim);
const mat=(color,roughness=.6,metalness=.1)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const steel=mat(0x405a62,.35,.7), dark=mat(0x163238,.65,.25), floorMat=mat(0x233f49,.92,.05);
const cyan=mat(0x87f0d0,.35,.35), coral=mat(0xff907a,.35,.35), cream=mat(0xe2e9d8,.6,.15);
const emissive=(color)=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.6,roughness:.4});
const cyanLight=emissive(0x8df9d7),coralLight=emissive(0xff967d);
const beamGeometry=new THREE.BoxGeometry(1,1,1);
function box(parent,material,x,y,z,sx,sy,sz) {
  const m=new THREE.Mesh(beamGeometry,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m;
}
function mesh(parent,geometry,material,x=0,y=0,z=0) {const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;}
function line(parent,points,color,opacity=1) {
  const g=new THREE.BufferGeometry().setFromPoints(points);
  const m=new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity}));parent.add(m);return m;
}

// The stadium establishes scale. Its rails and winches make the flight mechanism visible.
box(scene,floorMat,0,-.22,0,27,.4,28);
box(scene,dark,0,-.65,0,29,.5,30);
const grid=new THREE.GridHelper(26,26,0x638980,0x3b5e65);grid.position.y=.01;scene.add(grid);
box(scene,cream,0,.022,0,25,.025,.075);
for(const z of [-12.8,12.8])box(scene,z<0?cyanLight:coralLight,0,.03,z,25,.04,.06);
for(const x of [-12.8,12.8])box(scene,steel,x,.03,0,.07,.04,25.6);
for(const z of [-7,7]) {
  const ring=mesh(scene,new THREE.TorusGeometry(3.5,.035,6,64),z<0?cyan:coral,0,.04,z);ring.rotation.x=Math.PI/2;
  const pad=mesh(scene,new THREE.CircleGeometry(1.4,48),new THREE.MeshBasicMaterial({color:z<0?0x83e8cd:0xff927d,transparent:true,opacity:.08}),0,.025,z);pad.rotation.x=-Math.PI/2;
}
for(const x of [-13.2,13.2])for(const z of [-13.2,0,13.2]) {
  box(scene,steel,x,7.5,z,.28,15,.28);
  box(scene,cream,x,14.8,z,.45,.1,.45);
}
for(const x of [-13.2,13.2]) {box(scene,steel,x,15,0,.3,.35,27);box(scene,cyanLight,x,14.8,0,.025,.035,27);}
for(const z of [-13.2,0,13.2])box(scene,steel,0,15,z,26.4,.35,.3);
for(const z of [-11,-5,5,11])box(scene,dark,0,15.3,z,26,.12,.12);
// Outer concourse with broad silhouettes, open sightlines and light panels.
for(const side of [-1,1]) {
  for(let row=0;row<4;row++)box(scene,mat(row%2?0x304a52:0x29424c),side*(17+row*1.5),.5+row*.55,0,2,.35,34);
  for(let n=-3;n<=3;n++)box(scene,dark,side*23,5,n*6,.7,10,.7);
  box(scene,steel,side*23,10,0,.8,.3,44);
  for(let n=-2;n<=2;n++)box(scene,cream,side*22.8,9,n*9,.05,.15,3.5);
}
for(const z of [-23,23]) {
  box(scene,dark,0,5,z,48,10,.6);
  box(scene,steel,0,10,z,48,.3,.8);
  const panel=box(scene,z<0?cyanLight:coralLight,0,6,z+(z<0?.35:-.35),8,.08,.04);
  panel.material=panel.material.clone();panel.material.emissiveIntensity=.3;
}
// Explicitly synthetic architectural decoration; fixed seed, no fetched assets.
let rng=seed;const random=()=>{rng=(1664525*rng+1013904223)>>>0;return rng/4294967296;};
const particlePositions=new Float32Array(100*3);
for(let i=0;i<100;i++)particlePositions.set([(random()-.5)*60,random()*28,(random()-.5)*65],i*3);
const particlesGeo=new THREE.BufferGeometry();particlesGeo.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));
scene.add(new THREE.Points(particlesGeo,new THREE.PointsMaterial({color:0xc1e8d7,size:.04,transparent:true,opacity:.4})));

function makePlayer(player) {
  const group=new THREE.Group();scene.add(group);
  const uniform=player.team===0?cyan:coral, glow=player.team===0?cyanLight:coralLight;
  mesh(group,new THREE.CapsuleGeometry(.32,.56,4,12),uniform,0,0,0);
  mesh(group,new THREE.SphereGeometry(.27,16,12),cream,0,.79,0);
  const visor=mesh(group,new THREE.SphereGeometry(.272,16,8,0,Math.PI),dark,0,.8,0);visor.rotation.y=-Math.PI/2;
  const headband=mesh(group,new THREE.TorusGeometry(.271,.023,6,24),glow,0,.87,0);headband.rotation.x=Math.PI/2;
  for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5])mesh(group,new THREE.SphereGeometry(.038,6,6),steel,Math.cos(a)*.27,.88,Math.sin(a)*.27);
  const belt=mesh(group,new THREE.TorusGeometry(.34,.035,6,20),dark,0,-.1,0);belt.rotation.x=Math.PI/2;
  const arms=[];
  for(const side of [-1,1]) {
    const arm=new THREE.Group();arm.position.set(side*.28,.23,0);arm.rotation.z=side*.9;group.add(arm);
    mesh(arm,new THREE.CapsuleGeometry(.105,.44,3,8),uniform,0,-.3,0);mesh(arm,new THREE.SphereGeometry(.115,8,8),cream,0,-.64,0);arms.push(arm);
    const leg=mesh(group,new THREE.CapsuleGeometry(.13,.46,3,8),dark,side*.19,-.68,0);leg.rotation.z=side*.14;
    box(group,cream,side*.24,-1.08,.12,.24,.13,.39);
  }
  box(group,dark,0,.05,-.3,.38,.48,.14);
  box(group,glow,0,.1,-.38,.18,.08,.015);
  const field=mesh(scene,new THREE.SphereGeometry(4,20,12),new THREE.MeshBasicMaterial({color:player.team===0?0x8bf6d5:0xffa08b,wireframe:true,transparent:true,opacity:.06,depthWrite:false}));field.visible=false;
  const shadow=mesh(scene,new THREE.RingGeometry(.7,1.05,32),new THREE.MeshBasicMaterial({color:player.team===0?0x8bf6d5:0xffa08b,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}));shadow.rotation.x=-Math.PI/2;
  const rig=new THREE.Group();scene.add(rig);
  const cables=[],carriers=[];
  for(let i=0;i<8;i++) {
    const carrier=new THREE.Group();rig.add(carrier);
    box(carrier,steel,0,0,0,.65,.3,.5);box(carrier,glow,0,-.19,0,.22,.04,.18);
    const drum=mesh(carrier,new THREE.CylinderGeometry(.14,.14,.36,12),dark,0,-.05,0);drum.rotation.z=Math.PI/2;
    const cable=line(rig,[V(),V()],player.team===0?0xace6d2:0xf1b19c,.62);
    carriers.push(carrier);cables.push(cable);
  }
  const rail=box(rig,steel,0,0,0,5,.12,.12);
  return {group,arms,field,shadow,rig,cables,carriers,rail};
}
let models=[];
function rebuildPlayers() {
  for(const model of models)for(const node of [model.group,model.rig,model.field,model.shadow]) {
    scene.remove(node);node.traverse(child=>{if(child.isMesh&&child.geometry!==beamGeometry)child.geometry.dispose();if(child.isLine){child.geometry.dispose();child.material.dispose();}});
  }
  for(const model of models){model.field.material.dispose();model.shadow.material.dispose();}
  models=sim.state.players.map(makePlayer);
}
rebuildPlayers();
const drone=new THREE.Group();scene.add(drone);
mesh(drone,new THREE.SphereGeometry(.16,16,10),cream);
for(const rotation of [[0,0,0],[Math.PI/2,0,0],[0,Math.PI/2,0]]) {
  const cage=mesh(drone,new THREE.TorusGeometry(.53,.035,8,40),cyanLight);cage.rotation.set(...rotation);
}
const rotors=[];
for(let i=0;i<4;i++) {
  const a=i*Math.PI/2+Math.PI/4,x=Math.cos(a)*.28,z=Math.sin(a)*.28;
  const shroud=mesh(drone,new THREE.TorusGeometry(.16,.018,6,18),steel,x,0,z);shroud.rotation.x=Math.PI/2;
  const prop=box(drone,dark,x,.015,z,.28,.018,.045);rotors.push(prop);
}
const trailPositions=new Float32Array(40*3), trailGeometry=new THREE.BufferGeometry();
trailGeometry.setAttribute('position',new THREE.BufferAttribute(trailPositions,3));
const trail=new THREE.Line(trailGeometry,new THREE.LineBasicMaterial({color:0xc5ffe7,transparent:true,opacity:.42}));scene.add(trail);
const trailHistory=[];
const targetMarker=mesh(scene,new THREE.TorusGeometry(.73,.022,6,48),cyanLight);
targetMarker.visible=false;

function updatePlayer(model,p) {
  model.group.position.set(p.pos.x,p.pos.y,p.pos.z);
  model.group.rotation.set(clamp(p.vel.z*.045,-.3,.3),p.team===0?0:Math.PI,clamp(-p.vel.x*.04,-.25,.25));
  model.group.updateMatrixWorld(true);
  for(let i=0;i<2;i++)model.arms[i].rotation.z=(i===0?-1:1)*(.8+p.focus*.38);
  model.field.position.copy(model.group.position);model.field.visible=showField||(p.focus>.1&&started);
  model.field.material.opacity=showField?.065:.012+p.focus*.027;
  model.shadow.position.set(p.pos.x,.045,p.pos.z);model.shadow.scale.setScalar(.75+p.pos.y*.08);
  model.shadow.material.opacity=.25-p.pos.y*.012;
  model.rig.visible=reveal;
  model.rail.position.set(p.pos.x,14.7,p.pos.z);
  for(let i=0;i<8;i++) {
    const visible=i<cableCount;model.cables[i].visible=visible;model.carriers[i].visible=visible;
    if(!visible)continue;
    const a=(i/cableCount)*Math.PI*2+Math.PI/4;
    const end=V(p.pos.x+Math.cos(a)*2.2,14.5,p.pos.z+Math.sin(a)*1.55);
    model.carriers[i].position.copy(end);
    const attachment=V(Math.cos(a)*.34,.13,Math.sin(a)*.24).applyMatrix4(model.group.matrixWorld);
    // Both cable ends follow the rendered harness and trolley. This is kinematics, not a force solver.
    const pos=model.cables[i].geometry.attributes.position;pos.setXYZ(0,attachment.x,attachment.y,attachment.z);pos.setXYZ(1,end.x,end.y,end.z);pos.needsUpdate=true;
    model.cables[i].geometry.computeBoundingSphere();
  }
}
function resize() {renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
function desiredPose() {
  const p=sim.state.players[0];
  if(!started||cameraMode==='arena') {
    poseCamera.position.set(Math.sin(orbitYaw)*43,22,-Math.cos(orbitYaw)*43);poseCamera.lookAt(0,5,0);
  } else if(cameraMode==='detail') {
    poseCamera.position.set(p.pos.x-3.5,p.pos.y+2.2,p.pos.z-4.5);poseCamera.lookAt(p.pos.x,p.pos.y+.7,p.pos.z+1);
  } else {
    const scale=2.15, mobile=innerWidth<800;
    poseCamera.position.set(p.pos.x-1.15,p.pos.y+scale*1.35,p.pos.z-scale*(mobile?4.5:3.5));
    // Steady heading: rival bob and lateral movement do not turn the player's controls.
    poseCamera.lookAt(p.pos.x,p.pos.y+.35,p.pos.z+12);
  }
  return poseCamera;
}
function setCamera(mode) {
  cameraMode=mode;transition={pos:camera.position.clone(),quat:camera.quaternion.clone(),age:0};
  $('cameraButton').innerHTML=mode==='arena'?`${canvasFallback?'Closer view':'Pilot view'} <kbd>V</kbd>`:'Arena view <kbd>V</kbd>';
}
function updateCamera(dt) {
  const target=desiredPose();
  if(transition) {
    transition.age+=dt;const t=clamp(transition.age/.8,0,1),ease=t*t*(3-2*t);
    camera.position.lerpVectors(transition.pos,target.position,ease);camera.quaternion.slerpQuaternions(transition.quat,target.quaternion,ease);
    if(t===1)transition=null;return;
  }
  const t=1-Math.exp(-6*dt);camera.position.lerp(target.position,t);camera.quaternion.slerp(target.quaternion,t);
}
const projected=V();
function tag(id,pos,yOffset) {
  if(canvasFallback) {
    const point=renderer.projected(pos,yOffset),el=$(id);el.hidden=!point.visible;
    el.style.left=`${point.x}px`;el.style.top=`${point.y}px`;return;
  }
  projected.set(pos.x,pos.y+yOffset,pos.z).project(camera);
  const el=$(id);el.hidden=projected.z>1||projected.z< -1||Math.abs(projected.x)>1||Math.abs(projected.y)>1;
  el.style.left=`${(projected.x*.5+.5)*innerWidth}px`;el.style.top=`${(-projected.y*.5+.5)*innerHeight}px`;
}
function updateHud() {
  const s=sim.state,p=s.players[0];
  const owned=s.ball.owner===0&&s.ball.phase==='held',held=primary.sources.size>0||keys.has('KeyE');
  const touch=matchMedia('(pointer:coarse)').matches;
  const action=touch?'the action button':'Space or mouse';
  $('score0').textContent=s.scores[0];$('score1').textContent=s.scores[1];
  $('height').textContent=p.pos.y.toFixed(1);$('velocity').textContent=Math.hypot(p.vel.x,p.vel.y,p.vel.z).toFixed(1);
  $('focusBar').style.width=`${p.focus*100}%`;
  setText('focusLabel',s.mode==='watch'?'Watching':primary.sent?'Launching…':primary.queued?'Charging throw…':p.focus>=.6?(owned?'Ready to throw':'Catch field ready'):held?'Charging…':'Hold to focus');
  let prompt,hint;
  if(s.winner!==null){prompt='Match complete';hint='Fly again for another match.';}
  else if(!s.running&&started){prompt='Paused';hint='Resume when you’re ready.';}
  else if(s.mode==='watch'){prompt='Computer match';hint='Take control in the Flight lab.';}
  else if(s.roundTimer>0){prompt=`Next serve in ${s.roundTimer.toFixed(1)}s`;hint='Get ready to hold, then release.';}
  else if(primary.sent){prompt='Launching your shot…';hint='AUTO-LOCK guides the ball toward your rival.';}
  else if(primary.queued){prompt='Charging your throw…';hint='Your release is queued. The ball launches when ready.';}
  else if(owned&&!s.stats.throws&&!firstServe.moved&&!firstServe.usedAction&&!held){prompt='First serve · try moving';hint=touch?'Drag the stick to fly sideways and up / down.':'WASD / arrows fly · Shift up / F down. Then hold Space.';}
  else if(owned&&p.focus>=.6){prompt=primary.sources.size?'Ready · release to throw':'Ball ready · hold and release to throw';hint='AUTO-LOCK marks your target. Move to change the angle.';}
  else if(owned){prompt=held?'Keep holding to focus…':'Your ball · hold to focus';hint=`Hold ${action}, then release to throw.`;}
  else if(s.ball.phase==='loose'){prompt='Loose ball · hold to retrieve';hint=`Hold ${action} and move into the ball’s field.`;}
  else if(s.ball.phase==='thrown'&&s.players[s.ball.attacker]?.team===1){prompt='Incoming · hold to catch';hint=p.focus>=.6?'Catch field ready. Keep holding near the ball.':`Hold ${action}, or fly out of the way.`;}
  else if(s.ball.phase==='held'&&s.players[s.ball.owner]?.team===0){prompt='Your teammate has the ball';hint='Move into space and prepare to catch the return.';}
  else if(s.ball.phase==='held'){prompt='Rival has the ball';hint=`Fly to dodge, or hold ${action} to prepare a catch.`;}
  else{prompt='Your shot is flying';hint='Fly to dodge the return. Hold to focus and catch.';}
  setText('actionPrompt',prompt);setText('actionHint',hint);
  setText('event',s.event);
  $('rigStatus').textContent=`RIG CONNECTED · ${cableCount} CABLES`;
  const owner=s.players.find(player=>player.id===s.ball.owner);
  $('ballState').textContent=owner?(owner.id===0?'YOUR BALL':owner.team===0?'TEAMMATE’S BALL':'RIVAL’S BALL'):s.ball.phase==='thrown'?'BALL IN FLIGHT':'LOOSE BALL';
  $('pauseButton').textContent=s.running?'Ⅱ':'▶';$('pauseButton').setAttribute('aria-label',s.running?'Pause match':'Resume match');
  $('modeButton').textContent=s.mode==='play'?'Watch computer match':'Take control';
  $('matchLabel').textContent=`${s.mode==='watch'?'COMPUTER MATCH':'DRONE DODGEBALL'} · FIRST TO 5`;
  $('result').hidden=s.winner===null;
  if(s.winner!==null) {
    $('resultTitle').textContent=s.mode==='watch'?`Team ${s.winner===0?'Mint':'Coral'} wins.`:s.winner===0?'You win.':'Rival wins.';
    $('resultText').textContent=`${s.scores[0]} – ${s.scores[1]}. Fly, focus, and try another match.`;
  }
  const target=sim.getTarget(0),locked=owned&&s.mode==='play';
  $('opponentTag').textContent=locked?'AUTO-LOCK RIVAL':'RIVAL';$('opponentTag').classList.toggle('locked',locked);
  if(target)tag('opponentTag',target.pos,1.5);tag('ballTag',s.ball.pos,.95);
  if(started&&s.mode==='play')tag('playerTag',p.pos,canvasFallback?-1.55:1.5);else $('playerTag').hidden=true;
  $('touchThrow').disabled=started&&(!s.running||s.mode!=='play'||s.winner!==null);
  $('touchThrow').setAttribute('aria-pressed',String(primary.sources.size>0));
  setText('touchThrow',primary.sent?'LAUNCHING…':primary.queued?'CHARGING…':owned&&p.focus>=.6&&primary.sources.size?'RELEASE TO THROW':owned?'HOLD → RELEASE':'HOLD TO CATCH');
}
function start(mode='play') {
  started=true;document.body.classList.remove('lobby');$('welcome').hidden=true;
  sim.reset();sim.setMode(mode);sim.setRunning(true);setCamera(mode==='watch'?'arena':'pilot');
  firstServe={moved:false,usedAction:false};$('labDetails').open=false;
  if(mode==='play')sim.state.event='First to five hits wins. Your first serve.';
  clearInputs();trailHistory.length=0;updateHud();$('arena').focus({preventScroll:true});
}
function clearInputs() {
  keys.clear();stick.x=0;stick.y=0;stick.z=0;primary.sources.clear();primary.queued=false;primary.sent=false;
  $('touchThrow').setAttribute('aria-pressed','false');$('knob').style.transform='';sim.clearInput();
}
function actionAllowed() {const s=sim.state;return started&&s.running&&s.mode==='play'&&s.winner===null&&s.roundTimer===0;}
function beginPrimary(source) {
  if(!actionAllowed())return false;
  firstServe.usedAction=true;
  if(primary.queued){primary.queued=false;primary.sent=false;sim.clearInput();}
  primary.sources.add(source);return true;
}
function releasePrimary(source) {
  if(!primary.sources.delete(source)||primary.sources.size)return;
  if(actionAllowed()&&sim.state.ball.phase==='held'&&sim.state.ball.owner===0) {
    primary.queued=true;primary.sent=false;primary.throwCount=sim.state.stats.throws;
  }
}
function cancelPrimary(source) {
  if(!primary.sources.delete(source))return;
  if(!primary.sources.size){primary.queued=false;primary.sent=false;sim.clearInput();}
}
function syncPrimary() {
  if(!primary.queued)return;
  if(!actionAllowed()||sim.state.ball.phase!=='held'||sim.state.ball.owner!==0||sim.state.stats.throws>primary.throwCount) {
    primary.queued=false;primary.sent=false;
  }
}
$('startButton').onclick=()=>start();$('watchButton').onclick=()=>start('watch');
$('cameraButton').onclick=()=>{setCamera(cameraMode==='arena'?'pilot':'arena');$('arena').focus({preventScroll:true});};
$('pauseButton').onclick=()=>{if(!started)return;sim.setRunning(!sim.state.running);clearInputs();updateHud();$('arena').focus({preventScroll:true});};
$('modeButton').onclick=()=>{if(!started){start('watch');return;}sim.setMode(sim.state.mode==='play'?'watch':'play');clearInputs();setCamera(sim.state.mode==='play'?'pilot':'arena');updateHud();$('arena').focus({preventScroll:true});};
function resetMatch() {sim.reset();sim.setRunning(started);firstServe={moved:false,usedAction:false};clearInputs();trailHistory.length=0;updateHud();if(started)$('arena').focus({preventScroll:true});}
$('resetButton').onclick=resetMatch;$('againButton').onclick=resetMatch;
$('showRig').onchange=e=>{reveal=e.target.checked;};$('showField').onchange=e=>{showField=e.target.checked;};
$('cables').onchange=e=>{cableCount=Number(e.target.value);updateHud();};
for(const [id,param,factor,unit] of [['latency','latency',.001,' ms'],['noise','noise',.01,'%'],['speed','ballSpeed',1,' m/s']]) {
  $(id).oninput=e=>{const value=Number(e.target.value);$(id==='speed'?'speedValue':id+'Value').textContent=value+unit;sim.configure({[param]:value*factor});};
}
$('teamSize').onchange=e=>{sim.configure({teamSize:Number(e.target.value)});rebuildPlayers();sim.setRunning(started);firstServe={moved:false,usedAction:false};clearInputs();trailHistory.length=0;updateHud();};
$('quality').onchange=e=>{quality=e.target.value;renderer.setPixelRatio(quality==='light'?1:Math.min(devicePixelRatio||1,1.5));resize();};
const movementKeys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ShiftLeft','ShiftRight','KeyF','Space','KeyE','KeyX','KeyQ','KeyC'];
addEventListener('keydown',e=>{
  if(e.target.matches('input,select')||e.target.matches('button,summary')&&['Space','Enter'].includes(e.code))return;
  if(movementKeys.includes(e.code)){e.preventDefault();keys.add(e.code);}
  if(e.repeat)return;
  if(e.code==='Space')beginPrimary('space');
  if(e.code==='KeyV')setCamera(cameraMode==='arena'?'pilot':'arena');
  if(e.code==='KeyR')resetMatch();
  if(e.code==='Escape'&&started){sim.setRunning(!sim.state.running);clearInputs();updateHud();}
});
addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='Space')releasePrimary('space');});addEventListener('blur',clearInputs);
$('arena').addEventListener('blur',clearInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInputs();if(started)sim.setRunning(false);}lastTime=null;});
$('arena').addEventListener('pointerdown',e=>{
  $('arena').focus({preventScroll:true});
  if(e.button!==0||e.pointerType==='touch')return;
  if(beginPrimary(`pointer:${e.pointerId}`)){e.preventDefault();$('arena').setPointerCapture(e.pointerId);}
});
for(const element of [$('arena'),$('touchThrow')]) {
  element.addEventListener('pointerup',e=>releasePrimary(`pointer:${e.pointerId}`));
  for(const event of ['pointercancel','lostpointercapture'])element.addEventListener(event,e=>cancelPrimary(`pointer:${e.pointerId}`));
}
for(const button of document.querySelectorAll('[data-hold]')) {
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.hold);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>keys.delete(button.dataset.hold));
}
$('touchThrow').onpointerdown=e=>{e.preventDefault();if(beginPrimary(`pointer:${e.pointerId}`))$('touchThrow').setPointerCapture(e.pointerId);};
$('touchDepth').onclick=()=>{
  touchDepth=!touchDepth;stick.x=0;stick.y=0;stick.z=0;$('knob').style.transform='';
  $('touchDepth').setAttribute('aria-pressed',String(touchDepth));$('touchDepth').textContent=touchDepth?'Use altitude ↕':'Use depth ↕';
  $('stickLabel').textContent=touchDepth?'FLY / DEPTH':'FLY / ALTITUDE';
  $('stick').setAttribute('aria-label',touchDepth?'Drag left/right to fly; up/down moves forward/back':'Drag left/right to fly; up/down changes altitude');
};
let stickPointer=null;
function moveStick(e) {const r=$('stick').getBoundingClientRect();let x=(e.clientX-r.left-r.width/2)/36,z=(e.clientY-r.top-r.height/2)/36;const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}stick.x=x;stick.y=touchDepth?0:-z;stick.z=touchDepth?-z:0;$('knob').style.transform=`translate(${x*31}px,${z*31}px)`;}
$('stick').onpointerdown=e=>{e.preventDefault();stickPointer=e.pointerId;$('stick').setPointerCapture(e.pointerId);moveStick(e);};
$('stick').onpointermove=e=>{if(e.pointerId===stickPointer)moveStick(e);};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('stick').addEventListener(event,()=>{stickPointer=null;stick.x=0;stick.y=0;stick.z=0;$('knob').style.transform='';});
function currentInput() {
  syncPrimary();let launch=false;
  // Keep focus active after an early release, then submit exactly one delayed throw.
  if(primary.queued&&!primary.sent&&sim.state.players[0].focus>=.65) {launch=true;primary.sent=true;}
  const right=clamp(Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+stick.x,-1,1);
  const forward=clamp(Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))+stick.z,-1,1);
  const magnitude=Math.min(1,Math.hypot(right,forward));let planar;
  if(canvasFallback)planar=V((forward-right)/1.25,0,(.25*right+forward)/.6);
  else {
    const cameraRight=V(1,0,0).applyQuaternion(camera.quaternion);cameraRight.y=0;cameraRight.normalize();
    const cameraForward=V(0,0,-1).applyQuaternion(camera.quaternion);cameraForward.y=0;cameraForward.normalize();
    planar=cameraRight.multiplyScalar(right).add(cameraForward.multiplyScalar(forward));
  }
  planar.normalize().multiplyScalar(magnitude);
  if(magnitude>0||stick.y||keys.has('ShiftLeft')||keys.has('ShiftRight')||keys.has('KeyF'))firstServe.moved=true;
  return {x:planar.x,z:planar.z,y:clamp(Number(keys.has('ShiftLeft')||keys.has('ShiftRight'))-Number(keys.has('KeyF'))+stick.y,-1,1),focus:primary.sources.size>0||primary.queued||keys.has('KeyE'),throw:launch,curve:Number(keys.has('KeyQ'))-Number(keys.has('KeyC')),brake:keys.has('KeyX')};
}
let frameCount=0,frameTimeTotal=0,cpuTotal=0,metricsAt=0;
const metrics={frameIntervalMs:0,cpuFrameMs:0,drawCalls:0,triangles:0,geometries:0,textures:0,gpuFrameMs:null,renderTargets:0,quality,seed,backend:canvasFallback?'Canvas2D':'WebGL2',postProcessing:false};
function render(dt=1/60) {
  const s=sim.state;
  if(canvasFallback) {
    updateCamera(dt);Object.assign(renderer,{view:started?cameraMode:'lobby',cables:cableCount,reveal,showField,targetId:sim.getTarget(0)?.id});
    renderer.render(scene,camera);return;
  }
  // Update world matrices before attaching cables to animated shoulder anchors.
  for(let i=0;i<s.players.length;i++)updatePlayer(models[i],s.players[i]);
  drone.position.set(s.ball.pos.x,s.ball.pos.y,s.ball.pos.z);drone.rotation.y=s.time*.9;
  for(const rotor of rotors)rotor.rotation.y=s.time*48;
  if(s.running) {trailHistory.push(drone.position.clone());if(trailHistory.length>40)trailHistory.shift();}
  if(trailHistory.length)for(let i=0;i<40;i++){const p=trailHistory[Math.max(0,trailHistory.length-40+i)]||drone.position;trailPositions.set([p.x,p.y,p.z],i*3);}
  trail.geometry.attributes.position.needsUpdate=true;trail.geometry.computeBoundingSphere();trail.visible=s.ball.phase==='thrown';
  updateCamera(dt);
  const target=sim.getTarget(0);
  targetMarker.visible=started&&s.mode==='play'&&s.ball.owner===0&&s.winner===null;
  if(target){targetMarker.position.set(target.pos.x,target.pos.y+.15,target.pos.z);targetMarker.quaternion.copy(camera.quaternion);}
  renderer.render(scene,camera);
}
renderer.setAnimationLoop(now=>{
  const begin=performance.now(),elapsed=lastTime===null?1/60:Math.max(0,(now-lastTime)/1000),dt=clamp(elapsed,0,.1);lastTime=now;
  sim.setInput(currentInput());sim.step(dt);syncPrimary();render(dt);
  if(now-hudAt>80){updateHud();hudAt=now;}
  frameCount++;frameTimeTotal+=elapsed*1000;cpuTotal+=performance.now()-begin;
  if(now-metricsAt>1500) {
    Object.assign(metrics,{frameIntervalMs:frameTimeTotal/frameCount,cpuFrameMs:cpuTotal/frameCount,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,quality});
    $('runtime').textContent=`${Math.round(1000/metrics.frameIntervalMs)} FPS · ${canvasFallback?'CANVAS':quality==='light'?'LIGHT':'STD'}`;
    frameCount=0;frameTimeTotal=0;cpuTotal=0;metricsAt=now;
  }
});
window.__skyball={sim,renderer,scene,camera,metrics,start,setCamera,reset:resetMatch,inspect:()=>({simulation:sim.snapshot(),controls:{primaryHeld:primary.sources.size>0,queuedThrow:primary.queued,throwSent:primary.sent,touchDepth,stick:{...stick},targetId:sim.getTarget(0)?.id},camera:{mode:cameraMode,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,aspect:camera.aspect},rig:{cables:cableCount,visible:reveal,field:showField},metrics:{...metrics},viewport:{width:innerWidth,height:innerHeight,dpr:renderer.getPixelRatio()}}),
  advance(seconds){const running=sim.state.running;sim.setRunning(true);for(let t=0;t<seconds;t+=1/120)sim.step(1/120);sim.setRunning(running);render(1);updateHud();return sim.snapshot();},
  capture(){return $('arena').toDataURL('image/png');}
};
render();updateHud();$('loading').hidden=true;
