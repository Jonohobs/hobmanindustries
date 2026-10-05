/**
 * A dependency-free Canvas 2D view of the same Skyball game state.
 * Projection and cable poses illustrate the concept; they do not solve rig forces.
 */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const point = (x, y, z) => ({ x, y, z });
const COLORS = { mint: '#8af4d4', coral: '#ff947f', ivory: '#e6eee0', steel: '#537780' };

export class CanvasArenaRenderer {
  constructor({ canvas, simulation }) {
    this.domElement = canvas;
    this.simulation = simulation;
    this.context = canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('Canvas 2D is unavailable.');
    this.view = 'arena';
    this.cables = 4;
    this.reveal = true;
    this.showField = false;
    this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } };
    this._ratio = 1;
    this._width = canvas.clientWidth || 1280;
    this._height = canvas.clientHeight || 800;
    this._frame = null;
    this._loop = null;
    this._trail = [];
    this._lastTime = -1;
    this._layout();
  }

  setPixelRatio(value) {
    this._ratio = clamp(Number(value) || 1, 0.5, 3);
    this.setSize(this._width, this._height);
  }

  getPixelRatio() { return this._ratio; }

  setSize(width, height, updateStyle = true) {
    this._width = Math.max(1, Number(width) || 1);
    this._height = Math.max(1, Number(height) || 1);
    this.domElement.width = Math.round(this._width * this._ratio);
    this.domElement.height = Math.round(this._height * this._ratio);
    if (updateStyle && this.domElement.style) {
      this.domElement.style.width = `${this._width}px`;
      this.domElement.style.height = `${this._height}px`;
    }
    this._layout();
  }

  setAnimationLoop(callback) {
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._loop = callback;
    if (!callback) return;
    const frame = time => {
      if (!this._loop) return;
      this._loop(time);
      this._frame = requestAnimationFrame(frame);
    };
    this._frame = requestAnimationFrame(frame);
  }

  dispose() { this.setAnimationLoop(null); }

  _layout() {
    const width = this._width, height = this._height;
    const mobile = width < 800;
    const lobby = this.lobby ?? Boolean(this.domElement.ownerDocument?.body?.classList.contains('lobby'));
    const pilot = this.view === 'pilot' && !lobby;
    this._scale = Math.min(width * (mobile ? 0.98 : lobby ? 0.72 : 0.88) / 38,
      height * (mobile ? 0.48 : 0.61) / 27) * (pilot ? 1.08 : 1);
    this._cx = width * (mobile ? lobby ? 0.66 : 0.52 : lobby ? 0.64 : 0.53);
    this._cy = height * (mobile ? 0.64 : 0.71);
    this._offset = point(0, 0, 0);
    if (this.view === 'detail' && !lobby) {
      this._scale *= mobile ? 2 : 2.2;
      const player = this.simulation.state.players[0];
      this._offset = point(player.pos.x, 0, player.pos.z);
      this._cx = width * (mobile ? 0.48 : 0.52);
      this._cy = height * 0.73;
    }
  }

  // CSS pixels, so native HTML world tags align without accounting for DPR.
  projected(position, yOffset = 0) {
    const x = position.x - this._offset.x, z = position.z - this._offset.z;
    const screenX = this._cx + (-x + z * 0.48) * this._scale;
    const screenY = this._cy + (-z * 0.48 - x * 0.25 - (position.y + yOffset) * 0.85) * this._scale;
    return { x: screenX, y: screenY, visible: screenX >= -20 && screenX <= this._width + 20 && screenY >= -20 && screenY <= this._height + 20 };
  }

  _polygon(points, fill, stroke, width = 1) {
    const ctx = this.context;
    ctx.beginPath();
    for (let index = 0; index < points.length; index++) {
      const p = this.projected(points[index]);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
    this.info.render.calls++;
  }

  _line(points, color, width = 1, dash = []) {
    const ctx = this.context;
    ctx.beginPath();
    for (let index = 0; index < points.length; index++) {
      const p = this.projected(points[index]);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.stroke(); ctx.setLineDash([]);
    this.info.render.calls++;
  }

  _circle(position, radius, color, fill = null, width = 1) {
    const points = [];
    for (let index = 0; index <= 64; index++) {
      const angle = index / 64 * Math.PI * 2;
      points.push(point(position.x + Math.cos(angle) * radius, position.y,
        position.z + Math.sin(angle) * radius));
    }
    this._polygon(points, fill, color, width);
  }

  _background() {
    const ctx = this.context, width = this._width, height = this._height;
    const gradient = ctx.createLinearGradient(0, 0, width * 0.8, height);
    gradient.addColorStop(0, '#102932'); gradient.addColorStop(0.55, '#203f45'); gradient.addColorStop(1, '#0c222c');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.63, height * 0.42, 0, width * 0.63, height * 0.42, Math.max(width, height) * 0.6);
    glow.addColorStop(0, '#8ed7bf14'); glow.addColorStop(1, '#101f2900');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    // Broad, quiet stadium silhouettes behind the suspended court.
    for (let side = -1; side <= 1; side += 2) {
      for (let row = 0; row < 5; row++) {
        const x = side * (15 + row * 1.35), y = row * 0.5;
        this._polygon([point(x, y, -17), point(x + side * 1.1, y, -17), point(x + side * 1.1, y, 17), point(x, y, 17)],
          row % 2 ? '#2c464d' : '#223c45', '#75968b18');
      }
      for (const z of [-16, -8, 0, 8, 16]) this._line([point(side * 22, 0, z), point(side * 22, 12, z)], '#365862', 4);
      this._line([point(side * 22, 12, -19), point(side * 22, 12, 19)], '#54757a', 3);
      for (const z of [-12, 0, 12]) this._line([point(side * 22, 10.5, z - 2), point(side * 22, 10.5, z + 2)], '#c6e8d64a', 2);
    }
    this._polygon([point(-23, 0, 22), point(23, 0, 22), point(23, 12, 22), point(-23, 12, 22)], '#152e3855', '#54757a55');
    this._line([point(-23, 12, 22), point(23, 12, 22)], '#6f8f88', 2);
  }

  _court() {
    const ctx = this.context;
    const corners = [point(-12.5, 0, -12.5), point(12.5, 0, -12.5), point(12.5, 0, 12.5), point(-12.5, 0, 12.5)];
    this._polygon([corners[0], corners[1], point(12.5, -0.65, -12.5), point(-12.5, -0.65, -12.5)], '#102832', '#5f807b66');
    this._polygon([corners[0], corners[3], point(-12.5, -0.65, 12.5), point(-12.5, -0.65, -12.5)], '#16333d', '#5f807b55');
    this._polygon(corners, '#274a50', '#8dafa37d', 1.3);
    this._polygon([point(-12.5, 0.01, -12.5), point(12.5, 0.01, -12.5), point(12.5, 0.01, 0), point(-12.5, 0.01, 0)], '#73d9bd08');
    this._polygon([point(-12.5, 0.01, 0), point(12.5, 0.01, 0), point(12.5, 0.01, 12.5), point(-12.5, 0.01, 12.5)], '#ff967c08');
    for (let n = -12; n <= 12; n += 2) {
      this._line([point(n, 0.02, -12.5), point(n, 0.02, 12.5)], '#a8c9bb19', 0.7);
      this._line([point(-12.5, 0.02, n), point(12.5, 0.02, n)], '#a8c9bb19', 0.7);
    }
    this._line([point(-12.5, 0.03, 0), point(12.5, 0.03, 0)], '#d5e6d69e', 1.5);
    this._line([point(-12.5, 0.03, -1.8), point(12.5, 0.03, -1.8)], '#8af4d451', 0.8, [3, 5]);
    this._line([point(-12.5, 0.03, 1.8), point(12.5, 0.03, 1.8)], '#ff947f51', 0.8, [3, 5]);
    for (const z of [-7, 7]) {
      const color = z < 0 ? '#8af4d49c' : '#ff947f9c';
      this._circle(point(0, 0.04, z), 3.5, color, z < 0 ? '#8af4d407' : '#ff947f07', 1.2);
      this._circle(point(0, 0.04, z), 1.3, color, null, 0.7);
    }
    this._line([point(-12.5, 0.07, -12.5), point(12.5, 0.07, -12.5)], '#8af4d4', 2.2);
    this._line([point(-12.5, 0.07, 12.5), point(12.5, 0.07, 12.5)], '#ff947f', 2.2);
    const title = this.projected(point(7, 0.04, -9.7));
    ctx.save();ctx.translate(title.x, title.y);ctx.rotate(0.245);
    ctx.font = `600 ${Math.max(7, this._scale * 0.44)}px ui-sans-serif, system-ui`;
    ctx.letterSpacing = '2px';ctx.fillStyle = '#d8e9dd69';ctx.fillText('SKYBALL', 0, 0);ctx.restore();
  }

  _architecture() {
    if (!this.reveal) return;
    const ctx = this.context;
    // A visible roof plane, open edges and tension lines explain the flight rig.
    for (const x of [-13.2, 13.2]) {
      for (const z of [-13.2, 13.2]) {
        this._line([point(x, 0, z), point(x, 15, z)], '#517781a6', Math.max(2, this._scale * 0.12));
        this._line([point(x - 0.24, 14.8, z), point(x + 0.24, 14.8, z)], '#dbeadd', 2);
      }
      this._line([point(x, 15, -13.2), point(x, 15, 13.2)], '#7a9c9ba1', 2.4);
      this._line([point(x, 14.85, -13.2), point(x, 14.85, 13.2)], '#a1edcf5d', 0.8);
    }
    for (const z of [-13.2, 0, 13.2]) {
      this._line([point(-13.2, 15, z), point(13.2, 15, z)], '#678c91a6', 2);
      for (let x = -12; x < 12; x += 3) this._line([point(x, 15, z), point(x + 1.5, 14.65, z), point(x + 3, 15, z)], '#7c9d9c45', 0.8);
    }
    for (const z of [-10, -5, 5, 10]) this._line([point(-13, 15.2, z), point(13, 15.2, z)], '#81aba540', 0.7);
    const p = this.projected(point(-12.5, 15.4, 10));
    ctx.font = '500 8px ui-sans-serif, system-ui'; ctx.fillStyle = '#a9c9bc9c';
    ctx.fillText('OVERHEAD TROLLEY GRID', p.x, p.y);
  }

  _shadow(player) {
    const center = point(player.pos.x, 0.06, player.pos.z);
    const color = player.team === 0 ? '#8af4d4' : '#ff947f';
    this._circle(center, 0.6 + player.pos.y * 0.06, '#7cbbac4a', '#081e2680', 0.8);
    const ground = this.projected(center), body = this.projected(player.pos);
    const ctx = this.context;
    ctx.save();ctx.strokeStyle = `${color}27`;ctx.setLineDash([2, 4]);ctx.lineWidth = 0.7;
    ctx.beginPath();ctx.moveTo(ground.x, ground.y);ctx.lineTo(body.x, body.y + this._scale);ctx.stroke();ctx.restore();
    ctx.beginPath();ctx.arc(ground.x, ground.y, 2, 0, Math.PI * 2);ctx.fillStyle = `${color}90`;ctx.fill();
  }

  _field(player) {
    if (!(this.showField || player.focus > 0.1)) return;
    const ctx = this.context, projected = this.projected(player.pos);
    const color = player.team === 0 ? '138,244,212' : '255,148,127';
    const alpha = this.showField ? 0.15 : 0.045 + player.focus * 0.08;
    const radius = this._scale * 4;
    const glow = ctx.createRadialGradient(projected.x, projected.y, radius * 0.1, projected.x, projected.y, radius);
    glow.addColorStop(0, `rgba(${color},0)`);glow.addColorStop(0.75, `rgba(${color},${alpha * 0.15})`);glow.addColorStop(1, `rgba(${color},0)`);
    ctx.beginPath();ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);ctx.fillStyle = glow;ctx.fill();
    ctx.strokeStyle = `rgba(${color},${alpha})`;ctx.lineWidth = 1;
    ctx.beginPath();ctx.ellipse(projected.x, projected.y, radius, radius * 0.72, -0.2, 0, Math.PI * 2);ctx.stroke();
    this._circle(player.pos, 4, `rgba(${color},${alpha * 1.8})`, null, player.focus > 0.6 ? 1.4 : 0.8);
  }

  _rig(player) {
    if (!this.reveal) return;
    const ctx = this.context;
    const color = player.team === 0 ? COLORS.mint : COLORS.coral;
    const count = clamp(Math.round(Number(this.cables) || 4), 2, 8);
    this._line([point(player.pos.x - 2.7, 14.7, player.pos.z), point(player.pos.x + 2.7, 14.7, player.pos.z)], '#abcac278', 1.5);
    for (let cable = 0; cable < count; cable++) {
      const angle = cable / count * Math.PI * 2 + Math.PI / 4;
      const trolley = point(player.pos.x + Math.cos(angle) * 2.2, 14.5, player.pos.z + Math.sin(angle) * 1.55);
      const attachment = point(player.pos.x + Math.cos(angle) * 0.3, player.pos.y + 0.2, player.pos.z + Math.sin(angle) * 0.2);
      this._line([attachment, trolley], `${color}89`, 0.85);
      const p = this.projected(trolley), width = Math.max(7, this._scale * 0.6), height = Math.max(3, this._scale * 0.24);
      ctx.fillStyle = '#537780';ctx.fillRect(p.x - width / 2, p.y - height / 2, width, height);
      ctx.strokeStyle = '#bfd5c69c';ctx.lineWidth = 0.6;ctx.strokeRect(p.x - width / 2, p.y - height / 2, width, height);
      ctx.fillStyle = '#19383c';ctx.fillRect(p.x - width * 0.25, p.y, width * 0.5, height * 0.8);
      ctx.fillStyle = color;ctx.fillRect(p.x - width * 0.15, p.y + height * 0.75, width * 0.3, 1.5);
    }
  }

  _avatar(player) {
    const ctx = this.context, p = this.projected(player.pos);
    const unit = Math.max(13, Math.min(29, this._scale * 0.98));
    const color = player.team === 0 ? COLORS.mint : COLORS.coral;
    const direction = player.team === 0 ? 1 : -1;
    const lean = clamp(player.vel.x * 0.025 - player.vel.z * 0.02, -0.2, 0.2);
    ctx.save();ctx.translate(p.x, p.y);ctx.rotate(lean);ctx.lineJoin = 'round';ctx.lineCap = 'round';
    // An actual small human silhouette: flight harness, spread arms, helmet EEG band.
    ctx.strokeStyle = '#112c34';ctx.lineWidth = unit * 0.24;
    for (const side of [-1, 1]) {
      ctx.beginPath();ctx.moveTo(side * unit * 0.13, unit * 0.16);
      ctx.lineTo(side * unit * 0.18, unit * 0.64);ctx.lineTo(side * unit * 0.28, unit * 0.94);ctx.stroke();
      ctx.strokeStyle = '#e1ebdc';ctx.lineWidth = unit * 0.13;
      ctx.beginPath();ctx.moveTo(side * unit * 0.27, unit * 0.96);ctx.lineTo(side * unit * 0.27 + direction * unit * 0.22, unit * 0.96);ctx.stroke();
      ctx.strokeStyle = '#112c34';ctx.lineWidth = unit * 0.24;
    }
    const uniform = ctx.createLinearGradient(-unit * 0.3, 0, unit * 0.3, 0);
    uniform.addColorStop(0, player.team === 0 ? '#4f9b91' : '#b46559');uniform.addColorStop(0.6, color);uniform.addColorStop(1, '#dce9d4');
    ctx.fillStyle = uniform;ctx.beginPath();ctx.moveTo(-unit * 0.28, -unit * 0.43);ctx.lineTo(unit * 0.28, -unit * 0.43);
    ctx.lineTo(unit * 0.21, unit * 0.28);ctx.lineTo(-unit * 0.21, unit * 0.28);ctx.closePath();ctx.fill();
    const spread = 0.75 + player.focus * 0.2;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = color;ctx.lineWidth = unit * 0.17;
      ctx.beginPath();ctx.moveTo(side * unit * 0.25, -unit * 0.3);
      ctx.lineTo(side * unit * 0.5, -unit * 0.15);ctx.lineTo(side * unit * spread, -unit * (player.focus * 0.22));ctx.stroke();
      ctx.beginPath();ctx.arc(side * unit * spread, -unit * (player.focus * 0.22), unit * 0.1, 0, Math.PI * 2);ctx.fillStyle = COLORS.ivory;ctx.fill();
    }
    ctx.fillStyle = '#173038';ctx.fillRect(-unit * 0.24, -unit * 0.04, unit * 0.48, unit * 0.11);
    ctx.strokeStyle = '#203b40';ctx.lineWidth = unit * 0.055;
    ctx.beginPath();ctx.moveTo(-unit * 0.21, -unit * 0.4);ctx.lineTo(unit * 0.14, unit * 0.2);ctx.moveTo(unit * 0.21, -unit * 0.4);ctx.lineTo(-unit * 0.14, unit * 0.2);ctx.stroke();
    ctx.fillStyle = '#bed9ce';ctx.fillRect(-unit * 0.1, -unit * 0.04, unit * 0.2, unit * 0.11);
    ctx.beginPath();ctx.arc(0, -unit * 0.73, unit * 0.25, 0, Math.PI * 2);ctx.fillStyle = COLORS.ivory;ctx.fill();
    ctx.beginPath();ctx.ellipse(direction * unit * 0.055, -unit * 0.74, unit * 0.21, unit * 0.1, 0, 0, Math.PI * 2);ctx.fillStyle = '#183a43';ctx.fill();
    ctx.strokeStyle = color;ctx.lineWidth = unit * 0.05;
    ctx.beginPath();ctx.moveTo(-unit * 0.24, -unit * 0.84);ctx.quadraticCurveTo(0, -unit * 0.96, unit * 0.24, -unit * 0.84);ctx.stroke();
    for (const sensor of [-0.19, 0, 0.19]) {
      ctx.beginPath();ctx.arc(unit * sensor, -unit * (0.9 - Math.abs(sensor) * 0.2), Math.max(1, unit * 0.033), 0, Math.PI * 2);ctx.fillStyle = '#365961';ctx.fill();
    }
    ctx.restore();
    if (player.id === 0 && this.simulation.state.mode === 'play') {
      ctx.strokeStyle = `${color}b0`;ctx.lineWidth = 1;
      ctx.beginPath();ctx.moveTo(p.x - unit * 1.15, p.y - unit * 0.4);ctx.lineTo(p.x - unit * 1.15, p.y - unit * 0.8);ctx.lineTo(p.x - unit * 0.8, p.y - unit * 0.8);
      ctx.moveTo(p.x + unit * 1.15, p.y + unit * 0.45);ctx.lineTo(p.x + unit * 1.15, p.y + unit * 0.85);ctx.lineTo(p.x + unit * 0.8, p.y + unit * 0.85);ctx.stroke();
    }
    this.info.render.calls += 20;
  }

  _ball() {
    const state = this.simulation.state, ball = state.ball;
    const ctx = this.context, p = this.projected(ball.pos), radius = Math.max(8, this._scale * 0.55);
    if (ball.phase === 'thrown' && this._trail.length > 1) {
      for (let index = 1; index < this._trail.length; index++) this._line([this._trail[index - 1], this._trail[index]], `rgba(184,255,225,${index / this._trail.length * 0.45})`, 1.5);
    }
    const color = ball.attacker === null ? '#bfffe6' : state.players[ball.attacker].team === 0 ? COLORS.mint : COLORS.coral;
    ctx.save();ctx.translate(p.x, p.y);
    ctx.shadowColor = `${color}80`;ctx.shadowBlur = 8;
    for (let rotor = 0; rotor < 4; rotor++) {
      const angle = rotor / 4 * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(angle) * radius * 0.53, y = Math.sin(angle) * radius * 0.32;
      ctx.beginPath();ctx.moveTo(0, 0);ctx.lineTo(x, y);ctx.strokeStyle = '#527d82';ctx.lineWidth = 1.5;ctx.stroke();
      ctx.beginPath();ctx.ellipse(x, y, radius * 0.3, radius * 0.16, -0.1, 0, Math.PI * 2);ctx.strokeStyle = '#aecbc0';ctx.lineWidth = 0.9;ctx.stroke();
      ctx.save();ctx.translate(x, y);ctx.rotate(state.time * 28 + rotor);
      ctx.fillStyle = '#102f36';ctx.fillRect(-radius * 0.25, -1, radius * 0.5, 2);ctx.restore();
    }
    ctx.shadowBlur = 0;
    const sphere = ctx.createRadialGradient(-radius * 0.09, -radius * 0.12, 0, 0, 0, radius * 0.31);
    sphere.addColorStop(0, '#ffffff');sphere.addColorStop(0.6, '#e3eeda');sphere.addColorStop(1, '#7aaca1');
    ctx.beginPath();ctx.arc(0, 0, radius * 0.29, 0, Math.PI * 2);ctx.fillStyle = sphere;ctx.fill();
    ctx.strokeStyle = color;ctx.lineWidth = 1.2;
    for (const [ry, rotation] of [[1, 0], [0.36, 0.4], [0.3, -1.13]]) {
      ctx.beginPath();ctx.ellipse(0, 0, radius, radius * ry, rotation, 0, Math.PI * 2);ctx.stroke();
    }
    ctx.restore();
    this.info.render.calls += 15;
  }

  _target() {
    const state=this.simulation.state;
    if(state.mode!=='play'||state.ball.owner!==0||state.winner!==null)return;
    const target=state.players.find(player=>player.id===(this.targetId??this.simulation.getTarget(0)?.id));
    if(!target)return;
    const ctx=this.context,p=this.projected(target.pos,.15),radius=Math.max(13,this._scale*.8);
    ctx.strokeStyle='#8af4d4bb';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.stroke();
    for(let n=0;n<4;n++){
      const angle=n*Math.PI/2;ctx.beginPath();
      ctx.moveTo(p.x+Math.cos(angle)*radius*.9,p.y+Math.sin(angle)*radius*.9);
      ctx.lineTo(p.x+Math.cos(angle)*radius*1.22,p.y+Math.sin(angle)*radius*1.22);ctx.stroke();
    }
    this.info.render.calls+=5;
  }

  render() {
    const state = this.simulation.state, ctx = this.context;
    this._layout();
    ctx.setTransform(this._ratio, 0, 0, this._ratio, 0, 0);
    ctx.globalAlpha = 1;ctx.lineCap = 'round';ctx.lineJoin = 'round';
    this.info.render.calls = 0;
    if (state.time < this._lastTime || state.ball.phase !== 'thrown') this._trail = [];
    if (state.time !== this._lastTime && state.ball.phase === 'thrown') {
      this._trail.push({ ...state.ball.pos });
      if (this._trail.length > 24) this._trail.shift();
    }
    this._lastTime = state.time;
    this._background();this._court();this._architecture();
    for (const player of state.players) this._shadow(player);
    for (const player of state.players) this._field(player);
    for (const player of state.players) this._rig(player);
    const objects = state.players.map(player => ({ player, depth: this.projected(point(player.pos.x, 0, player.pos.z)).y }));
    objects.push({ ball: true, depth: this.projected(point(state.ball.pos.x, 0, state.ball.pos.z)).y });
    objects.sort((a, b) => a.depth - b.depth);
    for (const object of objects) if (object.ball) this._ball(); else this._avatar(object.player);
    this._target();
    // Gentle framing leaves the translucent interface legible, without masking play.
    const vignette = ctx.createRadialGradient(this._width * 0.52, this._height * 0.55,
      Math.min(this._width, this._height) * 0.25, this._width * 0.52, this._height * 0.55, Math.max(this._width, this._height) * 0.7);
    vignette.addColorStop(0, '#06192300');vignette.addColorStop(1, '#06192380');
    ctx.fillStyle = vignette;ctx.fillRect(0, 0, this._width, this._height);
    this.info.render.calls += 3;
  }
}
