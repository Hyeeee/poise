// Demo only: a stand-in for MediaPipe that returns a steady seated pose (steer it with window.__P).
const pt=(x,y,v=1)=>({x,y,z:0,visibility:v});
  function L(){ const P=Object.assign({lean:0,shift:0,fwd:0,near:1,armUp:0,armOut:0,away:0},globalThis.__P||{});
    const a=Array.from({length:33},()=>pt(.5,.5,0)); if(P.away) return a;
    const cx=.5+P.shift, sy=.64, hw=.085*P.near, ly=P.lean;
    // MediaPipe: 11 = person's left shoulder, on the image's right (larger x).
    a[11]=pt(cx+hw, sy+ly); a[12]=pt(cx-hw, sy-ly);
    const hx=cx+ly*1.4, hy=sy-.24*P.near+P.fwd*.07;
    a[0]=pt(hx,hy); a[7]=pt(hx+.035*P.near,hy+.005); a[8]=pt(hx-.035*P.near,hy+.005);
    a[2]=pt(hx+.016,hy-.02+ly*.5); a[5]=pt(hx-.016,hy-.02-ly*.5);
    const u=P.armUp, o=P.armOut;
    // Arms rest down by the sides, forearms angled in toward a desk. armUp raises the left arm straight up.
    a[13]=pt(cx+hw+.012+u*.03, sy+.17-u*.30, .9); a[15]=pt(cx+hw-.025+u*.07, sy+.30-u*.58, .9);
    a[14]=pt(cx-hw-.012, sy+.17, .9); a[16]=pt(cx-hw+.025, sy+.30, .9);
    a[23]=pt(cx+.06,.98,.3); a[24]=pt(cx-.06,.98,.3); return a; }
  export const FilesetResolver={forVisionTasks:async()=>({})};
  export const PoseLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:[L()]})})};
  export const FaceLandmarker={createFromOptions:async()=>({detectForVideo:()=>({faceLandmarks:[],faceBlendshapes:[]})})};
