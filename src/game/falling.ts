import type Matter from 'matter-js';
import {TABLE} from './physics';
export const FALL_DURATION=400;
export interface FallingPen {elapsed:number;position:Matter.Vector;angle:number;direction:Matter.Vector;velocity:Matter.Vector;}
export function startFalling(body:Matter.Body):FallingPen {
  const p=body.position;
  const direction={x:p.x<TABLE.min.x?-1:p.x>TABLE.max.x?1:0,y:p.y<TABLE.min.y?-1:p.y>TABLE.max.y?1:0};
  // Shake can remove support while COM is still on the desk: fall toward the
  // nearest edge, with deterministic left/right/top/bottom tie-breaking.
  if(direction.x===0&&direction.y===0){
    const edges=[{distance:p.x-TABLE.min.x,x:-1,y:0},{distance:TABLE.max.x-p.x,x:1,y:0},{distance:p.y-TABLE.min.y,x:0,y:-1},{distance:TABLE.max.y-p.y,x:0,y:1}];
    const edge=edges.reduce((nearest,candidate)=>candidate.distance<nearest.distance?candidate:nearest);
    direction.x=edge.x;direction.y=edge.y;
  }
  const length=Math.hypot(direction.x,direction.y)||1;
  return {elapsed:0,position:{...p},angle:body.angle,direction:{x:direction.x/length,y:direction.y/length},velocity:{x:body.velocity.x,y:body.velocity.y}};
}
export function fallingPose(fall:FallingPen){
  const t=Math.min(fall.elapsed/FALL_DURATION,1), eased=t*t*(3-2*t);
  return {
    x:fall.position.x+fall.direction.x*48*eased+fall.velocity.x*t*.8,
    y:fall.position.y+fall.direction.y*48*eased+fall.velocity.y*t*.8+24*t*t,
    angle:fall.angle+(.3*fall.direction.x+.16*fall.direction.y)*eased,
    scale:1-.2*eased, squash:1-.35*eased, opacity:1-eased,shadowSeparation:22*eased,
  };
}
