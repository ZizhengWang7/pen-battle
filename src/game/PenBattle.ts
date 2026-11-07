import Matter from 'matter-js';
import {MatchEngine} from './MatchEngine';
import {renderScene} from './renderer';
import {screenToWorld,getPenContactPoint,localToWorld,FIXED_STEP} from './physics';
import type {GameMode,GameSnapshot,PlayerId} from './types';
const {Vector}=Matter;
export {COLORS} from './constants';
export class PenBattle extends MatchEngine {
 private canvas:HTMLCanvasElement;
 private ctx:CanvasRenderingContext2D;
 private drag:{pointerId:number;local:Matter.Vector;start:Matter.Vector;origin:Matter.Vector;end:Matter.Vector}|null=null;
 private last=0;
 private accumulator=0;
 private frame=0;
 private boundDown=(e:PointerEvent)=>this.down(e);
 private boundMove=(e:PointerEvent)=>this.move(e);
 private boundUp=(e:PointerEvent)=>this.up(e);
 private boundCancel=(e:PointerEvent)=>{if(this.drag?.pointerId===e.pointerId)this.cancelAim();};
 private cancelAim(){const id=this.drag?.pointerId;this.drag=null;if(id!==undefined&&this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);if(id!==undefined)this.emit();}
 constructor(canvas:HTMLCanvasElement,onChange:(s:GameSnapshot)=>void,options:{mode?:GameMode;seed?:number}={}){
  super(options,onChange);this.canvas=canvas;this.ctx=canvas.getContext('2d')!;canvas.width=800;canvas.height=1240;
  this.onReset=()=>{this.cancelAim();this.accumulator=0;};this.onAction=()=>this.cancelAim();
  canvas.addEventListener('pointerdown',this.boundDown);canvas.addEventListener('pointermove',this.boundMove);canvas.addEventListener('pointerup',this.boundUp);canvas.addEventListener('pointercancel',this.boundCancel);canvas.addEventListener('lostpointercapture',this.boundCancel);
  this.frame=requestAnimationFrame(this.tick);
 }
 canShake(id:PlayerId){return !this.drag&&super.canShake(id);}
  private pointer(e:PointerEvent){return screenToWorld({x:e.clientX,y:e.clientY},this.canvas.getBoundingClientRect());}
  private down(e:PointerEvent){
    if(this.phase!=='aiming'||this.drag||!e.isPrimary||e.button!==0)return;
    const p=this.pens[this.current]; if(!p?.alive)return;
    const pt=this.pointer(e);
    const contact=getPenContactPoint(p.body,pt,e.pointerType==='touch'?9:4);
    if(!contact)return;
    e.preventDefault();this.canvas.setPointerCapture(e.pointerId);
    this.drag={pointerId:e.pointerId,local:contact.local,start:contact.world,origin:pt,end:pt};this.emit();
  }
  private move(e:PointerEvent){if(this.drag?.pointerId!==e.pointerId)return;e.preventDefault();this.drag.end=this.pointer(e);}
  private up(e:PointerEvent){
    if(this.drag?.pointerId!==e.pointerId)return;e.preventDefault();
    const drag=this.drag;
    const delta=Vector.sub(drag.origin,this.pointer(e));
    const contact=localToWorld(this.pens[this.current].body,drag.local);
    this.cancelAim();
    const length=Vector.magnitude(delta);if(length<9)return;
    const factor=Math.min(length,135)/135;
    this.act({type:'flick',playerId:this.current,dx:delta.x/length*factor,dy:delta.y/length*factor,contact});
  }
  private tick=(time:number)=>{
    const dt=this.last?Math.min(time-this.last,100):FIXED_STEP;this.last=time;
    this.accumulator+=dt;
    while(this.accumulator>=FIXED_STEP){const impact=this.step();this.accumulator-=FIXED_STEP;if(impact)break;}
    this.render();this.frame=requestAnimationFrame(this.tick);
  };
 private render(){renderScene(this.ctx,this.getScene(),this.drag);}
 destroy(){this.cancelAim();cancelAnimationFrame(this.frame);this.canvas.removeEventListener('pointerdown',this.boundDown);this.canvas.removeEventListener('pointermove',this.boundMove);this.canvas.removeEventListener('pointerup',this.boundUp);this.canvas.removeEventListener('pointercancel',this.boundCancel);this.canvas.removeEventListener('lostpointercapture',this.boundCancel);super.destroy();}
}
