// Living oil-painting backdrop: sage, cream and mist-blue strokes drawn in a WebGL shader.
// Strokes drift slowly, swell with the background music, and the palette follows the time of day.
import { ambient } from './ambient.js';

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec3 L; uniform float D;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/R; vec2 p=uv*vec2(R.x/R.y,1.);
 float t=T*.055;
 // brush direction: mostly horizontal, warped like loaded oil paint
 vec2 q=vec2(fbm(p*vec2(1.2,3.)+t),fbm(p*vec2(1.,2.6)-t+4.));
 vec2 w=p+(q-.5)*(.55+L.x*.5);
 float bands=fbm(vec2(w.x*.6+t*.6,w.y*2.5)+q*2.);
 float clouds=fbm(w*1.6-vec2(t,0.)+L.y*.4);
 float y=uv.y+(bands-.5)*.22+(clouds-.5)*.12;
 // time of day: D 0=dawn .33=noon .66=dusk 1=night
 vec3 sky=mix(vec3(.95,.94,.85),vec3(.93,.92,.88),D);
 vec3 haze=mix(vec3(.86,.88,.80),vec3(.83,.86,.88),smoothstep(.4,1.,D));
 vec3 sage=mix(vec3(.72,.78,.62),vec3(.62,.70,.60),D);
 vec3 deep=mix(vec3(.64,.71,.58),vec3(.48,.57,.50),D);
 vec3 mist=vec3(.74,.80,.84);
 vec3 c=mix(deep,sage,smoothstep(.05,.42,y));
 c=mix(c,haze,smoothstep(.38,.62,y));
 c=mix(c,sky,smoothstep(.6,.95,y));
 c=mix(c,mist,smoothstep(.55,.9,clouds)*.35*(1.-uv.y));
 // soft glow that breathes with the music
 float g=exp(-6.*length((uv-vec2(.48+.12*sin(T*.07),.42+.08*sin(T*.05)))*vec2(R.x/R.y,1.)));
 c+=vec3(.10,.09,.07)*g*(.6+L.y*1.6);
 // bristle streaks and canvas grain
 c+=(h(gl_FragCoord.xy+fract(T*.37))-.5)*.012;
 c+=L.z*.04*bands;
 // slow colour drift inside the green–yellow family, different across the canvas
 float hue=.5+.5*sin(T*.09+uv.x*2.2+bands*2.);
 vec3 warm=c*vec3(1.05,1.03,.86), cool=c*vec3(.93,1.03,.95);
 c=mix(cool,warm,hue);
 c=mix(c,vec3(.98,.98,.94),.22);
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
  const uR = u('R'), uT = u('T'), uL = u('L'), uD = u('D');
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
