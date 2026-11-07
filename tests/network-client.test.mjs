import assert from 'node:assert/strict';
import {MatchEngine} from '../src/game/MatchEngine.ts';
import {SnapshotBuffer} from '../src/online/buffer.ts';
import {contactOnPose} from '../src/online/OnlineTable.ts';
import {PEN_TYPES,penGeometry} from '../src/game/pens.ts';
import {createPenBody,localToWorld} from '../src/game/physics.ts';
let count=0;
function check(name,fn){fn();count++;console.log(`✓ ${name}`);}
const core=new MatchEngine();
const frame=(sequence,time)=>({...core.getScene(),matchId:'test',sequence,tick:sequence,serverTime:time,paused:false});
check('Network rendering interpolates snapshots without mutating authoritative inputs',()=>{
 const buffer=new SnapshotBuffer(),a=frame(1,1000),b=frame(2,1100);b.pens[0].position.x+=100;b.pens[0].angle+=2;const before=structuredClone(a);buffer.push(a,1000);buffer.push(b,1100);const sample=buffer.sample(1150);assert.equal(sample.pens[0].position.x,a.pens[0].position.x+50);assert.equal(sample.pens[0].angle,a.pens[0].angle+1);assert.deepEqual(a,before);
 buffer.push(frame(1,1200),1200);assert.equal(buffer.latest().sequence,2);
});
check('Respawn/type changes do not interpolate pens across the board, and match IDs reset stale buffers',()=>{
 const buffer=new SnapshotBuffer(),a=frame(1,1000),b=frame(2,1100);b.pens[0].type='fountain';b.pens[0].position.x=300;buffer.push(a,1000);buffer.push(b,1100);assert.deepEqual(buffer.sample(1150).pens[0].position,a.pens[0].position);
 const next=frame(1,1200);next.matchId='new';buffer.push(next,1200);assert.equal(buffer.latest().matchId,'new');
});
check('Server hand impact gets one exact presented pose before interpolation resumes',()=>{
 core.shoot({playerId:0,dx:.5,dy:0});for(let i=0;i<8;i++)core.step();const impact={...frame(2,1100)};assert.ok(impact.flick.contacted);const later=structuredClone(impact);later.sequence=3;later.serverTime=1200;later.flick.elapsed+=100;later.pens[0].position.x+=50;
 const buffer=new SnapshotBuffer();buffer.push(impact,1100);buffer.push(later,1200);assert.equal(buffer.sample(1250).flick.elapsed,120);assert.ok(buffer.sample(1250).flick.elapsed>120);
});
check('Online contact selection uses shared weighted geometry at every class and rotation, with no client simulation',()=>{
 for(const type of PEN_TYPES){const body=createPenBody(200,300,.8,type),pen={type,position:body.position,angle:body.angle};
  for(const v of penGeometry(type).vertices){const point=localToWorld(body,v),contact=contactOnPose(point,pen,.001);assert.ok(contact);assert.ok(Math.hypot(contact.x-point.x,contact.y-point.y)<1e-7);}
  assert.equal(contactOnPose({x:0,y:0},pen,4),null);
 }
});
core.destroy();console.log(`${count} network rendering groups passed.`);
