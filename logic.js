'use strict';
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function rayBox(o,d,min,max,maxT=Infinity) {
  let lo=0,hi=maxT;
  for(let i=0;i<3;i++) {
    if(Math.abs(d[i])<1e-9) { if(o[i]<min[i]||o[i]>max[i]) return null; }
    else { let a=(min[i]-o[i])/d[i],b=(max[i]-o[i])/d[i]; if(a>b)[a,b]=[b,a]; lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return null; }
  }
  return lo;
}
function shotHit(s,t,boxes) {
  if(![s.x,s.z,s.yaw,s.pitch,t.x,t.z].every(finite))return {hit:false};
  const c=Math.cos(s.pitch),dir=[-Math.sin(s.yaw)*c,Math.sin(s.pitch),-Math.cos(s.yaw)*c];
  const o=[s.x,1.6,s.z];
  // Bounds match visible body and head, with a small expo tolerance.
  const hit=rayBox(o,dir,[t.x-.55,.25,t.z-.55],[t.x+.55,2.02,t.z+.55]);
  if(hit===null)return {hit:false};
  for(const b of boxes) {
    if(rayBox(o,dir,[b.x-b.w/2,0,b.z-b.d/2],[b.x+b.w/2,b.h,b.z+b.d/2],hit)!==null)return {hit:false,blocked:true};
  }
  return {hit:true};
}
function validatePosition(p,d,dt,arena) {
  d=d&&typeof d==='object'?d:{};
  let yaw=finite(d.yaw)?d.yaw:p.yaw,pitch=finite(d.pitch)?Math.max(-1.2,Math.min(1.2,d.pitch)):p.pitch;
  yaw=((yaw%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  if(!finite(d.x)||!finite(d.z))return {x:p.x,z:p.z,yaw,pitch};
  const dx=d.x-p.x,dz=d.z-p.z,dist=Math.hypot(dx,dz),limit=7*Math.max(0,dt)+.08;
  const factor=dist>limit?limit/dist:1;
  const steps=Math.max(1,Math.ceil(dist*factor/.15));let x=p.x,z=p.z;
  const half=arena.size/2-1;
  const blocked=(a,b)=> Math.abs(a)>half||Math.abs(b)>half||arena.boxes.some(k=>a>k.x-k.w/2-.55&&a<k.x+k.w/2+.55&&b>k.z-k.d/2-.55&&b<k.z+k.d/2+.55);
  for(let i=0;i<steps;i++){
    const nx=x+dx*factor/steps,nz=z+dz*factor/steps;
    if(!blocked(nx,z))x=nx;if(!blocked(x,nz))z=nz;
  }
  return {x,z,yaw,pitch};
}
function localAddresses(interfaces) {
  return Object.entries(interfaces).flatMap(([name,list])=>(list||[]).filter(n=>(n.family==='IPv4'||n.family===4)&&!n.internal&&!n.address.startsWith('169.254.')).map(n=>({name,address:n.address})))
    .sort((a,b)=>score(b)-score(a)).map(n=>n.address);
  function score(n){return (/wi.fi|wlan|wireless/i.test(n.name)?10:0)-(/vpn|docker|veth|vmware|virtual|vethernet|tailscale/i.test(n.name)?20:0);}
}
module.exports={rayBox,shotHit,validatePosition,localAddresses};
