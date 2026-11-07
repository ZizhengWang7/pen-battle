import type {Vector} from 'matter-js';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const EXTENDED_CURL=.035;
const TIP_RADIUS=5;
export function handTiming(power:number){
  const p=clamp(power);
  return {impact:150-60*p,follow:80+40*p,recovery:140};
}
export function indexJoints(curl:number):Vector[]{
  const joints:Vector[]=[{x:-10,y:60}];
  const bends=[.1+.4*curl,.95*curl,1.2*curl];
  let angle=0;
  [23,19,15].forEach((length,i)=>{
    angle+=bends[i];const prev=joints[joints.length-1];
    joints.push({x:prev.x+Math.sin(angle)*length,y:prev.y-Math.cos(angle)*length});
  });
  return joints;
}
function tipEdge(joints:Vector[]):Vector {
  const a=joints[2],b=joints[3],len=Math.hypot(b.x-a.x,b.y-a.y);
  return {x:b.x+(b.x-a.x)/len*TIP_RADIUS,y:b.y+(b.y-a.y)/len*TIP_RADIUS};
}
export interface HandPose {
  joints:Vector[];offset:Vector;fingertip:Vector;curl:number;thumbRelease:number;opacity:number;followThrough:number;
}
// Local -Y is the impulse direction. At impact the pad's outer edge is (0,0).
export function handPose(power:number,elapsed:number|null):HandPose {
  const p=clamp(power),timing=handTiming(p),chargeCurl=.7+.55*p;
  const release=elapsed===null?0:clamp(elapsed/timing.impact);
  const extension=release*release*(3-2*release);
  const curl=mix(chargeCurl,EXTENDED_CURL,extension);
  const joints=indexJoints(curl),anchor=tipEdge(indexJoints(EXTENDED_CURL));
  const after=elapsed===null?0:Math.max(0,elapsed-timing.impact);
  const followProgress=clamp(after/timing.follow);
  const recovery=clamp((after-timing.follow)/timing.recovery);
  const followThrough=Math.sin(followProgress*Math.PI/2)*(4+11*p);
  const offset={x:-anchor.x+Math.sin(release*Math.PI)*p*2,
    y:-anchor.y+(5+13*p)*(1-extension)-followThrough+recovery*recovery*(28+12*p)};
  const edge=tipEdge(joints);
  return {joints,offset,fingertip:{x:edge.x+offset.x,y:edge.y+offset.y},curl,
    thumbRelease:clamp(release*3),opacity:1-recovery,followThrough};
}

// A continuous tapered skin envelope over an articulated bone chain. Adjacent
// phalanges share a surface rather than appearing as disconnected cylinders.
function digit(c:CanvasRenderingContext2D,joints:Vector[],radii:number[]){
 const left:Vector[]=[],right:Vector[]=[];
 for(let i=0;i<joints.length;i++){
  const a=joints[Math.max(0,i-1)],b=joints[Math.min(joints.length-1,i+1)],length=Math.hypot(b.x-a.x,b.y-a.y)||1;
  const nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length;
  left.push({x:joints[i].x+nx*radii[i],y:joints[i].y+ny*radii[i]});right.push({x:joints[i].x-nx*radii[i],y:joints[i].y-ny*radii[i]});
 }
 const start=joints[0],tip=joints[joints.length-1],previous=joints[joints.length-2],length=Math.hypot(tip.x-previous.x,tip.y-previous.y)||1;
 const skin=c.createLinearGradient(start.x-10,start.y,tip.x+10,tip.y);skin.addColorStop(0,'#ac7457');skin.addColorStop(.4,'#e5b68f');skin.addColorStop(.7,'#edc4a3');skin.addColorStop(1,'#bd8669');
 c.fillStyle=skin;c.beginPath();c.moveTo(left[0].x,left[0].y);
 for(let i=1;i<left.length-1;i++){const mid={x:(left[i].x+left[i+1].x)/2,y:(left[i].y+left[i+1].y)/2};c.quadraticCurveTo(left[i].x,left[i].y,mid.x,mid.y);}
 c.lineTo(left[left.length-1].x,left[left.length-1].y);
 const radius=radii[radii.length-1];c.quadraticCurveTo(tip.x+(tip.x-previous.x)/length*radius*2,tip.y+(tip.y-previous.y)/length*radius*2,right[right.length-1].x,right[right.length-1].y);
 for(let i=right.length-2;i>0;i--){const mid={x:(right[i].x+right[i-1].x)/2,y:(right[i].y+right[i-1].y)/2};c.quadraticCurveTo(right[i].x,right[i].y,mid.x,mid.y);}
 c.lineTo(right[0].x,right[0].y);c.closePath();c.fill();
}
function segment(c:CanvasRenderingContext2D,a:Vector,b:Vector,width:number){digit(c,[a,b],[width/2,width*.43]);}
function nail(c:CanvasRenderingContext2D,a:Vector,b:Vector){
  c.save();c.translate(b.x,b.y);c.rotate(Math.atan2(b.y-a.y,b.x-a.x)+Math.PI/2);
  const polish=c.createLinearGradient(-4,-2,4,10);polish.addColorStop(0,'#f7dfcd');polish.addColorStop(.5,'#e8bfae');polish.addColorStop(1,'#cc9786');
  c.fillStyle=polish;c.beginPath();c.roundRect(-3.8,-1,7.6,10,3);c.fill();
  c.strokeStyle='#9b655d55';c.lineWidth=.6;c.stroke();c.restore();
}
export function drawHand(c:CanvasRenderingContext2D,contact:Vector,direction:Vector,pose:HandPose){
  c.save();c.translate(contact.x,contact.y);c.rotate(Math.atan2(direction.y,direction.x)+Math.PI/2);
  c.translate(pose.offset.x,pose.offset.y);c.globalAlpha=pose.opacity;
  c.shadowColor='#301a1066';c.shadowBlur=7;c.shadowOffsetX=3;c.shadowOffsetY=4;
  const skin=c.createLinearGradient(-30,75,38,96);
  skin.addColorStop(0,'#a66b4d');skin.addColorStop(.3,'#d9a37e');skin.addColorStop(.6,'#e7b791');skin.addColorStop(1,'#ba805f');
  c.fillStyle=skin;c.beginPath();c.moveTo(-19,117);c.bezierCurveTo(-26,99,-31,86,-24,70);c.bezierCurveTo(-24,57,-9,54,4,59);c.bezierCurveTo(24,60,32,76,28,91);c.lineTo(19,119);c.closePath();c.fill();
  c.shadowColor='transparent';
  // Curled middle, ring and little fingers remain near the palm.
  for(let i=0;i<3;i++){
    const x=-2+i*11,y=67+i*4;
    segment(c,{x,y:y+19},{x:x+2,y},13-i);
    segment(c,{x:x+2,y},{x:x+7,y:y+8},11-i);
    c.strokeStyle='#985c4055';c.lineWidth=.7;c.beginPath();c.moveTo(x-2,y+5);c.quadraticCurveTo(x+2,y+7,x+6,y+5);c.stroke();
  }
  // The index has three articulated phalanges; creases and nail follow joints.
  const j=pose.joints;
  digit(c,j,[7.5,6.5,5.5,TIP_RADIUS]);
  for(let i=1;i<3;i++){
    const a=j[i-1],b=j[i],angle=Math.atan2(b.y-a.y,b.x-a.x);
    c.save();c.translate(b.x,b.y);c.rotate(angle+Math.PI/2);
    c.strokeStyle='#945c425e';c.lineWidth=.7;c.beginPath();c.moveTo(-4,0);c.quadraticCurveTo(0,2,4,0);c.stroke();c.restore();
  }
  nail(c,j[2],j[3]);
  // Before release the thumb pad holds the curled index; it opens independently.
  const curledTip=j[3],open={x:37,y:54};
  const thumbTip={x:mix(curledTip.x-4,open.x,pose.thumbRelease),y:mix(curledTip.y+5,open.y,pose.thumbRelease)};
  const thumbJoint={x:mix(32,38,pose.thumbRelease),y:mix(68,76,pose.thumbRelease)};
  digit(c,[{x:21,y:91},thumbJoint,thumbTip],[9,8,6]);nail(c,thumbJoint,thumbTip);
  c.strokeStyle='#9b624449';c.lineWidth=.8;
  c.beginPath();c.moveTo(-16,91);c.bezierCurveTo(-5,88,6,91,15,101);c.moveTo(16,78);c.quadraticCurveTo(5,88,9,106);c.stroke();
  c.restore();
}

export function drawGrip(c:CanvasRenderingContext2D,point:Vector,angle:number,opacity:number,drawHeldPen:()=>void){
 c.save();c.translate(point.x,point.y);c.rotate(angle);c.globalAlpha=opacity;
 c.shadowColor='#301a1066';c.shadowBlur=6;c.shadowOffsetY=4;
 const skin=c.createLinearGradient(-22,15,35,50);skin.addColorStop(0,'#ac7457');skin.addColorStop(.5,'#e3b18b');skin.addColorStop(1,'#be8464');
 c.fillStyle=skin;c.beginPath();c.moveTo(-18,69);c.bezierCurveTo(-25,48,-29,28,-18,12);c.bezierCurveTo(-8,0,23,7,26,27);c.lineTo(20,69);c.closePath();c.fill();c.shadowColor='transparent';
 drawHeldPen();
 // Four curved finger chains wrap over the barrel; thumb crosses the grip.
 for(let i=0;i<4;i++){
  const x=-18+i*10;const j=[{x,y:27+i*1.5},{x:x-3,y:-5},{x:x+3,y:-10},{x:x+7,y:0}];digit(c,j,[6.5,6,5.5,4.5]);nail(c,j[2],j[3]);
 }
 const thumb=[{x:25,y:34},{x:20,y:10},{x:4,y:8}];digit(c,thumb,[9,8,6]);nail(c,thumb[1],thumb[2]);c.restore();
}
