import Matter from 'matter-js';
import type {PenType} from './pens';
import {createPenBody} from './physics';
import {SHAKE_SAFE_ZONE} from './shake';
export const RESPAWN_RETRY_MS=250;
export function isSafeSpawn(body:Matter.Body,others:Matter.Body[]):boolean {
 const z=SHAKE_SAFE_ZONE;
 return body.vertices.every(v=>v.x>z.left+2&&v.x<z.right-2&&v.y>z.top+2&&v.y<z.bottom-2)&&Matter.Query.collides(body,others).length===0;
}
export function findSpawn(type:PenType,others:Matter.Body[],seed:number,playerId:number):Matter.Body|null {
 const candidates:{x:number;y:number;angle:number}[]=[];
 for(const y of [150,310,470,220,400,105,515])for(const x of [106,200,294])for(const angle of [Math.PI/2,0,.27,-.27])candidates.push({x,y,angle});
 const offset=((seed>>>0)+playerId*17)%candidates.length;
 for(let i=0;i<candidates.length;i++){
  const candidate=candidates[(i+offset)%candidates.length],body=createPenBody(candidate.x,candidate.y,candidate.angle,type);
  if(isSafeSpawn(body,others))return body;
 }
 return null;
}
