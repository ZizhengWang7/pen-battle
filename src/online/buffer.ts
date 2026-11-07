import type {NetworkFrame} from '../shared/protocol';
import {handTiming} from '../game/hand';
import {STRIKE_IMPACT} from '../game/strike';
export class SnapshotBuffer {
 private frames:NetworkFrame[]=[];
 private offset=0;
 private contacts:{key:string;frame:NetworkFrame}[]=[];
 private seen=new Set<string>();
 clear(){this.frames=[];this.contacts=[];this.seen.clear();}
 push(frame:NetworkFrame,receivedAt=Date.now()){
  if(this.frames[0]?.matchId!==frame.matchId)this.clear();
  if(this.frames.length&&frame.sequence<=this.frames[this.frames.length-1].sequence)return;
  this.offset=this.frames.length?Math.min(this.offset,receivedAt-frame.serverTime):receivedAt-frame.serverTime;
  this.frames.push(frame);if(this.frames.length>120)this.frames.shift();
  const impact=(frame.flick?.contacted&&Math.abs(frame.flick.elapsed-handTiming(frame.flick.power).impact)<1e-7)||(frame.strike?.impacted&&frame.strike.elapsed===STRIKE_IMPACT);
  const key=`${frame.matchId}:${frame.state.activeAction?.id}`;
  if(impact&&!this.seen.has(key)){this.seen.add(key);this.contacts.push({key,frame});}
 }
 latest(){return this.frames[this.frames.length-1]??null;}
 sample(now=Date.now()):NetworkFrame|null {
  if(!this.frames.length)return null;
  const target=now-this.offset-100;
  while(this.contacts.length&&this.contacts[0].frame.serverTime<=target){const contact=this.contacts.shift()!;if(target-contact.frame.serverTime<500)return contact.frame;}
  let before=this.frames[0],after:NetworkFrame|undefined;
  for(const frame of this.frames){if(frame.serverTime<=target)before=frame;else{after=frame;break;}}
  if(!after||before===after||target<=before.serverTime)return before;
  const t=Math.max(0,Math.min(1,(target-before.serverTime)/(after.serverTime-before.serverTime||1))),result=structuredClone(before);
  const mix=(a:number,b:number)=>a+(b-a)*t;
  result.pens.forEach((pen,i)=>{const next=after!.pens[i];if(!next||pen.type!==next.type||pen.alive!==next.alive||!!pen.fall!==!!next.fall)return;
   pen.position={x:mix(pen.position.x,next.position.x),y:mix(pen.position.y,next.position.y)};pen.angle=mix(pen.angle,next.angle);if(pen.fall&&next.fall)pen.fall.elapsed=mix(pen.fall.elapsed,next.fall.elapsed);
  });
  if(result.flick&&after.flick&&result.state.activeAction?.id===after.state.activeAction?.id&&result.flick.contacted===after.flick.contacted)result.flick.elapsed=mix(result.flick.elapsed,after.flick.elapsed);
  if(result.strike&&after.strike&&result.strike.impacted===after.strike.impacted)result.strike.elapsed=mix(result.strike.elapsed,after.strike.elapsed);
  if(result.shakeElapsed!==null&&after.shakeElapsed!==null)result.shakeElapsed=mix(result.shakeElapsed,after.shakeElapsed);
  if(result.state.phase===after.state.phase)result.phaseTime=mix(result.phaseTime,after.phaseTime);
  return result;
 }
}
