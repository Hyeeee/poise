// Living oil-painting backdrop: sage, cream and mist-blue strokes drawn in a WebGL shader.
// Strokes drift slowly, swell with the background music, and the palette follows the time of day.
import { ambient } from './ambient.js';

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec3 L; uniform float D; uniform vec3 A; uniform vec3 B;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/R; vec2 p=uv*vec2(R.x/R.y,1.);
 float t=T*.1;
 // brush direction: mostly horizontal, warped like loaded oil paint
 vec2 q=vec2(fbm(p*vec2(1.2,3.)+t),fbm(p*vec2(1.,2.6)-t+4.));
 vec2 w=p+(q-.5)*(.55+L.x*.5);
 float bands=fbm(vec2(w.x*.6+t*.6,w.y*2.5)+q*2.);
 float clouds=fbm(w*1.6-vec2(t,0.)+L.y*.4);
 float y=uv.y+(bands-.5)*.22+(clouds-.5)*.12;
 // Same tone as the cards: a near-white base with two soft pastel washes that drift.
 // A and B are the two wash colours; JS walks them slowly through green, blue, yellow and red,
 // the colours the light bar actually uses.
 vec3 base=vec3(.975,.976,.968);
 float f1=fbm(w*1.1+vec2(t*.8,-t*.5));
 float f2=fbm(w*1.3-vec2(t*.6,t*.4)+7.);
 float m1=smoothstep(.42,.78,f1+(y-.55)*.35);       // leans toward the top, like the cards
 float m2=smoothstep(.45,.8,f2-(y-.45)*.25);
 vec3 c=mix(base,mix(base,A,.75),.35+.15*(y));       // faint all-over tint
 c=mix(c,A,m1*.8);
 c=mix(c,B,m2*.6);
 c=mix(c,vec3(.99,.99,.985),smoothstep(.6,.95,clouds)*.25);
 // soft glow that breathes with the music
 float g=exp(-6.*length((uv-vec2(.48+.12*sin(T*.07),.42+.08*sin(T*.05)))*vec2(R.x/R.y,1.)));
 c+=vec3(.05,.05,.04)*g*(.6+L.y*1.6);
 c+=(h(gl_FragCoord.xy+fract(T*.37))-.5)*.01;
 c+=L.z*.03*bands;
 gl_FragColor=vec4(c,1.);
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
  const uR = u('R'), uT = u('T'), uL = u('L'), uD = u('D'), uA = u('A'), uB = u('B');
  // Wash colours, pastel versions of the light bar's green, blue, yellow and red.
  // Each holds for a while, then blends into the next over several seconds (one full loop ≈ 80 s).
  // Inside the app (studio) it rests on green, so the background never competes with the posture cue.
  const HUES = [[150, 214, 165], [160, 196, 236], [246, 214, 128], [242, 160, 146]].map(c => c.map(v => v / 255));
  const TEAL = [179 / 255, 223 / 255, 218 / 255];
  const mixc = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const ease = k => k * k * (3 - 2 * k);
  const STEP = 20;               // seconds per colour
  const curA = [...HUES[0]], curB = mixc(HUES[0], TEAL, .55);
  document.querySelector('svg.paint')?.remove();
  const scale = .75; // painted texture doesn't need full resolution
  const resize = () => { cv.width = innerWidth * scale; cv.height = innerHeight * scale; gl.viewport(0, 0, cv.width, cv.height); };
  resize(); addEventListener('resize', resize);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lv = [0, 0, 0], t0 = performance.now();
  const frame = now => {
    const hr = new Date().getHours() + new Date().getMinutes() / 60;
    const day = hr < 6 ? 1 : hr < 10 ? (hr - 6) / 12 : hr < 16 ? .33 : hr < 20 ? .33 + (hr - 16) / 12 : 1 - Math.max(0, 24 - hr) / 12;
    const a = ambient.level();
    for (let i = 0; i < 3; i++) lv[i] += (Math.min(1, a[i] * 3) - lv[i]) * .05;
    gl.uniform2f(uR, cv.width, cv.height);
    gl.uniform1f(uT, still ? 0 : (now - t0) / 1000);
    gl.uniform3f(uL, lv[0], lv[1], lv[2]);
    gl.uniform1f(uD, day);
    const secs = still ? 0 : Math.max(0, (now - t0) / 1000), inApp = !document.getElementById('studio')?.hidden;
    const i = Math.floor(secs / STEP) % 4, k = ease(Math.min(1, Math.max(0, (secs % STEP - STEP * .55) / (STEP * .45))));
    const goalA = inApp ? HUES[0] : mixc(HUES[i], HUES[(i + 1) % 4], k);
    const goalB = mixc(goalA, TEAL, .55);
    for (let j = 0; j < 3; j++) { curA[j] += (goalA[j] - curA[j]) * .02; curB[j] += (goalB[j] - curB[j]) * .02; }
    gl.uniform3f(uA, ...curA); gl.uniform3f(uB, ...curB);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
