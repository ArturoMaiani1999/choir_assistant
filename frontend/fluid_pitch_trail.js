(function (root, factory) {
  const shared = typeof module === 'object' && module.exports ? require('./pitch_shared.js') : root.ChoirPitchShared;
  const api = factory(shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoirFluidPitchTrail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PitchShared) {
  'use strict';

  // Visual-only tuning. Pitch data, timing and score semantics stay outside the renderer.
  const CONFIG = Object.freeze({
    enabled: true,
    historySeconds: 2.8,
    centerlineHistorySeconds: 3.25,
    ribbonWidth: 14,
    coreWidth: 2.5,
    filamentCount: 3,
    flowSpeed: .22,
    warpStrength: .115,
    turbulenceScale: 1.35,
    filamentSharpness: .055,
    glowStrength: .12,
    pastFadeExponent: 1.35,
    headSeconds: .2,
    smoothingPasses: 2,
    joinLimit: 1.35,
    capFadePixels: 16,
    bridgeSeconds: .13,
    bridgeSemitones: .7,
  });
  const FLOATS_PER_VERTEX = 8; // x, y, local n, longitudinal s, fluid energy, core energy, head, cap

  const clamp01 = value => Math.max(0, Math.min(1, value));
  const smoothstep = value => { const x = clamp01(value); return x * x * (3 - 2 * x); };

  // A missing detector frame may split one sung note. Only join a very short
  // gap with matching pitch and take; longer silence remains a real break.
  function reconcileSegments(model, config) {
    const result = [];
    const maxGap = Math.min(config.bridgeSeconds, model.cadence * 3.2);
    for (let index = 0; index < model.segments.length; index += 1) {
      const segment = model.segments[index];
      const previous = result.at(-1), a = previous?.at(-1), b = segment[0];
      const c = model.segments[index + 1]?.[0];
      if (segment.length === 1 && a && c && a.takeId === b.takeId && b.takeId === c.takeId
          && c.time - a.time <= maxGap && Math.abs(c.pitch - a.pitch) <= .55
          && Math.abs(b.pitch - (a.pitch + c.pitch) / 2) > .75) continue;
      if (a && b && a.takeId === b.takeId && b.time > a.time
          && b.time - a.time <= maxGap && Math.abs(b.pitch - a.pitch) <= config.bridgeSemitones)
        previous.push(...segment);
      else result.push(segment.slice());
    }
    return result;
  }

  // Remove an isolated, rapid excursion that returns to its earlier pitch.
  // This only changes drawing points; recorded pitch and scoring stay intact.
  function softenPitchSpikes(source) {
    const points = source.map(point => ({ ...point }));
    const baseline = (a, b, time) => a.pitch + (b.pitch - a.pitch) * (time - a.time) / (b.time - a.time);
    for (let index = 1; index < source.length - 1; index += 1) {
      const a = source[index - 1], b = source[index], c = source[index + 1];
      if (c.time - a.time > .18 || Math.abs(c.pitch - a.pitch) > .55) continue;
      const expected = baseline(a, c, b.time);
      if (Math.abs(b.pitch - expected) > .75) points[index].pitch = expected;
    }
    for (let index = 1; index < source.length - 2; index += 1) {
      const a = source[index - 1], b = source[index], c = source[index + 1], d = source[index + 2];
      if (d.time - a.time > .2 || Math.abs(d.pitch - a.pitch) > .55) continue;
      const errorB = b.pitch - baseline(a, d, b.time), errorC = c.pitch - baseline(a, d, c.time);
      if (errorB * errorC > 0 && Math.abs(errorB) > .75 && Math.abs(errorC) > .75) {
        points[index].pitch = baseline(a, d, b.time);
        points[index + 1].pitch = baseline(a, d, c.time);
      }
    }
    return points;
  }

  // Corner cutting stays inside each pair's convex hull, so visual smoothing
  // cannot invent a pitch excursion or overshoot an attack.
  function smoothPoints(points, passes = 1) {
    let result = points;
    for (let pass = 0; pass < passes && result.length > 1; pass += 1) {
      const next = [result[0]];
      for (let index = 0; index < result.length - 1; index += 1) {
        const a = result[index], b = result[index + 1];
        const blend = amount => ({
          x: a.x + (b.x - a.x) * amount,
          y: a.y + (b.y - a.y) * amount,
          time: a.time + (b.time - a.time) * amount,
          confidence: a.confidence + (b.confidence - a.confidence) * amount,
        });
        next.push(blend(.25), blend(.75));
      }
      next.push(result.at(-1)); result = next;
    }
    return result;
  }

  function unitDirection(from, to) {
    const x = to.x - from.x, y = to.y - from.y, length = Math.hypot(x, y);
    return length > 1e-5 ? { x: x / length, y: y / length } : null;
  }

  // A bounded miter keeps both ribbon edges continuous through a bend. The
  // limit turns very acute corners into a compact bevel instead of allowing
  // the offset edges to cross and form long triangular spikes.
  function joinOffset(points, index, halfWidth, joinLimit = CONFIG.joinLimit) {
    const previous = index ? unitDirection(points[index - 1], points[index]) : null;
    const next = index < points.length - 1 ? unitDirection(points[index], points[index + 1]) : null;
    const direction = next || previous || { x: 1, y: 0 };
    if (!previous || !next) return { x: -direction.y * halfWidth, y: direction.x * halfWidth };
    const previousNormal = { x: -previous.y, y: previous.x };
    const nextNormal = { x: -next.y, y: next.x };
    const sumX = previousNormal.x + nextNormal.x, sumY = previousNormal.y + nextNormal.y;
    const sumLength = Math.hypot(sumX, sumY);
    if (sumLength < 1e-4) return { x: nextNormal.x * halfWidth, y: nextNormal.y * halfWidth };
    const miterX = sumX / sumLength, miterY = sumY / sumLength;
    const denominator = Math.max(.001, Math.abs(miterX * nextNormal.x + miterY * nextNormal.y));
    const turn = previous.x * next.x + previous.y * next.y;
    const curvedWidth = halfWidth * Math.max(.55, (1 + turn) / 2);
    const length = Math.min(curvedWidth / denominator, curvedWidth * joinLimit);
    return { x: miterX * length, y: miterY * length };
  }

  function trailGeometry(samples, xAt, yAt, options = {}) {
    const config = { ...CONFIG, ...(options.config || {}) };
    const timeAt = options.timeAt || (sample => sample.time ?? sample.audioTimeSec);
    const currentTime = Number.isFinite(options.currentTime) ? options.currentTime : timeAt(samples.at(-1) || {});
    const review = options.mode === 'review';
    const model = PitchShared.plumeSegments(samples, xAt, {
      ...options, currentTime, timeAt, mode: options.mode,
    });
    const halfWidth = config.ribbonWidth * Math.max(.4, Math.min(3, options.ribbonScale ?? 1)) / 2;
    const vertices = [];
    let strips = 0;

    const push = (x, y, edge, s, fluidEnergy, coreEnergy, head, cap) => vertices.push(x, y, edge, s, fluidEnergy, coreEnergy, head, cap);
    for (const source of reconcileSegments(model, config)) {
      const visible = source.filter(point => review || currentTime - point.time <= config.centerlineHistorySeconds);
      const points = smoothPoints(softenPitchSpikes(visible).map(point => ({ x: point.x, y: yAt(point.pitch), time: point.time,
        confidence: point.confidence })), config.smoothingPasses);
      if (points.length < 2) continue;
      const strip = [];
      let distance = 0;
      const firstX = points[0].x, lastX = points.at(-1).x;
      const liveHead = !review && currentTime - visible.at(-1).time <= model.cadence * 1.5;
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const x = point.x, y = point.y;
        const previous = points[Math.max(0, index - 1)];
        if (index) distance += Math.hypot(x - previous.x, y - previous.y);
        const startFade = smoothstep((x - firstX) / config.capFadePixels);
        const endFade = liveHead ? 1 : smoothstep((lastX - x) / config.capFadePixels);
        const cap = Math.min(startFade, endFade);
        const offset = joinOffset(points, index, halfWidth * (.45 + .55 * Math.sqrt(cap)), config.joinLimit);
        const age = Math.max(0, currentTime - point.time);
        const confidence = clamp01(point.confidence);
        const fluidAgeEnergy = review ? .72 : clamp01(1 - age / config.historySeconds);
        const coreAgeEnergy = review ? .72 : clamp01(1 - age / config.centerlineHistorySeconds);
        const fluidEnergy = Math.pow(fluidAgeEnergy, config.pastFadeExponent) * confidence;
        const coreEnergy = Math.pow(coreAgeEnergy, config.pastFadeExponent) * confidence;
        const head = review ? 0 : 1 - clamp01(age / config.headSeconds);
        const s = point.time + distance * .0025;
        strip.push([
          x + offset.x, y + offset.y, 1, s, fluidEnergy, coreEnergy, head, cap,
          x - offset.x, y - offset.y, -1, s, fluidEnergy, coreEnergy, head, cap,
        ]);
      }
      if (vertices.length) {
        const last = vertices.slice(-FLOATS_PER_VERTEX);
        push(...last);
        push(...strip[0].slice(0, FLOATS_PER_VERTEX));
      }
      strip.forEach(pair => vertices.push(...pair));
      strips += 1;
    }
    return { vertices: new Float32Array(vertices), vertexCount: vertices.length / FLOATS_PER_VERTEX,
      strips, currentTime, halfWidth, config };
  }

  function smoothCanvasPath(context, points, yAt) {
    if (points.length < 2) return;
    context.beginPath();
    context.moveTo(points[0].x, yAt(points[0].pitch));
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index], next = points[index + 1];
      context.quadraticCurveTo(point.x, yAt(point.pitch), (point.x + next.x) / 2, (yAt(point.pitch) + yAt(next.pitch)) / 2);
    }
    const last = points.at(-1);
    context.lineTo(last.x, yAt(last.pitch));
  }

  function drawFallback(context, samples, xAt, yAt, options = {}) {
    const config = { ...CONFIG, ...(options.config || {}) };
    const timeAt = options.timeAt || (sample => sample.time ?? sample.audioTimeSec);
    const currentTime = Number.isFinite(options.currentTime) ? options.currentTime : timeAt(samples.at(-1) || {});
    const review = options.mode === 'review';
    const model = PitchShared.plumeSegments(samples, xAt, { ...options, currentTime, timeAt });
    context.save();
    if (options.clip) {
      context.beginPath(); context.rect(options.clip.left, options.clip.top,
        options.clip.right - options.clip.left, options.clip.bottom - options.clip.top); context.clip();
    }
    for (const source of reconcileSegments(model, config)) {
      const points = softenPitchSpikes(source.filter(point => review || currentTime - point.time <= config.centerlineHistorySeconds));
      if (points.length < 2) continue;
      const liveHead = !review && currentTime - points.at(-1).time <= model.cadence * 1.5;
      const span = Math.max(1, points.at(-1).x - points[0].x);
      const fadeFraction = Math.min(.45, config.capFadePixels / span);
      const firstEnergy = review ? .72 : Math.pow(clamp01(1 - (currentTime - points[0].time) / config.centerlineHistorySeconds), config.pastFadeExponent);
      const gradient = context.createLinearGradient(points[0].x, 0, points.at(-1).x, 0);
      gradient.addColorStop(0, 'rgba(114,224,210,0)');
      gradient.addColorStop(fadeFraction, `rgba(114,224,210,${.22 * firstEnergy})`);
      if (!liveHead) gradient.addColorStop(1 - fadeFraction, 'rgba(114,224,210,.22)');
      gradient.addColorStop(1, liveHead ? 'rgba(114,224,210,.22)' : 'rgba(114,224,210,0)');
      smoothCanvasPath(context, points, yAt);
      context.strokeStyle = gradient; context.lineWidth = config.ribbonWidth * (options.ribbonScale ?? 1);
      context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke();
      const coreGradient = context.createLinearGradient(points[0].x, 0, points.at(-1).x, 0);
      coreGradient.addColorStop(0, 'rgba(151,244,232,0)');
      coreGradient.addColorStop(fadeFraction, `rgba(151,244,232,${.18 + .45 * firstEnergy})`);
      if (!liveHead) coreGradient.addColorStop(1 - fadeFraction, 'rgba(169,255,244,.96)');
      coreGradient.addColorStop(1, liveHead ? 'rgba(169,255,244,.96)' : 'rgba(169,255,244,0)');
      smoothCanvasPath(context, points, yAt);
      context.strokeStyle = coreGradient; context.lineWidth = config.coreWidth;
      context.stroke();
      if (!review && currentTime - points.at(-1).time < config.headSeconds * 1.5) {
        const last = points.at(-1), x = last.x, y = yAt(last.pitch);
        const halo = context.createRadialGradient(x, y, 0, x, y, config.ribbonWidth);
        halo.addColorStop(0, 'rgba(177,255,246,.2)'); halo.addColorStop(1, 'rgba(114,224,210,0)');
        context.fillStyle = halo; context.beginPath(); context.arc(x, y, config.ribbonWidth, 0, Math.PI * 2); context.fill();
      }
    }
    context.restore();
  }

  const VERTEX_SHADER = `#version 300 es
    precision highp float;
    in vec2 a_position;
    in float a_edge;
    in float a_s;
    in float a_fluid_energy;
    in float a_core_energy;
    in float a_head;
    in float a_cap;
    uniform vec2 u_resolution;
    out float v_n;
    out float v_s;
    out float v_fluid_energy;
    out float v_core_energy;
    out float v_head;
    out float v_cap;
    void main() {
      vec2 clip = a_position / u_resolution * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      v_n = a_edge; v_s = a_s; v_fluid_energy = a_fluid_energy; v_core_energy = a_core_energy; v_head = a_head;
      v_cap = a_cap;
    }`;

  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in float v_n;
    in float v_s;
    in float v_fluid_energy;
    in float v_core_energy;
    in float v_head;
    in float v_cap;
    uniform float u_time;
    uniform float u_intensity;
    uniform float u_core_ratio;
    uniform float u_flow_speed;
    uniform float u_warp_strength;
    uniform float u_turbulence_scale;
    uniform float u_filament_sharpness;
    uniform float u_filament_count;
    uniform float u_glow_strength;
    uniform vec4 u_clip;
    out vec4 outColor;

    float wave(float s, float phase) {
      return sin(s * 1.73 + phase) * .62 + sin(s * 3.11 - phase * .71) * .27 + sin(s * .77 + phase * .37) * .11;
    }
    void main() {
      if (gl_FragCoord.x < u_clip.x || gl_FragCoord.x > u_clip.z ||
          gl_FragCoord.y < u_clip.y || gl_FragCoord.y > u_clip.w) discard;
      float edge = 1.0 - smoothstep(.70, 1.0, abs(v_n));
      float phase = v_s * u_turbulence_scale - u_time * u_flow_speed;
      float warp = wave(v_s * .82, phase * .58) * u_warp_strength;
      float f1 = 1.0 - smoothstep(u_filament_sharpness, u_filament_sharpness * 2.8,
        abs(v_n - (-.39 + warp + .05 * sin(phase * .83))));
      float f2 = 1.0 - smoothstep(u_filament_sharpness * .82, u_filament_sharpness * 2.5,
        abs(v_n - (.04 - warp * .48 + .045 * sin(phase * 1.17 + 2.1))));
      float f3 = 1.0 - smoothstep(u_filament_sharpness, u_filament_sharpness * 2.9,
        abs(v_n - (.42 + warp * .72 + .04 * sin(phase * .69 + 4.2))));
      float filaments = (f2 * .82 + f1 * .62 * step(1.5, u_filament_count)
        + f3 * .55 * step(2.5, u_filament_count)) * edge;
      float aa = max(fwidth(v_n), .004);
      float core = 1.0 - smoothstep(u_core_ratio - aa, u_core_ratio + aa, abs(v_n));
      float body = edge * (.13 + filaments * .31);
      float headLight = v_head * (core * .24 + edge * u_glow_strength);
      float alpha = clamp((body * pow(v_fluid_energy, 1.35) + core * .76 * sqrt(v_core_energy)
        + headLight * v_core_energy) * u_intensity * v_cap, 0.0, .96);
      vec3 cyan = mix(vec3(.447, .878, .824), vec3(.67, .98, .93), clamp(core * .72 + filaments * .4 + v_head * .4, 0.0, 1.0));
      outColor = vec4(cyan * alpha, alpha);
    }`;

  function shader(gl, type, source) {
    const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  }

  class Renderer {
    constructor(canvas, config = {}) {
      this.canvas = canvas;
      this.config = { ...CONFIG, ...config };
      this.fluidEnabled = this.config.enabled;
      this.available = false;
      this.capacity = 0;
      this.contextLost = false;
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.contextLost = true; this.available = false; });
      canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.initialize(); });
      this.initialize();
    }

    initialize() {
      if (!this.fluidEnabled || this.contextLost) return;
      try {
        const gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, depth: false, stencil: false });
        if (!gl) return;
        const program = gl.createProgram();
        gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
        gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        this.gl = gl; this.program = program; this.buffer = gl.createBuffer(); this.capacity = 0;
        this.attributes = ['a_position','a_edge','a_s','a_fluid_energy','a_core_energy','a_head','a_cap'].map(name => gl.getAttribLocation(program, name));
        this.uniforms = Object.fromEntries(['u_resolution','u_time','u_intensity','u_core_ratio','u_flow_speed','u_warp_strength','u_turbulence_scale','u_filament_sharpness','u_filament_count','u_glow_strength','u_clip'].map(name => [name, gl.getUniformLocation(program, name)]));
        gl.enable(gl.BLEND);
        // Overlapping triangles at a tight bend represent the same ribbon,
        // not two layers of light. MAX keeps one coverage value per pixel and
        // prevents alpha accumulation from creating bright angular wedges.
        gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
        this.available = true;
      } catch (_) { this.available = false; }
    }

    resize(cssWidth, cssHeight, dpr) {
      const width = Math.round(cssWidth * dpr), height = Math.round(cssHeight * dpr);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      if (this.gl) this.gl.viewport(0, 0, width, height);
    }

    clear() {
      if (!this.available) return;
      this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    render(samples, xAt, yAt, options = {}) {
      if (!this.fluidEnabled || !this.available || this.contextLost) return false;
      const gl = this.gl, dpr = options.dpr || 1;
      this.resize(options.width, options.height, dpr); this.clear();
      const geometry = trailGeometry(samples, xAt, yAt, { ...options, config: this.config });
      if (!geometry.vertexCount) return true;
      gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      if (geometry.vertices.byteLength > this.capacity) {
        this.capacity = Math.max(geometry.vertices.byteLength, Math.ceil(this.capacity * 1.6), 4096);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.vertices);
      const stride = FLOATS_PER_VERTEX * 4;
      const sizes = [2,1,1,1,1,1,1]; let offset = 0;
      this.attributes.forEach((location, index) => { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, sizes[index], gl.FLOAT, false, stride, offset * 4); offset += sizes[index]; });
      gl.uniform2f(this.uniforms.u_resolution, options.width, options.height);
      gl.uniform1f(this.uniforms.u_time, options.animationTime ?? performance.now() / 1000);
      gl.uniform1f(this.uniforms.u_intensity, Math.max(.15, Math.min(2, options.intensity ?? 1)));
      gl.uniform1f(this.uniforms.u_core_ratio, this.config.coreWidth / Math.max(1, this.config.ribbonWidth));
      gl.uniform1f(this.uniforms.u_flow_speed, this.config.flowSpeed);
      gl.uniform1f(this.uniforms.u_warp_strength, this.config.warpStrength);
      gl.uniform1f(this.uniforms.u_turbulence_scale, this.config.turbulenceScale);
      gl.uniform1f(this.uniforms.u_filament_sharpness, this.config.filamentSharpness);
      gl.uniform1f(this.uniforms.u_filament_count, Math.max(1, Math.min(3, this.config.filamentCount)));
      gl.uniform1f(this.uniforms.u_glow_strength, this.config.glowStrength);
      const clip = options.clip || { left: 0, top: 0, right: options.width, bottom: options.height };
      gl.uniform4f(this.uniforms.u_clip, clip.left * dpr, (options.height - clip.bottom) * dpr, clip.right * dpr, (options.height - clip.top) * dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, geometry.vertexCount);
      return true;
    }
  }

  return { CONFIG, smoothPoints, joinOffset, trailGeometry, drawFallback, Renderer };
});
