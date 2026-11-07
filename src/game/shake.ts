import type {Vector} from 'matter-js';
import {TABLE} from './physics';
export const SHAKE_DURATION=360;
export const SHAKE_SAFE_ZONE={
  left:TABLE.min.x+(TABLE.max.x-TABLE.min.x)*.05,
  right:TABLE.max.x-(TABLE.max.x-TABLE.min.x)*.05,
  top:TABLE.min.y+(TABLE.max.y-TABLE.min.y)*.05,
  bottom:TABLE.max.y-(TABLE.max.y-TABLE.min.y)*.05,
};
// Threshold equality is safe; strictly outside the inner rectangle is dangerous.
export function isInShakeDangerZone(center:Vector):boolean {
  return center.x<SHAKE_SAFE_ZONE.left||center.x>SHAKE_SAFE_ZONE.right||center.y<SHAKE_SAFE_ZONE.top||center.y>SHAKE_SAFE_ZONE.bottom;
}
// Camera offset only. Never add this displacement to a physics body or contact.
export function shakeCameraOffset(elapsed:number):Vector {
  const t=Math.min(1,Math.max(0,elapsed/SHAKE_DURATION));
  const envelope=Math.sin(Math.PI*t)*(1-t*.6);
  return {x:Math.sin(t*Math.PI*14)*2.6*envelope,y:Math.sin(t*Math.PI*19)*1.7*envelope};
}
