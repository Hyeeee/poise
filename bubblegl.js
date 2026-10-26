// Realistic soap bubbles drawn with WebGL.
// Each bubble acts like a curved lens over the camera image: the middle magnifies you,
// the edge squeezes and flips the picture (like a real bubble), and a thin-film rainbow
// swirls across the surface, strongest at the rim. When popped, a hole tears open from
// one side and races across the film.

const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }';
const FRAG = `
precision highp float;
uniform vec2 uRes;            // canvas size in px
uniform vec4 uVR;             // where the video is drawn: x, y, w, h (px)
uniform float uT;             // time (s)
uniform int uN;               // number of bubbles
uniform vec4 uB[6];           // x, y, radius (px), alpha
uniform vec4 uC[6];           // tint rgb (0-1), pop progress (0 = whole, 0-1 = bursting)
uniform vec4 uS[6];           // seed, wobble amount, -, -
uniform sampler2D uTex;

vec3 film(float t) { return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec4 outc = vec4(0.);
  for (int i = 0; i < 6; i++) {
    if (i >= uN) break;
    vec2 c = uB[i].xy; float r = uB[i].z; float a = uB[i].w;
    vec3 tint = uC[i].rgb; float pk = uC[i].a;
    vec2 v = p - c; float L = length(v);
    // Real bubbles aren't perfect circles: the outline breathes and wobbles a little,
    // differently for every bubble.
    float sd = uS[i].x, wa = uS[i].y;
    float ang = atan(v.y, v.x);
    float wob = 1. + wa * (.6 * sin(2. * ang + uT * .9 + sd) + .35 * sin(3. * ang - uT * 1.2 + sd * 2.3) + .12 * sin(5. * ang + uT * 1.6 + sd * 4.1));
    float d = L / (r * wob);
    if (d > 1.0) continue;

    // Bursting: a hole opens from the upper side and sweeps across.
    float tear = 0.;
    if (pk > 0.) {
      vec2 hc = c + vec2(-.45, -.55) * r;
      float hr = pk * 2.4 * r, hd = length(p - hc);
      if (hd < hr) continue;
      tear = smoothstep(hr + r * .1, hr, hd);
      a *= 1. - pk * .5;
    }

    vec2 dir = v / max(L, 1e-3);
    // Inside: perfectly clear. Toward the rim the film bends light, squeezing the picture
    // inward with a hint of colour fringing (like the glass blobs in the references).
    float e = smoothstep(.7, 1., d);
    float squeeze = 1. - e * e * .38;
    vec2 base = (c + v * squeeze - uVR.xy) / uVR.zw;
    vec2 cfr = dir * e * e * 2.5 / uVR.zw;              // tiny chromatic shift at the edge
    vec3 col = vec3(texture2D(uTex, clamp(base + cfr, .001, .999)).r,
                    texture2D(uTex, clamp(base, .001, .999)).g,
                    texture2D(uTex, clamp(base - cfr, .001, .999)).b);

    // Light lives in the rim: a luminous edge that fades softly inward, brighter where
    // it faces the light (top-left) and its bounce (bottom-right).
    float facing = pow(.5 + .5 * cos(ang + 2.25), 3.) + .55 * pow(.5 + .5 * cos(ang - .9), 4.);
    vec3 rimCol = mix(vec3(1.), tint, .42);
    float glow = pow(d, 9.) * (.55 + 1.1 * facing) + smoothstep(.8, 1., d) * .1;
    col = mix(col, rimCol, clamp(glow, 0., .85));
    // A whisper of the bubble's tone over the whole body.
    col = mix(col, rimCol, .05);
    // Long specular streak hugging the upper-left rim, and a short one lower-right.
    float band = smoothstep(.83, .9, d) * smoothstep(.97, .92, d);
    float s1 = band * smoothstep(.55, .0, abs(ang + 2.25)) ;
    float s2 = band * smoothstep(.3, .0, abs(ang - .95)) * .6;
    col = mix(col, vec3(1.), clamp((s1 + s2) * 1.1, 0., .95));
    // Faint thin-film rainbow only along the lower rim.
    float th = d * 1.4 + .25 * sin(ang * 2. + uT * .5 + sd) + uT * .03;
    col += (film(th) - .5) * pow(d, 10.) * .35 * (.4 + .6 * pow(.5 + .5 * cos(ang - 1.6), 2.));
    col += tear * .5;

    float alpha = a * smoothstep(1., .985, d);
    outc = vec4(col, max(outc.a, alpha));   // straight (not premultiplied) colour
  }
  gl_FragColor = vec4(outc.rgb, outc.a);
}`;

export class BubbleGL {
  constructor(canvas) {
    this.cv = canvas;
    const gl = this.gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) return;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this.gl = null; return; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const u = n => gl.getUniformLocation(pr, n);
    this.u = { res: u('uRes'), vr: u('uVR'), t: u('uT'), n: u('uN'), b: u('uB'), c: u('uC'), s: u('uS') };
  }
  get ok() { return !!this.gl; }
  // list: [{ x, y, r, alpha, color:[r,g,b], pop }] in canvas pixels
  render(list, video, rect, t) {
    const gl = this.gl; if (!gl) return;
    // Full device resolution (retina), so edges and the picture inside stay sharp.
    const dpr = Math.min(3, devicePixelRatio || 1);
    const w = Math.round(this.cv.clientWidth * dpr), h = Math.round(this.cv.clientHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!list.length || video.readyState < 2) return;
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); } catch { return; }
    const n = Math.min(6, list.length), B = new Float32Array(24), C = new Float32Array(24), S = new Float32Array(24);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      B.set([s.x * dpr, s.y * dpr, s.r * dpr, s.alpha], i * 4);
      C.set([s.color[0] / 255, s.color[1] / 255, s.color[2] / 255, s.pop || 0], i * 4);
      S.set([s.seed || 0, s.wobble ?? .06, 0, 0], i * 4);
    }
    gl.uniform2f(this.u.res, w, h);
    gl.uniform4f(this.u.vr, rect.ox * dpr, rect.oy * dpr, rect.vw * dpr, rect.vh * dpr);
    gl.uniform1f(this.u.t, t);
    gl.uniform1i(this.u.n, n);
    gl.uniform4fv(this.u.b, B); gl.uniform4fv(this.u.c, C); gl.uniform4fv(this.u.s, S);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  clear() { const gl = this.gl; if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } }
}
