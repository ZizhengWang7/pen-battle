import type {SceneFrame,AimVisual} from '../shared/protocol';
import {drawPen} from './visuals';
import {drawHand,drawGrip,handPose} from './hand';
import {fallingPose} from './falling';
import {strikePose} from './strike';
import {shakeCameraOffset} from './shake';
import {penGeometry} from './pens';
import {COLORS,NAMES} from './constants';
const W=400,H=620,MARGIN=17;
const Vector={sub:(a:{x:number;y:number},b:{x:number;y:number})=>({x:a.x-b.x,y:a.y-b.y}),magnitude:(v:{x:number;y:number})=>Math.hypot(v.x,v.y),mult:(v:{x:number;y:number},n:number)=>({x:v.x*n,y:v.y*n}),rotate:(v:{x:number;y:number},a:number)=>({x:v.x*Math.cos(a)-v.y*Math.sin(a),y:v.x*Math.sin(a)+v.y*Math.cos(a)})};
export function renderScene(ctx:CanvasRenderingContext2D,scene:SceneFrame,aim:AimVisual|null=null){
 const glows=new Map(scene.respawnGlows);
    const c=ctx;c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,W,H);
    c.fillStyle='#382b25';c.fillRect(0,0,W,H);c.save();
    if(scene.shakeElapsed!==null){const camera=shakeCameraOffset(scene.shakeElapsed);c.translate(camera.x,camera.y);}
    // Desk surface and subtle wood grain.
    const wood=c.createLinearGradient(0,0,W,H);wood.addColorStop(0,'#c79763');wood.addColorStop(.5,'#d8ae7d');wood.addColorStop(1,'#b98150');
    c.fillStyle='#382b25';c.fillRect(0,0,W,H);c.fillStyle=wood;c.fillRect(MARGIN,MARGIN,W-2*MARGIN,H-2*MARGIN);
    c.save();c.beginPath();c.rect(MARGIN,MARGIN,W-2*MARGIN,H-2*MARGIN);c.clip();
    for(let i=0;i<35;i++){const x=MARGIN+i*12;c.beginPath();c.moveTo(x,MARGIN);c.bezierCurveTo(x+14,200,x-12,400,x+4,H-MARGIN);c.strokeStyle=i%3===0?'#784b2b20':'#fff4d815';c.lineWidth=i%3===0?2:1;c.stroke();}
    c.restore();c.strokeStyle='#765035';c.lineWidth=3;c.strokeRect(MARGIN,MARGIN,W-2*MARGIN,H-2*MARGIN);
    c.fillStyle='#5e3c28aa';c.font='bold 13px system-ui';c.textAlign='center';c.fillText('P E N   B A T T L E',W/2,49);
    for(const p of scene.pens){if(!p.alive||(scene.strike&&!scene.strike.impacted&&p.id===scene.strike.playerId))continue;const b=p;c.save();
      if(p.fall){const pose=fallingPose(p.fall);c.translate(pose.x,pose.y);c.rotate(pose.angle);c.scale(pose.scale,pose.scale*pose.squash);c.globalAlpha=pose.opacity;drawPen(c,b.type,COLORS[p.id],NAMES[p.id],pose.shadowSeparation);}
      else{c.translate(b.position.x,b.position.y);c.rotate(b.angle);if(scene.state.phase==='upgrading'&&scene.upgrades.includes(p.id)){const pulse=Math.sin(Math.PI*Math.min(scene.phaseTime/420,1));c.save();c.strokeStyle=`rgba(234,194,138,${pulse*.8})`;c.lineWidth=2;const r=penGeometry(b.type).radius;c.beginPath();c.ellipse(0,0,r+8,20,0,0,Math.PI*2);c.stroke();c.restore();c.scale(1+pulse*.05,1+pulse*.05);}drawPen(c,b.type,COLORS[p.id],NAMES[p.id]);}
      c.restore();
      if((p.id===scene.state.currentPlayer&&scene.state.phase==='aiming')||glows.has(p.id)){
        c.save();c.translate(b.position.x,b.position.y);c.rotate(b.angle);c.strokeStyle=glows.has(p.id)?'#f5cf88':'#ffffffd9';if(glows.has(p.id))c.globalAlpha=Math.max(0,1-glows.get(p.id)!/600);c.setLineDash([5,5]);c.lineWidth=2;
        const vertices=penGeometry(b.type).vertices;c.beginPath();vertices.forEach((v,i)=>i?c.lineTo(v.x*1.06,v.y*1.3):c.moveTo(v.x*1.06,v.y*1.3));c.closePath();c.stroke();c.restore();
      }
    }
    if(scene.strike){
      const strike=scene.strike,pen=scene.pens[strike.playerId],pose=strikePose(strike.elapsed),point={x:pen.position.x,y:pen.position.y-pose.lift+pose.withdraw};
      c.save();c.translate(point.x,point.y);c.scale(pose.scale,pose.scale);
      drawGrip(c,{x:0,y:0},pen.angle,pose.opacity,()=>{if(!strike.impacted)drawPen(c,pen.type,COLORS[pen.id],NAMES[pen.id],pose.lift*.6);});c.restore();
    }
    if(scene.flick){const f=scene.flick;drawHand(c,f.point,f.direction,handPose(f.power,f.elapsed));}
    if(aim){const d=Vector.sub(aim.origin,aim.end);const len=Vector.magnitude(d);const power=Math.min(len,135)/135;const unit=len?Vector.mult(d,1/len):{x:0,y:0};
      c.beginPath();c.moveTo(aim.start.x,aim.start.y);c.lineTo(aim.start.x+unit.x*power*110,aim.start.y+unit.y*power*110);c.strokeStyle='#ffffff';c.lineWidth=4;c.stroke();
      const tip={x:aim.start.x+unit.x*power*110,y:aim.start.y+unit.y*power*110};
      if(len>=9){c.beginPath();c.moveTo(tip.x-unit.x*10-unit.y*5,tip.y-unit.y*10+unit.x*5);c.lineTo(tip.x,tip.y);c.lineTo(tip.x-unit.x*10+unit.y*5,tip.y-unit.y*10-unit.x*5);c.stroke();}
      c.beginPath();c.arc(aim.start.x,aim.start.y,4,0,Math.PI*2);c.fillStyle='#eac28a';c.fill();c.lineWidth=2;c.stroke();
      const direction=len?unit:Vector.rotate({x:0,y:-1},scene.pens[scene.state.currentPlayer].angle);
      drawHand(c,aim.start,direction,handPose(power,null));
      c.fillStyle='#ffffff';c.font='bold 15px system-ui';c.textAlign='center';c.fillText(`力度 ${Math.round(power*100)}%`,W/2,H-48);
    }
    c.restore();

}
