/**
 * Skyball's deterministic game model. Distances, EEG response and catch fields
 * are gameplay assumptions, not a hardware or cable-force model.
 *
 * Call step with elapsed seconds; all state changes use a fixed 120 Hz clock.
 * Inputs are sampled on that clock, delayed, then smoothed. A held throw button
 * generates one request, and releasing it arms the next request.
 */
const STEP = 1 / 120;
const TARGET_SCORE = 5;
const DEFAULTS = { seed: 41026, teamSize: 1, latency: 0.25, noise: 0.08, ballSpeed: 12 };
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (v) => ({ x: v.x, y: v.y, z: v.z });
const emptyInput = () => ({ x: 0, y: 0, z: 0, focus: false, throw: false, curve: 0, brake: false });

function parameters(options) {
  return {
    seed: Math.trunc(finite(options.seed, DEFAULTS.seed)) >>> 0,
    teamSize: clamp(Math.trunc(finite(options.teamSize, DEFAULTS.teamSize)), 1, 3),
    latency: clamp(finite(options.latency, DEFAULTS.latency), 0, 1.5),
    noise: clamp(finite(options.noise, DEFAULTS.noise), 0, 0.6),
    ballSpeed: clamp(finite(options.ballSpeed, DEFAULTS.ballSpeed), 6, 24),
  };
}

function randomGenerator(seed) {
  let value = seed;
  return () => {
    value += 0x6D2B79F5;
    let n = value;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function normalize(v, length = 1) {
  const magnitude = Math.hypot(v.x, v.y, v.z);
  if (magnitude < 1e-9) return vec();
  return vec(v.x * length / magnitude, v.y * length / magnitude, v.z * length / magnitude);
}

// First fraction of a swept segment that enters a sphere; avoids tunneling.
function sphereEntry(a, b, center, radius) {
  const px = a.x - center.x, py = a.y - center.y, pz = a.z - center.z;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const c = px * px + py * py + pz * pz - radius * radius;
  if (c <= 0) return 0;
  const aa = dx * dx + dy * dy + dz * dz;
  if (aa < 1e-12) return null;
  const bb = 2 * (px * dx + py * dy + pz * dz);
  const determinant = bb * bb - 4 * aa * c;
  if (determinant < 0) return null;
  const fraction = (-bb - Math.sqrt(determinant)) / (2 * aa);
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}

export function createSimulation(options = {}) {
  // Keep the public object stable across reset so renderers can retain it.
  const state = {};
  let params = parameters({ ...DEFAULTS, ...options });
  let rng, tick, accumulator, input, pendingThrow, delayed, commandQueue;
  let intents, botTraits, heldSince, shotId, activeShot, servePlayer, roundTicks;

  function emit(type, text) {
    state.event = text;
    state.eventLog.push({ time: state.time, type, text });
    if (state.eventLog.length > 80) state.eventLog.shift();
  }

  function homePosition(player) {
    const slot = player.id % params.teamSize;
    const spacing = params.teamSize > 1 ? 5 : 0;
    return vec((slot - (params.teamSize - 1) / 2) * spacing, 5 + slot * 0.55,
      player.team === 0 ? -7 : 7);
  }

  function playersHome() {
    for (const player of state.players) {
      Object.assign(player.pos, homePosition(player));
      Object.assign(player.vel, vec());
      player.focus = 0;
      intents.set(player.id, vec());
    }
  }

  function ballAt(player) {
    return vec(player.pos.x, player.pos.y + 0.15,
      player.pos.z + (player.team === 0 ? 0.95 : -0.95));
  }

  function holdBall(player) {
    state.ball.owner = player.id;
    state.ball.attacker = null;
    state.ball.phase = 'held';
    Object.assign(state.ball.pos, ballAt(player));
    Object.assign(state.ball.vel, vec());
    state.ball.flightTime = 0;
    heldSince = state.time;
    activeShot = null;
  }

  function reset(nextOptions = {}) {
    const previousMode = state.mode || 'play';
    params = parameters({ ...params, ...nextOptions });
    rng = randomGenerator(params.seed);
    tick = 0;
    accumulator = 0;
    input = emptyInput();
    delayed = emptyInput();
    pendingThrow = false;
    commandQueue = [];
    intents = new Map();
    botTraits = new Map();
    shotId = 0;
    activeShot = null;
    roundTicks = 0;
    servePlayer = null;
    Object.assign(state, {
      time: 0, running: true, mode: previousMode, params: { ...params },
      players: [], scores: [0, 0], winner: null,
      ball: { pos: vec(), vel: vec(), owner: 0, attacker: null, phase: 'held', flightTime: 0 },
      event: '', eventLog: [], stats: { throws: 0, catches: 0, hits: 0, misses: 0 },
      shots: [], roundTimer: 0, targetScore: TARGET_SCORE,
    });
    for (let id = 0; id < params.teamSize * 2; id++) {
      const player = { id, team: id < params.teamSize ? 0 : 1, pos: vec(), vel: vec(), focus: 0, score: 0 };
      state.players.push(player);
      intents.set(id, vec());
      botTraits.set(id, {
        phase: rng() * Math.PI * 2,
        holdDelay: 1.1 + rng() * 0.75,
        defend: false,
        reaction: 0.45 + rng() * 0.35,
        dodgeSign: id % 2 ? -1 : 1,
      });
    }
    playersHome();
    holdBall(state.players[0]);
    emit('ready', 'Blue serves. Focus to guide your flight and charge the ball.');
    return state;
  }

  function setInput(next = {}) {
    const nextInput = { ...input, ...next };
    for (const axis of ['x', 'y', 'z', 'curve']) nextInput[axis] = clamp(finite(nextInput[axis], 0), -1, 1);
    for (const flag of ['focus', 'throw', 'brake']) nextInput[flag] = Boolean(nextInput[flag]);
    if (nextInput.throw && !input.throw) pendingThrow = true;
    input = nextInput;
  }

  function isHuman(player) { return state.mode === 'play' && player.id === 0; }

  function getTarget(playerId = 0) {
    const player = state.players.find(candidate => candidate.id === playerId);
    if (!player) return null;
    const opponents = state.players.filter(candidate => candidate.team !== player.team);
    return opponents.reduce((nearest, candidate) => !nearest || distance(player.pos, candidate.pos) < distance(player.pos, nearest.pos) ? candidate : nearest, null);
  }

  function clearInput() {
    input = emptyInput();
    delayed = emptyInput();
    pendingThrow = false;
    commandQueue = [];
  }

  function botCommand(player) {
    const trait = botTraits.get(player.id);
    const ball = state.ball;
    const held = ball.phase === 'held' && ball.owner === player.id;
    const incoming = ball.phase === 'thrown' && state.players[ball.attacker]?.team !== player.team;
    const danger = incoming && distance(player.pos, ball.pos) < 6 && ball.flightTime > trait.reaction;
    const loose = ball.phase === 'loose';
    const home = homePosition(player);
    let targetX = home.x + Math.sin(state.time * 0.52 + trait.phase) * 2.3;
    let targetY = home.y + Math.sin(state.time * 0.8 + trait.phase) * 1.2;
    let targetZ = home.z + Math.sin(state.time * 0.34 + trait.phase) * 0.7;
    if (danger && !trait.defend) {
      targetX = clamp(player.pos.x + trait.dodgeSign * 3, -9, 9);
      targetY = clamp(player.pos.y + Math.sin(trait.phase) * 1.2, 2.5, 9);
    } else if (loose) {
      targetX = ball.pos.x;
      targetY = ball.pos.y;
      targetZ = ball.pos.z;
    }
    return {
      x: clamp((targetX - player.pos.x) * 0.55, -1, 1),
      y: clamp((targetY - player.pos.y) * 0.65, -1, 1),
      z: clamp((targetZ - player.pos.z) * 0.5, -1, 1),
      focus: held || loose || (danger && trait.defend),
      throw: held && state.time - heldSince >= trait.holdDelay,
      curve: 0,
      brake: false,
    };
  }

  function movePlayer(player, command) {
    const focusTarget = command.focus ? 1 : 0;
    const focusRate = command.focus ? 3.4 : 4.5;
    player.focus += (focusTarget - player.focus) * (1 - Math.exp(-focusRate * STEP));
    const target = normalize(vec(command.x, command.y, command.z));
    // Preserve analogue magnitude below one, while normalizing diagonal input.
    const amplitude = Math.min(1, Math.hypot(command.x, command.y, command.z));
    const intent = intents.get(player.id);
    const response = 1 - Math.exp(-STEP / (0.12 + params.noise * 0.5));
    const precision = isHuman(player) && command.focus ? params.noise : 0;
    for (const axis of ['x', 'y', 'z']) {
      const noise = precision ? (rng() * 2 - 1) * precision * 0.85 : 0;
      intent[axis] += (target[axis] * amplitude + noise - intent[axis]) * response;
      const speed = command.brake ? 0 : 5.5 * (0.68 + player.focus * 0.32);
      const acceleration = command.brake ? 14 : 6.5;
      player.vel[axis] += (intent[axis] * speed - player.vel[axis]) * (1 - Math.exp(-acceleration * STEP));
      player.pos[axis] += player.vel[axis] * STEP;
    }
    const bounds = { x: [-9.5, 9.5], y: [2, 9.5], z: player.team === 0 ? [-10, -1.8] : [1.8, 10] };
    for (const axis of ['x', 'y', 'z']) {
      const bounded = clamp(player.pos[axis], ...bounds[axis]);
      if (bounded !== player.pos[axis]) player.vel[axis] = 0;
      player.pos[axis] = bounded;
    }
  }

  function throwBall(player) {
    if (state.ball.owner !== player.id || state.ball.phase !== 'held') return;
    if (player.focus < 0.6) {
      if (isHuman(player)) emit('focus', 'Keep focus held a little longer before throwing.');
      return;
    }
    const opponents = state.players.filter((candidate) => candidate.team !== player.team);
    const target = getTarget(player.id);
    const origin = ballAt(player);
    const travel = distance(origin, target.pos) / params.ballSpeed;
    const aim = vec(target.pos.x + target.vel.x * travel * 0.7,
      target.pos.y + target.vel.y * travel * 0.7,
      target.pos.z + target.vel.z * travel * 0.65);
    const direction = normalize(vec(aim.x - origin.x, aim.y - origin.y, aim.z - origin.z), params.ballSpeed);
    Object.assign(state.ball.pos, origin);
    Object.assign(state.ball.vel, direction);
    Object.assign(state.ball, { owner: null, attacker: player.id, phase: 'thrown', flightTime: 0 });
    state.stats.throws++;
    activeShot = { id: ++shotId, time: state.time, attacker: player.id, target: target.id, from: copy(origin), to: copy(aim), result: 'flying' };
    state.shots.push(activeShot);
    if (state.shots.length > 40) state.shots.shift();
    for (const opponent of opponents) {
      const trait = botTraits.get(opponent.id);
      trait.defend = rng() < 0.42;
      trait.dodgeSign = opponent.pos.x < origin.x ? -1 : 1;
    }
    emit('throw', `${player.team === 0 ? 'Blue' : 'Orange'} launches a guided shot.`);
  }

  function finishShot(result) {
    if (activeShot) {
      activeShot.result = result;
      activeShot.endedAt = state.time;
      activeShot.end = copy(state.ball.pos);
    }
  }

  function scoreHit(target) {
    const attacker = state.players[state.ball.attacker];
    const scoringTeam = attacker ? attacker.team : 1 - target.team;
    finishShot('hit');
    state.stats.hits++;
    state.scores[scoringTeam]++;
    if (attacker) attacker.score++;
    emit('hit', `${scoringTeam === 0 ? 'Blue' : 'Orange'} scores! ${state.scores[0]} – ${state.scores[1]}.`);
    if (state.scores[scoringTeam] >= TARGET_SCORE) {
      state.winner = scoringTeam;
      state.running = false;
      Object.assign(state.ball.vel, vec());
      emit('win', `${scoringTeam === 0 ? 'Blue' : 'Orange'} wins the match.`);
      return;
    }
    servePlayer = target.id;
    playersHome();
    holdBall(state.players[servePlayer]);
    roundTicks = Math.round(1.5 / STEP);
    state.roundTimer = 1.5;
  }

  function catchBall(player) {
    finishShot('caught');
    state.stats.catches++;
    holdBall(player);
    emit('catch', `${player.team === 0 ? 'Blue' : 'Orange'} catches with the focus field.`);
  }

  function missBall() {
    finishShot('missed');
    state.stats.misses++;
    Object.assign(state.ball, { owner: null, attacker: null, phase: 'loose' });
    Object.assign(state.ball.vel, vec());
    activeShot = null;
    emit('miss', 'Shot missed. The drone ball returns toward a contender.');
  }

  function updateBall(commands) {
    const ball = state.ball;
    if (ball.phase === 'held') {
      const owner = state.players[ball.owner];
      Object.assign(ball.pos, ballAt(owner));
      Object.assign(ball.vel, owner.vel);
      return;
    }
    if (ball.phase === 'loose') {
      const nearest = state.players.reduce((best, player) => distance(player.pos, ball.pos) < distance(best.pos, ball.pos) ? player : best);
      const toward = normalize(vec(nearest.pos.x - ball.pos.x, nearest.pos.y - ball.pos.y, nearest.pos.z - ball.pos.z), 3.4);
      for (const axis of ['x', 'y', 'z']) {
        ball.vel[axis] += (toward[axis] - ball.vel[axis]) * (1 - Math.exp(-3 * STEP));
        ball.pos[axis] += ball.vel[axis] * STEP;
      }
      const contender = state.players.filter((player) => player.focus > 0.3 && distance(player.pos, ball.pos) <= 5.5)
        .sort((a, b) => distance(a.pos, ball.pos) - distance(b.pos, ball.pos))[0];
      if (contender) {
        holdBall(contender);
        emit('pickup', `${contender.team === 0 ? 'Blue' : 'Orange'} recovers the drone ball.`);
      }
      return;
    }
    ball.flightTime += STEP;
    const attacker = state.players[ball.attacker];
    const steering = commands.get(attacker.id);
    if (attacker.focus > 0.35 && steering?.focus && steering.curve) {
      ball.vel.x += steering.curve * attacker.focus * 8 * STEP;
      Object.assign(ball.vel, normalize(ball.vel, params.ballSpeed));
    }
    const previous = copy(ball.pos);
    for (const axis of ['x', 'y', 'z']) ball.pos[axis] += ball.vel[axis] * STEP;
    let contact = null;
    for (const player of state.players) {
      if (player.team === attacker.team) continue;
      const canCatch = player.focus > 0.6 && ball.flightTime > 0.18;
      const fraction = sphereEntry(previous, ball.pos, player.pos, canCatch ? 4 : 1.05);
      if (fraction !== null && (!contact || fraction < contact.fraction)) contact = { player, fraction, canCatch };
    }
    if (contact) {
      if (contact.canCatch) catchBall(contact.player); else scoreHit(contact.player);
      return;
    }
    if (Math.abs(ball.pos.x) > 11.5 || ball.pos.y < 0.7 || ball.pos.y > 11.5 || Math.abs(ball.pos.z) > 12 || ball.flightTime > 3.2) missBall();
  }

  function fixedStep() {
    tick++;
    state.time = tick * STEP;
    if (roundTicks > 0) {
      roundTicks--;
      state.roundTimer = roundTicks * STEP;
      pendingThrow = false;
      commandQueue = [];
      delayed = emptyInput();
      if (!roundTicks) {
        heldSince = state.time;
        emit('serve', `${state.players[servePlayer].team === 0 ? 'Blue' : 'Orange'} serves the next point.`);
      }
      return;
    }
    const latencyTicks = Math.round(params.latency / STEP);
    commandQueue.push({ due: tick + latencyTicks, command: { ...input, throw: pendingThrow } });
    pendingThrow = false;
    let throwRequest = false;
    while (commandQueue.length && commandQueue[0].due <= tick) {
      delayed = commandQueue.shift().command;
      throwRequest ||= delayed.throw;
    }
    const commands = new Map();
    for (const player of state.players) {
      const command = isHuman(player) ? { ...delayed, throw: throwRequest } : botCommand(player);
      commands.set(player.id, command);
      movePlayer(player, command);
    }
    for (const player of state.players) if (commands.get(player.id).throw) throwBall(player);
    updateBall(commands);
  }

  function step(dt) {
    if (!state.running || state.winner !== null) return state;
    accumulator += clamp(finite(dt, 0), 0, 0.25);
    // Epsilon ensures 30 / 60 / 120 Hz all produce the same fixed-step count.
    while (accumulator + 1e-10 >= STEP && state.running) {
      accumulator -= STEP;
      fixedStep();
    }
    return state;
  }

  function configure(next = {}) {
    const configured = parameters({ ...params, ...next });
    if (configured.teamSize !== params.teamSize || configured.seed !== params.seed) return reset(configured);
    params = configured;
    state.params = { ...params };
    // Existing sampled commands retain their established due times.
    if (state.ball.phase === 'thrown') Object.assign(state.ball.vel, normalize(state.ball.vel, params.ballSpeed));
    return state;
  }

  function setMode(mode) {
    if (!['play', 'watch'].includes(mode)) return state;
    state.mode = mode;
    pendingThrow = false;
    input = emptyInput();
    delayed = emptyInput();
    commandQueue = [];
    emit('mode', mode === 'watch' ? 'Watching both teams use simulated intent.' : 'You control Blue player 1.');
    return state;
  }

  function setRunning(running) {
    state.running = Boolean(running) && state.winner === null;
    accumulator = 0;
    // Paused inputs must never become queued actions when play resumes.
    pendingThrow = false;
    input = emptyInput();
    delayed = emptyInput();
    commandQueue = [];
    return state;
  }

  reset();
  return { state, step, reset, configure, setInput, clearInput, getTarget, setMode, setRunning,
    snapshot: () => JSON.parse(JSON.stringify(state)) };
}
