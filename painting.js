// Living backdrop: a grainy mesh gradient. Soft, shapeless blobs of green, blue, yellow,
// orange and red drift on their own paths at their own speeds, so they keep overlapping
// and mixing in new ways instead of taking turns. A fine film grain sits on top.
// Inside the app the warm blobs fade back, so the backdrop never competes with the posture cue.
import { ambient } from './ambient.js';

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform float K; uniform float L;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.07+vec2(3.1,1.7);a*=.5;}return v;}
// one soft blob: centre wanders on a Lissajous path, the edge is warped by noise so it has no clean shape
float blob(vec2 p,vec2 c,float r){vec2 d=p-c;return exp(-dot(d,d)/(r*r));}
void main(){
 vec2 uv=gl_FragCoord.xy/R; float asp=R.x/R.y; vec2 p=vec2(uv.x*asp,uv.y);
 float t=T*.06;
 // warp space with slow noise, so every blob is irregular and they smear into each other
 vec2 w=p+vec2(fbm(p*1.3+vec2(t,-t*.7)),fbm(p*1.3+vec2(-t*.6,t)+5.))*.55-.27;
 float cx=asp*.5;
 vec3 base=vec3(.976,.972,.955);
 // colours: the light bar's family, softened
 vec3 G=vec3(.56,.82,.58), B=vec3(.52,.74,.90), Y=vec3(.98,.86,.46), O=vec3(.97,.64,.38), Rd=vec3(.94,.50,.45), C=vec3(.50,.80,.76);
 float warm=1.-K*.88;
 // different frequencies and phases per blob: they never line up into a repeating order
 float g =blob(w,vec2(cx+sin(t*1.1+0.)*asp*.42, .50+cos(t*.83+1.3)*.42), .42+.06*sin(t*.7));
 float b =blob(w,vec2(cx+sin(t*.77+2.1)*asp*.45, .48+sin(t*1.13+.4)*.44), .46+.06*cos(t*.9));
 float y =blob(w,vec2(cx+cos(t*.93+4.2)*asp*.40, .55+sin(t*.71+2.7)*.40), .36+.05*sin(t*1.2))*warm;
 float o =blob(w,vec2(cx+sin(t*1.27+5.0)*asp*.44, .45+cos(t*1.05+3.9)*.43), .32+.05*cos(t*.8))*warm;
 float r =blob(w,vec2(cx+cos(t*.61+1.0)*asp*.46, .52+sin(t*.89+5.2)*.45), .28+.04*sin(t*1.4))*warm;
 float c =blob(w,vec2(cx+sin(t*.53+3.3)*asp*.38, .50+cos(t*1.21+.8)*.38), .40);
 // weighted mix (mesh-gradient style): where blobs overlap their colours blend, empty space stays ivory
 float bw=.55;
 vec3 col=(base*bw+G*g+B*b+Y*y+O*o+Rd*r+C*c*.8)/(bw+g+b+y+o+r+c*.8);
 // a little lighter overall so text on top stays easy to read
 col=mix(col,base,.18+K*.12);
 col+=vec3(.03,.028,.02)*L;
 // film grain: fine, slightly animated, monochrome
 float gr=h(gl_FragCoord.xy+fract(T*13.)*91.)-.5;
 col+=gr*.055;
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
  const uR = u('R'), uT = u('T'), uK = u('K'), uL = u('L');
  document.querySelector('svg.paint')?.remove();
  // Full device resolution would make the grain too fine to see; this keeps it soft but visible.
  const scale = Math.min(1, (devicePixelRatio || 1) * .6);
  const resize = () => { cv.width = innerWidth * scale; cv.height = innerHeight * scale; gl.viewport(0, 0, cv.width, cv.height); };
  resize(); addEventListener('resize', resize);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now(); let k = 0, lv = 0;
  const frame = now => {
    const inApp = !document.getElementById('studio')?.hidden;
    k += ((inApp ? 1 : 0) - k) * .015;                 // warm colours ease out over a few seconds in the app
    const a = ambient.level(); lv += (Math.min(1, a[1] * 3) - lv) * .05;
    gl.uniform2f(uR, cv.width, cv.height);
    gl.uniform1f(uT, still ? 20 : (now - t0) / 1000 + 20);
    gl.uniform1f(uK, k); gl.uniform1f(uL, lv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
