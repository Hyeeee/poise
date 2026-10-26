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
uniform sampler2D uTex;

vec3 film(float t) { return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec4 outc = vec4(0.);
  for (int i = 0; i < 6; i++) {
    if (i >= uN) break;
    vec2 c = uB[i].xy; float r = uB[i].z; float a = uB[i].w;
    vec3 tint = uC[i].rgb; float pk = uC[i].a;
    vec2 v = p - c; float L = length(v); float d = L / r;
    if (d > 1.0) continue;

    // Bursting: a hole opens from the upper side and sweeps across.
    float tear = 0.;
    if (pk > 0.) {
      vec2 hc = c + vec2(-.45, -.55) * r;
      float hr = pk * 2.4 * r, hd = length(p - hc);
      if (hd < hr) continue;
      tear = smoothstep(hr + r * .12, hr, hd);     // bright curled edge of the tear
      a *= 1. - pk * .5;
    }

    float z = sqrt(max(0., 1. - d * d));
    vec2 dir = v / max(L, 1e-3);
    // Lens: magnify the centre, compress toward the edge, flip the outer rim.
    float k = mix(.55, 1.05, d * d);
    vec2 sp = c + v * k;
    if (d > .8) { float t = (d - .8) / .2; sp = c + dir * r * mix(.84, -.35, t); }
    vec2 uv = (sp - uVR.xy) / uVR.zw;
    vec3 scene = texture2D(uTex, clamp(uv, .001, .999)).rgb;

    float fres = pow(1. - z, 2.2);
    // Thin-film colours: bands that drift and swirl with time.
    float ang = atan(v.y, v.x);
    float th = d * 2.2 + .35 * sin(ang * 2. + uT * .9 + float(i) * 1.7) + .25 * sin(p.y * .025 + uT * 1.3) + uT * .05;
    vec3 col = scene * (1.02 + .04 * z);
    // add the rainbow as light on top of the scene (keeps it clear, not grey)
    col += (film(th) - .45) * (.12 + fres * .7);
    col = mix(col, vec3(1.), fres * .12);
    col += tint * fres * .22;                        // a hint of the bubble's colour
    // Window reflection: a soft bright patch top-left, and a smaller one bottom-right.
    vec2 q = v / r;
    float hl = smoothstep(.3, .0, length((q - vec2(-.36, -.42)) * vec2(1., 1.7)));
    float hl2 = smoothstep(.12, .0, length(q - vec2(.42, .5)));
    col += hl * .75 + hl2 * .35;
    // Fine bright rim.
    col += smoothstep(.95, 1., d) * .45;
    col += tear * .8;

    float alpha = a * mix(.82, 1., fres) * smoothstep(1., .975, d);
    outc = vec4(mix(outc.rgb, col, alpha), max(outc.a, alpha));
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
    this.u = { res: u('uRes'), vr: u('uVR'), t: u('uT'), n: u('uN'), b: u('uB'), c: u('uC') };
  }
  get ok() { return !!this.gl; }
  // list: [{ x, y, r, alpha, color:[r,g,b], pop }] in canvas pixels
  render(list, video, rect, t) {
    const gl = this.gl; if (!gl) return;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!list.length || video.readyState < 2) return;
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); } catch { return; }
    const n = Math.min(6, list.length), B = new Float32Array(24), C = new Float32Array(24);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      B.set([s.x, s.y, s.r, s.alpha], i * 4);
      C.set([s.color[0] / 255, s.color[1] / 255, s.color[2] / 255, s.pop || 0], i * 4);
    }
    gl.uniform2f(this.u.res, w, h);
    gl.uniform4f(this.u.vr, rect.ox, rect.oy, rect.vw, rect.vh);
    gl.uniform1f(this.u.t, t);
    gl.uniform1i(this.u.n, n);
    gl.uniform4fv(this.u.b, B); gl.uniform4fv(this.u.c, C);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  clear() { const gl = this.gl; if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } }
}
