// Living backdrop: the same feel as the side cards' wash, at full screen. Three big soft
// colour blobs drift slowly across a near-white page. Each blob holds its colour for a while,
// then slowly turns into another, each on its own clock, so there are usually two or three
// colours on screen and the mix keeps changing. A film grain on top gives it a rougher texture.
// Inside the app the blobs settle into greens and teals, so the backdrop never competes with the posture cue.
import { ambient } from './ambient.js';

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec3 C1; uniform vec3 C2; uniform vec3 C3; uniform float L;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float blob(vec2 p,vec2 c,vec2 r){vec2 d=(p-c)/r;return exp(-dot(d,d));}
void main(){
 vec2 uv=gl_FragCoord.xy/R; float a=R.x/R.y; vec2 p=vec2(uv.x*a,uv.y);
 float t=T*.05;
 vec3 base=vec3(.975,.975,.965);
 // big, slow, wandering blobs (oval, each on its own path)
 float b1=blob(p,vec2(a*(.25+.30*sin(t*1.0+.3)), .30+.32*sin(t*.73+1.1)), vec2(.62*a*.55,.55));
 float b2=blob(p,vec2(a*(.75+.25*sin(t*.81+2.4)), .62+.30*cos(t*.64+.2)), vec2(.58*a*.55,.60));
 float b3=blob(p,vec2(a*(.50+.38*cos(t*.57+4.0)), .48+.36*sin(t*.92+3.3)), vec2(.50*a*.55,.48));
 vec3 col=base;
 col=mix(col,C1,b1*.9);
 col=mix(col,C2,b2*.85);
 col=mix(col,C3,b3*.75);
 col+=vec3(.025)*L;
 // film grain, a little coarse
 float g=h(floor(gl_FragCoord.xy)+fract(T*7.)*57.)-.5;
 col+=g*.085;
 gl_FragColor=vec4(col,1.);
}`;

export function mountPainting() {
  const cv = document.createElement('canvas');
  cv.className = 'paint-live'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const gl = cv.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) { cv.remove(); return; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { cv.remove(); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = k => gl.getUniformLocation(pr, k);
  const uR = u('R'), uT = u('T'), uC = [u('C1'), u('C2'), u('C3')], uL = u('L');
  document.querySelector('svg.paint')?.remove();
  // Colours: the light bar's family, soft but saturated enough to read as colour (like the references).
  const P = { green: [128, 206, 150], mint: [150, 222, 200], blue: [120, 182, 222], yellow: [246, 214, 110], orange: [242, 150, 90], red: [236, 120, 110] }
  const pal = Object.values(P).map(c => c.map(v => v / 255));
  const calm = [P.green, P.mint, P.blue].map(c => c.map(v => v / 255));
  // Each blob walks the palette on its own clock and offset, so the trio of colours keeps changing.
  const clocks = [{ step: 17, off: 0 }, { step: 23, off: 2 }, { step: 29, off: 4 }];
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const ease = k => k * k * (3 - 2 * k);
  const cur = clocks.map((c, i) => [...pal[c.off]]);
  const scale = .6;                       // lower resolution keeps the grain visible and the shader cheap
  const resize = () => { cv.width = innerWidth * scale; cv.height = innerHeight * scale; gl.viewport(0, 0, cv.width, cv.height); };
  resize(); addEventListener('resize', resize);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now(); let lv = 0;
  const frame = now => {
    const secs = still ? 0 : (now - t0) / 1000, inApp = !document.getElementById('studio')?.hidden;
    clocks.forEach((c, i) => {
      let goal;
      if (inApp) goal = calm[i];
      else {
        const s = secs / c.step, n = Math.floor(s), k = ease(Math.min(1, Math.max(0, (s - n - .6) / .4)));   // hold 60%, blend 40%
        goal = mix(pal[(n + c.off) % pal.length], pal[(n + 1 + c.off) % pal.length], k);
      }
      for (let j = 0; j < 3; j++) cur[i][j] += (goal[j] - cur[i][j]) * .03;
      gl.uniform3f(uC[i], ...cur[i]);
    });
    const a = ambient.level(); lv += (Math.min(1, a[1] * 3) - lv) * .05;
    gl.uniform2f(uR, cv.width, cv.height);
    gl.uniform1f(uT, secs + 10); gl.uniform1f(uL, lv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
