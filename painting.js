// Living backdrop: two soft colours flow over a near-white page like silk bands sliding past
// each other. The pair holds for a while, then slowly turns into another pair
// (green and blue, yellow and orange, ...). A strong film grain gives it a rough, printed texture.
// Inside the app the blobs settle into greens and teals, so the backdrop never competes with the posture cue.
import { ambient } from './ambient.js';

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec3 C1; uniform vec3 C2; uniform vec3 C3; uniform float L; uniform float BAL;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
// a soft glow: an oval that is round near its core and stretches out into a long soft band
float glow(vec2 p,vec2 c,float r,float ang,float st){
 vec2 d=p-c; float cs=cos(ang),sn=sin(ang); d=vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y);
 d.x/=r*st; d.y/=r; return exp(-dot(d,d)*.8);   // wider tail
}
void main(){
 vec2 uv=gl_FragCoord.xy/R; float a=R.x/R.y; vec2 p=vec2(uv.x*a,uv.y);
 float t=T*.22;
 vec3 base=vec3(.975,.975,.968);
 // Shapes keep changing on their own slow clocks: a round glow stretches into a long oval,
 // bends into a swoosh, splits into two lobes, then gathers back into a round glow.
 float s1=.5+.5*sin(t*.9), s2=.5+.5*sin(t*.73+2.1), s3=.5+.5*sin(t*.61+4.2);   // shape clocks: a change every few seconds
 // main glow (bends when s2 is high, so it reads as a curve rather than an oval)
 // wanders up, down and sideways across the screen
 vec2 c1=vec2(a*(.42+.24*sin(t*.5)+.08*sin(t*1.3+1.)), .45+.25*sin(t*.41+1.2)+.06*cos(t*1.1));
 // mostly a wide band that bends into an arc and back (rarely fully round)
 vec2 q1=p; q1.y-=(.10+.20*s2)*sin((p.x-c1.x)*2.2+t*.8);
 float f1=glow(q1,c1,.30+.08*(1.-s1),-.3+.5*sin(t*.31),1.7+1.6*s1);
 // second big glow: always a large soft field, turning and stretching
 vec2 c2=vec2(a*(.62+.22*cos(t*.43+2.)), .55+.24*cos(t*.37+.4));
 float f2=glow(p,c2,.32+.08*s3,.8+.9*cos(t*.29),1.6+1.2*(1.-s3));
 // third: a big lobe that swells out of the main glow and folds back in (no small spots)
 vec2 c3=c1+vec2(cos(t*.45),sin(t*.55))*(.12+.22*s3)*vec2(a*.5,1.);
 float fs=glow(p,c3,.30+.08*s2,t*.2,1.+.8*s1)*.8;
 // BAL changes how much room each colour gets: low = the first colour fills the shape with a small
 // core of the second; high = the second spreads wide and the first is only a thin rim.
 vec3 H=C1, K=C2;
 // the whole page carries a faint tint of the first colour, so white is never flat
 vec3 col=mix(base,H,.10);
 col=mix(col,H,pow(f2,.75)*.62);   // soft, wide falloff: no visible edge
 col=mix(col,H,pow(f1,.7)*.85);
 // core colour sits off-centre inside the band and slides along it, so it never reads as a target
 vec2 cc=c1+vec2(a*.12*sin(t*.7),.06*cos(t*.9));
 vec2 qc=q1; float fc=glow(qc,cc,(.14+.06*s3)+.24*BAL,-.3+.5*sin(t*.31),1.5+1.2*s1)*smoothstep(.05,.5,f1);
 col=mix(col,K,pow(fc,.9)*.85);
 col=mix(col,K,pow(fs,.9)*(.3+.5*BAL));
 float amt=clamp(max(max(f1,f2*.8),fs),0.,1.);
 col+=vec3(.025)*L;
 // still grain (no flicker), gathered in the colour and fading toward the white
 float g=h(floor(gl_FragCoord.xy))-.5;
 col+=g*(.025+.03*amt);   // fine grain over everything, a bit denser in the colour
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
  const uR = u('R'), uT = u('T'), uC = [u('C1'), u('C2'), u('C3')], uL = u('L'), uB = u('BAL');
  document.querySelector('svg.paint')?.remove();
  // Colours: the light bar's family, soft but saturated enough to read as colour (like the references).
  // Several shades in each family the light bar uses, so the pairs keep changing in new ways.
  const P = {
    green: [128, 206, 150], sage: [170, 210, 160], leaf: [150, 214, 120], mint: [150, 222, 200], teal: [120, 200, 196],
    blue: [120, 182, 222], sky: [160, 204, 236], periwinkle: [150, 168, 230],
    yellow: [246, 214, 110], butter: [248, 226, 150], lemon: [236, 222, 96],
    orange: [242, 150, 90], apricot: [246, 184, 120], peach: [246, 190, 160],
    red: [236, 120, 110], coral: [240, 140, 120], rose: [236, 160, 168],
  }
  const pal = Object.values(P).map(c => c.map(v => v / 255));
  const calm = [P.green, P.mint, P.blue].map(c => c.map(v => v / 255));
  // Two colours at a time. The pair holds for a while, then slowly turns into the next pair.
  // Pairs walk around the colour wheel, so each one shares a colour family with the last:
  // blue+yellow, yellow+green, green+orange, orange+red, red+yellow, yellow+blue ... and softer
  // in-family pairs in between.
  const PAIRS = [['green', 'blue'], ['blue', 'butter'], ['yellow', 'green'], ['leaf', 'apricot'], ['green', 'orange'], ['orange', 'red'],
    ['coral', 'yellow'], ['red', 'butter'], ['lemon', 'sky'], ['yellow', 'blue'], ['sky', 'mint'], ['blue', 'green'],
    ['mint', 'peach'], ['teal', 'yellow'], ['periwinkle', 'rose'], ['rose', 'apricot'], ['peach', 'sage'],
    ['sage', 'periwinkle'], ['apricot', 'teal']]
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
    // balance between the pair's two colours drifts on its own, so one or the other takes the lead
    gl.uniform1f(uB, still ? .3 : Math.min(1, Math.max(0, .5 + .55 * Math.sin(secs * .19) + .25 * Math.sin(secs * .53 + 1.3))));
    const a = ambient.level(); lv += (Math.min(1, a[1] * 3) - lv) * .05;
    gl.uniform2f(uR, cv.width, cv.height);
    gl.uniform1f(uT, secs + 10); gl.uniform1f(uL, lv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
