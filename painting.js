// Living backdrop: two soft colours flow over a near-white page like silk bands sliding past
// each other. The pair holds for a while, then slowly turns into another pair
// (green and blue, yellow and orange, ...). A strong film grain gives it a rough, printed texture.
// Inside the app the blobs settle into greens and teals, so the backdrop never competes with the posture cue.
import { ambient } from './ambient.js';

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec3 C1; uniform vec3 C2; uniform vec3 C3; uniform float L;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
// a soft glow: an oval that is round near its core and stretches out into a long soft band
void main(){
 vec2 uv=gl_FragCoord.xy/R; float a=R.x/R.y; vec2 p=vec2(uv.x*a,uv.y);
 float t=T*.2;
 // gently bend space so the outlines are never clean circles
 p+=vec2(.06*sin(p.y*3.1+t*1.3)+.035*sin(p.y*5.3-t*.9), .06*cos(p.x*2.7-t*1.1)+.035*cos(p.x*4.9+t*.8));
 // Six blobs, each on its own path and speed. Where they meet they merge into one shape,
 // where they drift apart the shape splits, so the overall form keeps changing on its own.
 float w1=0., w2=0.;
 for(int i=0;i<6;i++){
  float fi=float(i);
  vec2 c=vec2(a*(.5+.38*sin(t*(.55+fi*.13)+fi*1.7)+.08*sin(t*1.9+fi)),
              .5+.40*cos(t*(.47+fi*.11)+fi*2.3)+.07*cos(t*1.6+fi*1.3));
  float r=.24+.09*sin(t*(.9+fi*.2)+fi);          // each blob breathes in size
  vec2 d=(p-c)/vec2(r*(1.+.5*sin(t*.8+fi*1.9)),r*(1.+.5*cos(t*.7+fi*1.1)));   // and stretches
  float f=exp(-dot(d,d));
  if(mod(fi,2.)<1.) w1+=f; else w2+=f;
 }
 float F=w1+w2;
 vec3 base=vec3(.975,.975,.968);
 vec3 tint=(C1*w1+C2*w2)/max(F,1e-4);              // colour follows whichever blobs are near
 float amt=smoothstep(.0,1.3,F);
 vec3 col=mix(base,tint,amt*.9);
 col+=vec3(.025)*L;
 // still grain, gathered in the colour and fading toward the white
 float g=h(floor(gl_FragCoord.xy))-.5;
 col+=g*(.03+.05*amt);
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
  // Two colours at a time. The pair holds for a while, then slowly turns into the next pair.
  const PAIRS = [['green', 'blue'], ['yellow', 'orange'], ['mint', 'blue'], ['orange', 'red'], ['green', 'yellow'], ['blue', 'mint'], ['red', 'yellow']]
    .map(pr => pr.map(k => P[k].map(v => v / 255)));
  const STEP = 16;                                   // seconds per pair: 10 s held, 6 s blending
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const ease = k => k * k * (3 - 2 * k);
  const cur = [[...PAIRS[0][0]], [...PAIRS[0][1]]];
  const scale = .6;                       // lower resolution keeps the grain visible and the shader cheap
  const resize = () => { cv.width = innerWidth * scale; cv.height = innerHeight * scale; gl.viewport(0, 0, cv.width, cv.height); };
  resize(); addEventListener('resize', resize);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now(); let lv = 0;
  const frame = now => {
    const secs = still ? 0 : (now - t0) / 1000, inApp = !document.getElementById('studio')?.hidden;
    const n = Math.floor(secs / STEP), k = ease(Math.min(1, Math.max(0, (secs / STEP - n - .62) / .38)));
    const A = PAIRS[n % PAIRS.length], B = PAIRS[(n + 1) % PAIRS.length];
    for (let i = 0; i < 2; i++) {
      // Change through near-white, not straight across: blue to orange directly would pass through grey.
      const W = [.975, .975, .968];
      const goal = inApp ? calm[i] : k < .5 ? mix(A[i], W, k * 2) : mix(W, B[i], (k - .5) * 2);
      for (let j = 0; j < 3; j++) cur[i][j] += (goal[j] - cur[i][j]) * .03;
      gl.uniform3f(uC[i], ...cur[i]);
    }
    const a = ambient.level(); lv += (Math.min(1, a[1] * 3) - lv) * .05;
    gl.uniform2f(uR, cv.width, cv.height);
    gl.uniform1f(uT, secs + 10); gl.uniform1f(uL, lv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
