import {PEN_CLASSES,penGeometry} from './pens';
import type {PenType} from './pens';
import {PEN_CENTROID,PEN_GEOMETRY,tracePenOutline} from './geometry';

export function drawMetalPen(c:CanvasRenderingContext2D, accent:string,label:string,shadowSeparation=0){
  c.save();c.translate(-PEN_CENTROID.x,-PEN_CENTROID.y);
  c.shadowColor='#21150d90';c.shadowBlur=3+shadowSeparation*.3;c.shadowOffsetY=2+shadowSeparation;c.shadowOffsetX=shadowSeparation*.25;
  const metal=c.createLinearGradient(0,-7,0,7);
  for(const [offset,color] of [[0,'#454e55'],[.18,'#a2aab0'],[.35,'#f4f3eb'],[.48,'#c6cbd0'],[.73,'#747f88'],[1,'#343d46']] as const)metal.addColorStop(offset,color);
  c.fillStyle=metal;tracePenOutline(c);c.fill();c.shadowColor='transparent';
  tracePenOutline(c);c.clip();
  c.save();tracePenOutline(c);c.clip();
  c.lineWidth=.35;
  for(let i=-53;i<44;i+=1.7){c.strokeStyle=i%3<1?'#ffffff24':'#14233218';c.beginPath();c.moveTo(i,-7);c.lineTo(i+.7,7);c.stroke();}
  c.restore();
  c.strokeStyle='#35434e80';c.lineWidth=.8;c.beginPath();c.moveTo(PEN_GEOMETRY.barrelEnd,-6);c.lineTo(PEN_GEOMETRY.barrelEnd,6);c.stroke();
  c.fillStyle='#34383b';c.fillRect(55,-.7,2,1.4);
  c.fillStyle=accent;c.fillRect(-38,-7,5,14);c.fillRect(34,-6.8,2,13.6);
  c.strokeStyle='#26323c88';c.lineWidth=.6;
  for(const x of [-52,-40,30,42]){c.beginPath();c.moveTo(x,-6);c.lineTo(x,6);c.stroke();}
  c.shadowColor='#0008';c.shadowBlur=2;c.shadowOffsetY=1;
  const clip=c.createLinearGradient(0,-8,0,-3);clip.addColorStop(0,'#fafbfa');clip.addColorStop(.5,'#a9b2bc');clip.addColorStop(1,'#414e59');
  c.fillStyle=clip;c.beginPath();c.roundRect(PEN_GEOMETRY.clip.x,PEN_GEOMETRY.clip.y,PEN_GEOMETRY.clip.width,PEN_GEOMETRY.clip.height,2);c.fill();c.shadowColor='transparent';
  c.fillStyle='#273440';c.font='9px system-ui';c.textAlign='center';c.fillText(label,0,3);c.restore();
}

export function drawPen(c:CanvasRenderingContext2D,type:PenType,accent:string,label:string,shadowSeparation=0){
 if(type==='ballpoint'){drawMetalPen(c,accent,label,shadowSeparation);return;}
 const p=PEN_CLASSES[type],g=penGeometry(type);
 c.save();c.translate(-g.center.x,-g.center.y);
 c.shadowColor='#21150d90';c.shadowBlur=3+shadowSeparation*.3;c.shadowOffsetY=2+shadowSeparation;
 const colors:Record<Exclude<PenType,'ballpoint'>,string[]>= {wooden:['#775129','#dcb96e','#f6d791','#b57c37'],mechanical:['#52616a','#dbe3e3','#fafaf4','#6f7f89'],highlighter:['#526832','#d4df5e','#eff393','#7f9c3d'],fountain:['#111c28','#45515e','#9ca6b0','#172632']};
 const gradient=c.createLinearGradient(0,-13,0,13);colors[type].forEach((color,i)=>gradient.addColorStop(i/3,color));
 c.fillStyle=gradient;c.beginPath();p.outline.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.closePath();c.fill();c.shadowColor='transparent';c.clip();
 if(type==='wooden'){
  c.fillStyle='#fae1a080';c.fillRect(-80,-3,151,2);c.fillStyle='#edb0a0';c.fillRect(-90,-6,14,12);c.fillStyle='#b4bab8';c.fillRect(-76,-6,7,12);c.fillStyle=accent;c.fillRect(-66,-5,4,10);
  c.fillStyle='#e5bf88';c.beginPath();c.moveTo(69,-6);c.lineTo(91,0);c.lineTo(69,6);c.closePath();c.fill();c.fillStyle='#31343a';c.fillRect(83,-3,8,6);
 }else if(type==='mechanical'){
  c.fillStyle='#778692';c.fillRect(42,-7,30,14);c.fillStyle=accent;c.fillRect(-61,-6,7,12);
  c.strokeStyle='#26374199';c.lineWidth=.7;for(let x=21;x<44;x+=3){c.beginPath();c.moveTo(x,-6);c.lineTo(x,6);c.stroke();}
  c.fillStyle='#e9eeed';c.fillRect(-66,-6,31,2);c.fillStyle='#333a3d';c.fillRect(65,-1,6,2);
 }else if(type==='highlighter'){
  c.fillStyle='#273137';c.fillRect(-58,-18,25,36);c.fillStyle=accent;c.fillRect(-32,-18,5,36);c.fillStyle='#eff6c688';c.fillRect(-22,-9,58,3);
  c.strokeStyle='#323f2f66';c.lineWidth=1;c.beginPath();c.moveTo(-29,-13);c.lineTo(-29,13);c.stroke();
 }else{
  c.fillStyle='#c8a75c';for(const x of [-48,-42,28])c.fillRect(x,-12,2,24);
  c.fillStyle='#ddc17c';c.beginPath();c.moveTo(35,-6);c.lineTo(56,0);c.lineTo(35,6);c.closePath();c.fill();
  c.strokeStyle='#5d492c';c.lineWidth=.7;c.beginPath();c.moveTo(39,0);c.lineTo(56,0);c.stroke();c.beginPath();c.arc(40,0,1.2,0,Math.PI*2);c.stroke();
  c.fillStyle='#dfc77a';c.beginPath();c.roundRect(-59,-9,34,3,1.5);c.fill();c.fillStyle=accent;c.fillRect(-37,-11,4,22);
 }
 c.fillStyle=type==='fountain'?'#ead6a9':'#26353b';c.font='8px system-ui';c.textAlign='center';c.fillText(label,-3,3);c.restore();
}
