import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {applyImpulseAtPoint,calculateFlickImpulse,getPenContactPoint,localToWorld,isPenOffTable,getPenBounds,screenToWorld,FIXED_STEP,applyDeskResistance,createPenBody,advancePhysics,collisionSubsteps,EDGE_TOLERANCE,TABLE} from '../src/game/physics.ts';
import {PEN_GEOMETRY,PEN_CENTROID,PEN_VERTICES,tracePenOutline} from '../src/game/geometry.ts';
import {FALL_DURATION,fallingPose} from '../src/game/falling.ts';
import {handPose,handTiming,indexJoints,drawHand} from '../src/game/hand.ts';
import {SHAKE_SAFE_ZONE,SHAKE_DURATION,isInShakeDangerZone,shakeCameraOffset} from '../src/game/shake.ts';
import {PenBattle} from '../src/game/PenBattle.ts';
const {Bodies,Body,Engine,Composite}=Matter;
let checks=0;
function check(name,fn){fn();checks++;console.log(`✓ ${name}`);}
function pen(){return createPenBody(200,300);}
function spin(offset){const body=pen();applyImpulseAtPoint(body,{x:0,y:body.mass*600},{x:200+offset,y:300});return body.angularVelocity;}
check('Centered impulse has zero spin and correct base-step linear velocity',()=>{
 const b=pen();applyImpulseAtPoint(b,{x:b.mass*600,y:0},b.position);
 assert.ok(Math.abs(b.angularVelocity)<1e-12);assert.ok(Math.abs(Body.getVelocity(b).x-10)<1e-10);
 const e=Engine.create({gravity:{x:0,y:0}});Composite.add(e.world,b);Engine.update(e,FIXED_STEP);assert.ok(b.position.x>209);
});
check('Off-center impulse spins; opposite offsets reverse spin; larger offset increases it',()=>{
 assert.ok(spin(20)>0);assert.ok(spin(-20)<0);assert.ok(Math.abs(spin(40))>Math.abs(spin(20)));
});
check('Drag power scales and caps impulse',()=>{const b=pen();assert.ok(calculateFlickImpulse({x:50,y:0}).x<calculateFlickImpulse({x:100,y:0}).x);assert.equal(calculateFlickImpulse({x:135,y:0}).x,calculateFlickImpulse({x:270,y:0}).x);});
check('Rotated tip and tail preserve exact contact, tolerance clamps only exterior hits',()=>{
 const b=pen();Body.setAngle(b,.7);
 for(const x of [-48,0,56]){const p=localToWorld(b,{x,y:0});const c=getPenContactPoint(b,p);assert.ok(c);assert.ok(Math.abs(c.local.x-x)<1e-9);assert.deepEqual(c.world,p);}
 const p=localToWorld(b,{x:0,y:12});assert.equal(getPenContactPoint(b,p,3),null);assert.ok(Math.abs(getPenContactPoint(b,p,5).local.y-(7-PEN_CENTROID.y))<1e-9);
 assert.deepEqual(screenToWorld({x:110,y:175},{left:10,top:20,width:200,height:310}),{x:200,y:310});
});
check('Center-of-mass support and configurable edge tolerance replace full-body elimination',()=>{
 const b=createPenBody(17,300);
 assert.equal(isPenOffTable(b),false);assert.ok(getPenBounds(b).min.x<17);
 Body.setPosition(b,{x:17-EDGE_TOLERANCE+.01,y:300});assert.equal(isPenOffTable(b),false);
 Body.setPosition(b,{x:17-EDGE_TOLERANCE-.01,y:300});assert.equal(isPenOffTable(b),true);assert.ok(getPenBounds(b).max.x>17);
 for(const pos of [{x:TABLE.max.x+EDGE_TOLERANCE+.01,y:300},{x:200,y:TABLE.min.y-EDGE_TOLERANCE-.01},{x:200,y:TABLE.max.y+EDGE_TOLERANCE+.01}]){Body.setPosition(b,pos);assert.equal(isPenOffTable(b),true);}
});
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
function fixture(){
 const listeners=new Map();let captured=null;
 const canvas={width:0,height:0,getContext:()=>({}),getBoundingClientRect:()=>({left:0,top:0,width:400,height:620}),addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n),setPointerCapture:id=>{captured=id;},hasPointerCapture:id=>captured===id,releasePointerCapture:()=>{captured=null;}};
 const game=new PenBattle(canvas,()=>{});
 const event=(x,y,id=1)=>({clientX:x,clientY:y,pointerId:id,isPrimary:true,button:0,pointerType:'touch',preventDefault(){}});
 return {game,listeners,event};
}
check('Aiming freezes bodies; secondary pointers ignored; cancellation never shoots',()=>{
 const {game,listeners,event}=fixture();const b=game.pens[0].body;const before=JSON.stringify({p:b.position,a:b.angle,v:b.velocity});
 const p=localToWorld(b,{x:45,y:0});listeners.get('pointerdown')(event(p.x,p.y));
 const selected={...game.drag.start};listeners.get('pointermove')(event(p.x-80,p.y+20));
 for(let i=0;i<120;i++)game.step();
 assert.equal(JSON.stringify({p:b.position,a:b.angle,v:b.velocity}),before);assert.deepEqual(game.drag.start,selected);
 listeners.get('pointerup')(event(0,0,2));assert.ok(game.drag);
 listeners.get('pointercancel')(event(0,0));assert.equal(game.drag,null);assert.equal(game.snapshot().phase,'aiming');game.destroy();
});
check('Pointer release applies selected-point impulse and automatically advances turn',()=>{
 const {game,listeners,event}=fixture();const b=game.pens[0].body;const p=localToWorld(b,{x:40,y:0});
 listeners.get('pointerdown')(event(p.x,p.y));listeners.get('pointerup')(event(p.x,p.y-20));
 assert.equal(game.snapshot().phase,'hand_animation');assert.equal(b.angularVelocity,0);
 while(game.snapshot().phase==='hand_animation')game.step();
 assert.equal(game.snapshot().phase,'physics');assert.ok(b.angularVelocity>0);
 for(let i=0;i<600&&!['aiming','finished'].includes(game.snapshot().phase);i++)game.step();
 assert.equal(game.snapshot().phase,'aiming');assert.equal(game.snapshot().turn,2);assert.equal(game.snapshot().currentPlayer,1);game.destroy();
});
check('Eliminated bodies are removed, winner and restart remain functional',()=>{
 const {game}=fixture();for(const p of game.pens.slice(1))Body.setPosition(p.body,{x:-200,y:-200});
 game.shoot({playerId:0,dx:.1,dy:0});for(let i=0;i<10;i++)game.step();
 assert.equal(game.engine.world.bodies.length,1);
 for(let i=0;i<600&&!['aiming','finished'].includes(game.snapshot().phase);i++)game.step();
 assert.equal(game.snapshot().phase,'finished');assert.equal(game.snapshot().winner,0);
 game.reset();assert.equal(game.engine.world.bodies.length,4);assert.equal(game.snapshot().turn,1);game.destroy();
});
check('Controlled moderate flick travels substantially less than V1.1 and spin decays naturally',()=>{
 const b=createPenBody(0,0);
 const e=Engine.create({gravity:{x:0,y:0}});Composite.add(e.world,b);
 applyImpulseAtPoint(b,calculateFlickImpulse({x:67.5,y:0}),b.position);
 Body.setAngularVelocity(b,.1);let previousSpin=.1;
 for(let i=0;i<360;i++){advancePhysics(e);assert.ok(b.angularVelocity>=0&&b.angularVelocity<=previousSpin+1e-10);previousSpin=b.angularVelocity;}
 const legacyTravel=11*(1-.035)/.035;
 assert.ok(b.position.x>30&&b.position.x<legacyTravel*.55);assert.ok(Body.getSpeed(b)<1e-8);
 console.log(`  Moderate-flick travel: ${b.position.x.toFixed(1)} vs V1.1 ~${legacyTravel.toFixed(1)} world units`);
});
check('Same impulse responds to actual mass and inertia, rather than cancelling increased density',()=>{
 const light=pen(),heavy=pen();Body.setMass(heavy,light.mass*2);
 const impulse=calculateFlickImpulse({x:100,y:0});
 applyImpulseAtPoint(light,impulse,{x:200,y:310});applyImpulseAtPoint(heavy,impulse,{x:200,y:310});
 assert.ok(Math.abs(Body.getVelocity(light).x/Body.getVelocity(heavy).x-2)<1e-9);
 assert.ok(Math.abs(light.angularVelocity/heavy.angularVelocity-2)<1e-9);
});
check('Finger contact gates impulse exactly once; follow-through fades; restart cancels pending contact',()=>{
 const {game}=fixture();const b=game.pens[0].body;const before={...b.position};
 game.shoot({playerId:0,dx:.5,dy:0});assert.equal(game.shoot({playerId:0,dx:1,dy:0}),false);
 for(let i=0;i<7;i++)game.step();assert.equal(game.snapshot().phase,'hand_animation');assert.deepEqual(b.position,before);assert.equal(Body.getSpeed(b),0);
 game.step();assert.equal(game.flick.elapsed,120);assert.equal(game.flick.contacted,true);assert.deepEqual(b.position,before);assert.ok(Body.getSpeed(b)>0);
 const atContact=Body.getSpeed(b);game.step();assert.ok(Body.getSpeed(b)<atContact);
 for(let i=0;i<30;i++)game.step();assert.equal(game.flick,null);
 game.reset();game.shoot({playerId:0,dx:1,dy:0});game.reset();
 for(let i=0;i<30;i++)game.step();assert.equal(game.flick,null);assert.equal(game.snapshot().phase,'aiming');assert.equal(Body.getSpeed(game.pens[0].body),0);game.destroy();
});
check('Strong flick transfers momentum through collisions and knocks a rival off the desk',()=>{
 const {game}=fixture();const attacker=game.pens[0].body,target=game.pens[1].body;
 Body.setAngle(attacker,0);Body.setAngle(target,0);
 Body.setPosition(attacker,{x:240,y:300});Body.setPosition(target,{x:380,y:300});
 assert.equal(isPenOffTable(target),false);
 game.shoot({playerId:0,dx:1,dy:0});let transferred=false;
 for(let i=0;i<450;i++){game.step();if(Body.getSpeed(target)>.5)transferred=true;}
 assert.ok(transferred);assert.equal(game.snapshot().alive[1],false);assert.ok(!game.engine.world.bodies.includes(target));game.destroy();
});
check('Strong off-center flick spins more than moderate, with physical polygon inertia',()=>{
 function flick(power,offset){const b=createPenBody(200,300);applyImpulseAtPoint(b,calculateFlickImpulse({x:0,y:power*135}),localToWorld(b,{x:offset,y:0}));return b;}
 const moderate=flick(.5,48),strong=flick(1,48),opposite=flick(1,-48),center=flick(1,0);
 assert.ok(strong.angularVelocity>moderate.angularVelocity*2);
 assert.ok(opposite.angularVelocity<0);assert.equal(center.angularVelocity,0);
 assert.ok(Math.abs(strong.inertia-Matter.Vertices.inertia(PEN_VERTICES,strong.mass))<1e-8);
 const e=Engine.create({gravity:{x:0,y:0}});Composite.add(e.world,strong);const initial=strong.angularVelocity;
 for(let i=0;i<300;i++)advancePhysics(e);
 assert.ok(Math.abs(strong.angularVelocity)<initial*.001);
});
check('Shared render silhouette, physical vertices, tip and rotated contact agree',()=>{
 const b=createPenBody(200,300,.63);const path=[];
 tracePenOutline({beginPath(){},moveTo(x,y){path.push({x,y});},lineTo(x,y){path.push({x,y});},closePath(){}});
 assert.equal(path.length,b.vertices.length);
 path.forEach((v,i)=>{const local={x:v.x-PEN_CENTROID.x,y:v.y-PEN_CENTROID.y};const world=localToWorld(b,local);assert.ok(Math.hypot(world.x-b.vertices[i].x,world.y-b.vertices[i].y)<1e-8);});
 const tip=localToWorld(b,{x:PEN_GEOMETRY.tip.x-PEN_CENTROID.x,y:-PEN_CENTROID.y});
 const contact=getPenContactPoint(b,tip,.001);assert.ok(contact);assert.ok(Math.hypot(contact.world.x-tip.x,contact.world.y-tip.y)<1e-8);
 assert.ok(Matter.Vertices.isConvex(PEN_VERTICES));assert.equal(b.parts.length,1);
});
function collisionScenario(name,aPosition,bPosition,aAngle,bAngle,velocity,otherVelocity={x:0,y:0}){
 check(name,()=>{
  const a=createPenBody(aPosition.x,aPosition.y,aAngle),b=createPenBody(bPosition.x,bPosition.y,bAngle);
  const e=Engine.create({gravity:{x:0,y:0},positionIterations:8,velocityIterations:8});Composite.add(e.world,[a,b]);
  Body.setVelocity(a,velocity);Body.setVelocity(b,otherVelocity);let hit=false;
  Matter.Events.on(e,'collisionStart',event=>{if(event.pairs.length)hit=true;});
  const substeps=collisionSubsteps([a,b]);assert.ok(substeps>=4);
  for(let i=0;i<24;i++)advancePhysics(e,()=>{
   if(!hit){
    const axis=Math.abs(velocity.x)>Math.abs(velocity.y)?'x':'y';
    assert.ok(a.position[axis]<b.position[axis],'body crossed its opponent without a collision');
   }
  });
  assert.ok(hit,'expected registered collision');
  assert.ok(Number.isFinite(a.angle)&&Number.isFinite(b.angle));
 });
}
collisionScenario('Tip-to-tip collision registers',{x:120,y:300},{x:260,y:300},0,Math.PI,{x:20,y:0});
collisionScenario('Tip-to-barrel collision registers',{x:150,y:300},{x:260,y:300},0,Math.PI/2,{x:20,y:0});
collisionScenario('Barrel-to-barrel collision registers',{x:200,y:240},{x:200,y:280},0,0,{x:0,y:20});
collisionScenario('Near-edge tip-to-barrel collision registers',{x:260,y:300},{x:375,y:300},0,Math.PI/2,{x:30,y:0});
collisionScenario('High-speed pen cannot tunnel through stationary perpendicular pen',{x:50,y:300},{x:250,y:300},0,Math.PI/2,{x:240,y:0});
collisionScenario('Opposing high-speed pens register contact',{x:70,y:300},{x:330,y:300},0,Math.PI,{x:160,y:0},{x:-160,y:0});
check('Falling detaches collisions immediately, animates, and gates victory until completion',()=>{
 const {game}=fixture();for(const p of game.pens.slice(1))Body.setPosition(p.body,{x:10,y:p.body.position.y});
 game.shoot({playerId:0,dx:.1,dy:0});while(game.snapshot().phase==='hand_animation')game.step();game.step();
 assert.equal(game.engine.world.bodies.length,1);
 const falling=game.pens[1];assert.ok(falling.fall);assert.equal(falling.alive,true);
 const start=fallingPose(falling.fall);const fixedPosition={...falling.body.position};
 for(let i=0;i<12;i++)game.step();
 assert.equal(game.snapshot().phase,'falling');assert.ok(falling.fall);assert.equal(falling.alive,true);
 const mid=fallingPose(falling.fall);assert.ok(mid.x<start.x);assert.ok(mid.scale<1);assert.ok(mid.squash<1);assert.ok(mid.opacity>0&&mid.opacity<1);assert.ok(mid.shadowSeparation>0);assert.notEqual(mid.angle,start.angle);
 assert.deepEqual(falling.body.position,fixedPosition);
 while(falling.fall)game.step();assert.equal(falling.alive,false);
 assert.ok(game.movingTime>=FALL_DURATION);
 for(let i=0;i<600&&!['aiming','finished'].includes(game.snapshot().phase);i++)game.step();
 assert.equal(game.snapshot().phase,'finished');assert.equal(game.snapshot().winner,0);
 game.reset();assert.ok(game.pens.every(p=>p.alive&&!p.fall));assert.equal(game.engine.world.bodies.length,4);game.destroy();
});
check('Late falls block an otherwise settled turn; restarting mid-fall clears every animation',()=>{
 const {game}=fixture();game.shoot({playerId:0,dx:.1,dy:0});for(let i=0;i<9;i++)game.step();
 for(const p of game.pens){Body.setVelocity(p.body,{x:0,y:0});Body.setAngularVelocity(p.body,0);}
 game.movingTime=1000;game.settledTime=200;
 Body.setPosition(game.pens[1].body,{x:390,y:300});game.step();
 assert.ok(game.pens[1].fall);assert.equal(game.snapshot().phase,'falling');
 for(let i=0;i<20;i++)game.step();assert.equal(game.snapshot().turn,1);assert.equal(game.snapshot().phase,'falling');
 game.reset();for(let i=0;i<40;i++)game.step();
 assert.equal(game.snapshot().phase,'aiming');assert.equal(game.snapshot().turn,1);assert.equal(game.engine.world.bodies.length,4);assert.ok(game.pens.every(p=>p.alive&&!p.fall));game.destroy();
});
function resolveAction(game){
 for(let i=0;i<1200&&!['aiming','finished'].includes(game.snapshot().phase);i++)game.step();
 assert.ok(['aiming','finished'].includes(game.snapshot().phase),'action must settle');
}
check('All four players start with one charge; current player only; snapshots do not expose mutable charge state',()=>{
 const {game}=fixture();assert.deepEqual(game.snapshot().shakeCharges,[1,1,1,1]);assert.equal(game.snapshot().canShake,true);
 assert.equal(game.shake(1),false);const snapshot=game.snapshot();snapshot.shakeCharges[0]=0;assert.equal(game.snapshot().shakeCharges[0],1);game.destroy();
});
check('Each shake consumes exactly one whole turn, even with no endangered pens, and cannot be reused',()=>{
 const {game}=fixture();const positions=game.pens.map(p=>({...p.body.position}));
 for(let player=0;player<4;player++){
  assert.equal(game.snapshot().currentPlayer,player);assert.equal(game.act({type:'shake',playerId:player}),true);
  assert.equal(game.snapshot().shakeCharges[player],0);assert.equal(game.shake(player),false);assert.equal(game.shoot({playerId:player,dx:1,dy:0}),false);
  resolveAction(game);assert.equal(game.snapshot().turn,player+2);assert.deepEqual(game.pens.map(p=>p.body.position),positions);assert.ok(game.pens.every(p=>p.alive));
 }
 assert.deepEqual(game.snapshot().shakeCharges,[0,0,0,0]);assert.equal(game.snapshot().currentPlayer,0);assert.equal(game.shake(0),false);assert.equal(game.snapshot().canShake,false);
 assert.equal(game.shoot({playerId:0,dx:.1,dy:0}),true);resolveAction(game);assert.equal(game.snapshot().turn,6);game.destroy();
});
check('Aiming disables shake, cancel restores it, and a flick locks out shaking through settling',()=>{
 const {game,listeners,event}=fixture();const p=game.pens[0].body.position;
 listeners.get('pointerdown')(event(p.x,p.y));assert.equal(game.snapshot().canShake,false);assert.equal(game.shake(0),false);
 listeners.get('pointercancel')(event(p.x,p.y));assert.equal(game.snapshot().canShake,true);
 listeners.get('pointerdown')(event(p.x,p.y));listeners.get('pointerup')(event(p.x,p.y-40));assert.equal(game.shake(0),false);
 while(game.snapshot().phase==='hand_animation')game.step();assert.equal(game.shake(0),false);assert.equal(game.snapshot().canShake,false);
 resolveAction(game);assert.deepEqual(game.snapshot().shakeCharges,[1,1,1,1]);assert.equal(game.shake(0),false);assert.equal(game.canShake(1),true);game.destroy();
});
check('Shake safe rectangle uses exactly 5% per axis, with threshold equality safe on every edge',()=>{
 const z=SHAKE_SAFE_ZONE;
 assert.ok(Math.abs(z.left-35.3)<1e-9);assert.ok(Math.abs(z.right-364.7)<1e-9);assert.ok(Math.abs(z.top-46.3)<1e-9);assert.ok(Math.abs(z.bottom-573.7)<1e-9);
 for(const p of [{x:z.left,y:300},{x:z.right,y:300},{x:200,y:z.top},{x:200,y:z.bottom},{x:z.left,y:z.top},{x:z.right,y:z.bottom},{x:200,y:300}])assert.equal(isInShakeDangerZone(p),false);
 for(const p of [{x:z.left-.001,y:300},{x:z.right+.001,y:300},{x:200,y:z.top-.001},{x:200,y:z.bottom+.001}])assert.equal(isInShakeDangerZone(p),true);
});
check('One shake can eliminate all four pens, including its owner, and waits for shake and falls before a draw',()=>{
 const {game}=fixture();const positions=[{x:20,y:300},{x:380,y:300},{x:200,y:20},{x:200,y:600}];
 game.pens.forEach((p,i)=>{Body.setPosition(p.body,positions[i]);assert.equal(isPenOffTable(p.body),false);});
 assert.equal(game.shake(0),true);while(game.snapshot().phase==='hand_animation')game.step();assert.equal(game.engine.world.bodies.length,0);assert.ok(game.pens.every(p=>p.fall&&p.alive));
 assert.deepEqual(game.pens.map(p=>p.fall.direction),[{x:-1,y:0},{x:1,y:0},{x:0,y:-1},{x:0,y:1}]);
 for(let i=0;i<21;i++)game.step();assert.equal(game.snapshot().phase,'falling');assert.ok(game.shakeElapsed!==null);assert.equal(game.snapshot().turn,1);assert.equal(game.snapshot().canShake,false);
 game.step();assert.equal(game.snapshot().phase,'falling');assert.ok(game.pens.some(p=>p.fall));
 resolveAction(game);assert.equal(game.snapshot().phase,'finished');assert.equal(game.snapshot().winner,null);assert.deepEqual(game.snapshot().alive,[false,false,false,false]);assert.equal(game.shake(0),false);game.destroy();
});
check('Shake leaves safe centers and boundary-equal centers unchanged while eliminating endangered rivals',()=>{
 const {game}=fixture();const z=SHAKE_SAFE_ZONE;
 Body.setPosition(game.pens[0].body,{x:z.left,y:300});Body.setPosition(game.pens[1].body,{x:z.right+.01,y:300});
 const before=game.pens.map(p=>({position:{...p.body.position},angle:p.body.angle,velocity:{...p.body.velocity}}));
 game.shake(0);while(game.snapshot().phase==='hand_animation')game.step();assert.equal(game.pens[0].fall,null);assert.ok(game.pens[1].fall);resolveAction(game);
 assert.deepEqual(game.snapshot().alive,[true,false,true,true]);assert.equal(game.snapshot().currentPlayer,2);assert.equal(game.snapshot().turn,2);
 game.pens.forEach((p,i)=>{assert.deepEqual(p.body.position,before[i].position);assert.equal(p.body.angle,before[i].angle);assert.deepEqual(p.body.velocity,before[i].velocity);});game.destroy();
});
check('Self-elimination skips activating player; one survivor wins only after animations finish',()=>{
 const {game}=fixture();[0,1,2].forEach(i=>Body.setPosition(game.pens[i].body,{x:20,y:100+i*150}));
 game.shake(0);while(game.snapshot().phase==='hand_animation')game.step();for(let i=0;i<23;i++)game.step();assert.equal(game.snapshot().phase,'falling');assert.equal(game.snapshot().winner,null);
 resolveAction(game);assert.equal(game.snapshot().phase,'finished');assert.equal(game.snapshot().winner,3);assert.equal(game.snapshot().canShake,false);game.destroy();
});
check('Restart during shaking and falling restores all charges and cancels both animations',()=>{
 const {game}=fixture();Body.setPosition(game.pens[0].body,{x:20,y:300});game.shake(0);game.step();game.reset();
 for(let i=0;i<50;i++)game.step();assert.deepEqual(game.snapshot().shakeCharges,[1,1,1,1]);assert.equal(game.shakeElapsed,null);assert.equal(game.flick,null);assert.ok(game.pens.every(p=>p.alive&&!p.fall));assert.equal(game.snapshot().phase,'aiming');assert.equal(game.snapshot().canShake,true);game.destroy();
});
check('Camera shake is deterministic, bounded, horizontal and vertical, and returns to rest',()=>{
 assert.deepEqual(shakeCameraOffset(0),{x:0,y:0});const a=shakeCameraOffset(83);assert.deepEqual(a,shakeCameraOffset(83));assert.ok(Math.abs(a.x)>0&&Math.abs(a.y)>0);
 for(let t=0;t<=SHAKE_DURATION;t++){const v=shakeCameraOffset(t);assert.ok(Math.abs(v.x)<=2.6&&Math.abs(v.y)<=1.7);}
 const end=shakeCameraOffset(SHAKE_DURATION);assert.ok(Math.abs(end.x)<1e-10&&Math.abs(end.y)<1e-10);
});
check('Power changes curl, extension speed, joint positions, follow-through and recovery',()=>{
 const low=handPose(.1,null),high=handPose(1,null);assert.ok(high.curl>low.curl);assert.notDeepEqual(high.joints,low.joints);assert.ok(handTiming(1).impact<handTiming(.1).impact);
 for(const power of [.1,.5,1]){
  const timing=handTiming(power),impact=handPose(power,timing.impact),follow=handPose(power,timing.impact+timing.follow),end=handPose(power,timing.impact+timing.follow+timing.recovery);
  assert.ok(Math.hypot(impact.fingertip.x,impact.fingertip.y)<1e-10);assert.equal(impact.thumbRelease,1);assert.ok(follow.followThrough>0);assert.ok(follow.fingertip.y<0);assert.equal(end.opacity,0);
  const joints=indexJoints(impact.curl);[23,19,15].forEach((length,i)=>assert.ok(Math.abs(Math.hypot(joints[i+1].x-joints[i].x,joints[i+1].y-joints[i].y)-length)<1e-9));
 }
 assert.ok(handPose(1,handTiming(1).impact+handTiming(1).follow).followThrough>handPose(.1,handTiming(.1).impact+handTiming(.1).follow).followThrough);
});
check('All powers apply their unchanged V1.3 impulse once, exactly at hand contact, with rotated off-center targeting',()=>{
 for(const power of [.1,.5,1]){
  const {game}=fixture();const body=game.pens[0].body,contact=localToWorld(body,{x:45,y:0}),before={...body.position};
  const expected=createPenBody(body.position.x,body.position.y,body.angle);applyImpulseAtPoint(expected,calculateFlickImpulse({x:0,y:power*135}),contact);
  assert.equal(game.act({type:'flick',playerId:0,dx:0,dy:power,contact}),true);
  const impact=handTiming(power).impact;for(let i=0;i<Math.ceil(impact/FIXED_STEP)-1;i++){game.step();assert.equal(Body.getSpeed(body),0);assert.deepEqual(body.position,before);}
  game.step();assert.equal(game.flick.contacted,true);assert.equal(game.flick.elapsed,impact);const pose=handPose(power,game.flick.elapsed);assert.ok(Math.hypot(pose.fingertip.x,pose.fingertip.y)<1e-10);
  assert.ok(Math.abs(Body.getVelocity(body).y-Body.getVelocity(expected).y)<1e-8);assert.ok(Math.abs(Body.getAngularVelocity(body)-Body.getAngularVelocity(expected))<1e-8);
  const firstSpeed=Body.getSpeed(body);game.step();assert.ok(Body.getSpeed(body)<firstSpeed);game.destroy();
 }
});
check('A slow render frame presents exact hand contact before catch-up physics can move the pen',()=>{
 const {game}=fixture();const before={...game.pens[0].body.position};game.shoot({playerId:0,dx:1,dy:0});
 game.flick.elapsed=80;game.last=1;let rendered=false;
 game.render=()=>{rendered=true;assert.equal(game.flick.elapsed,handTiming(1).impact);assert.deepEqual(game.pens[0].body.position,before);};
 game.tick(101);assert.ok(rendered);assert.ok(game.accumulator>=FIXED_STEP);assert.equal(game.flick.contacted,true);game.destroy();
});
console.log(`${checks} deterministic validation groups passed.`);
