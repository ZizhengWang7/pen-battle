import {SnapshotBuffer} from './buffer';
import {renderScene} from '../game/renderer';
import {screenToWorld} from '../game/physics';
import {penGeometry} from '../game/pens';
import type {PlayerId} from '../game/types';
import type {AimVisual,Point,ActionIntent,NetworkFrame} from '../shared/protocol';
export function contactOnPose(point:Point,pen:NetworkFrame['pens'][number],tolerance:number):Point|null {
 const vertices=penGeometry(pen.type).vertices.map(v=>({x:pen.position.x+v.x*Math.cos(pen.angle)-v.y*Math.sin(pen.angle),y:pen.position.y+v.x*Math.sin(pen.angle)+v.y*Math.cos(pen.angle)}));
 let sign=0,inside=true,nearest=point,distance=Infinity;
 for(let i=0;i<vertices.length;i++){
  const a=vertices[i],b=vertices[(i+1)%vertices.length],ex=b.x-a.x,ey=b.y-a.y,cross=ex*(point.y-a.y)-ey*(point.x-a.x);
  if(Math.abs(cross)>1e-8){const current=Math.sign(cross);if(sign&&current!==sign)inside=false;sign=current;}
  const t=Math.max(0,Math.min(1,((point.x-a.x)*ex+(point.y-a.y)*ey)/(ex*ex+ey*ey))),candidate={x:a.x+t*ex,y:a.y+t*ey},d=Math.hypot(candidate.x-point.x,candidate.y-point.y);
  if(d<distance){distance=d;nearest=candidate;}
 }
 return inside?{...point}:distance<=tolerance?nearest:null;
}
export class OnlineTable {
 private aim:(AimVisual&{pointerId:number})|null=null;
 private frame=0;
 private shown:NetworkFrame|null=null;
 private pendingTurn:number|null=null;
 private down=(e:PointerEvent)=>{
  const latest=this.buffer.latest(),shown=this.shown;if(!latest||!shown||!this.allowed()||latest.paused||latest.state.phase!=='aiming'||latest.state.currentPlayer!==this.playerId||shown.state.phase!=='aiming'||shown.state.turn!==latest.state.turn||this.pendingTurn!==null||this.aim||!e.isPrimary||e.button!==0)return;
  const origin=this.pointer(e),contact=contactOnPose(origin,shown.pens[this.playerId],e.pointerType==='touch'?9:4);if(!contact)return;
  e.preventDefault();this.canvas.setPointerCapture(e.pointerId);this.aim={start:contact,origin,end:origin,pointerId:e.pointerId};this.aiming(true);
 };
 private move=(e:PointerEvent)=>{if(this.aim?.pointerId!==e.pointerId)return;e.preventDefault();this.aim.end=this.pointer(e);};
 private up=(e:PointerEvent)=>{
  if(this.aim?.pointerId!==e.pointerId)return;e.preventDefault();const aim=this.aim,end=this.pointer(e),dx=aim.origin.x-end.x,dy=aim.origin.y-end.y,length=Math.hypot(dx,dy);this.cancel();const latest=this.buffer.latest();if(length<9||!latest)return;
  this.pendingTurn=latest.state.turn;void this.send({kind:'flick',contact:aim.start,direction:{x:dx/length,y:dy/length},power:Math.min(1,length/135)}).then(ok=>{if(!ok)this.pendingTurn=null;});
 };
 private cancelled=(e:PointerEvent)=>{if(this.aim?.pointerId===e.pointerId)this.cancel();};
 constructor(private canvas:HTMLCanvasElement,private buffer:SnapshotBuffer,private playerId:PlayerId,private send:(intent:Pick<Extract<ActionIntent,{kind:'flick'}>,'kind'|'contact'|'direction'|'power'>)=>Promise<boolean>,private allowed:()=>boolean,private aiming:(active:boolean)=>void){
  canvas.width=800;canvas.height=1240;canvas.addEventListener('pointerdown',this.down);canvas.addEventListener('pointermove',this.move);canvas.addEventListener('pointerup',this.up);canvas.addEventListener('pointercancel',this.cancelled);canvas.addEventListener('lostpointercapture',this.cancelled);this.frame=requestAnimationFrame(this.tick);
 }
 private pointer(e:PointerEvent){return screenToWorld({x:e.clientX,y:e.clientY},this.canvas.getBoundingClientRect());}
 private cancel(){const id=this.aim?.pointerId;this.aim=null;this.aiming(false);if(id!==undefined&&this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);}
 private tick=()=>{
  const latest=this.buffer.latest();if(latest&&(latest.state.turn!==this.pendingTurn||latest.state.phase!=='aiming'))this.pendingTurn=null;
  if(this.aim&&(!this.allowed()||latest?.state.phase!=='aiming'||latest.state.currentPlayer!==this.playerId))this.cancel();
  this.shown=this.buffer.sample();if(this.shown)renderScene(this.canvas.getContext('2d')!,this.shown,this.aim);this.frame=requestAnimationFrame(this.tick);
 };
 destroy(){this.cancel();cancelAnimationFrame(this.frame);this.canvas.removeEventListener('pointerdown',this.down);this.canvas.removeEventListener('pointermove',this.move);this.canvas.removeEventListener('pointerup',this.up);this.canvas.removeEventListener('pointercancel',this.cancelled);this.canvas.removeEventListener('lostpointercapture',this.cancelled);}
}
