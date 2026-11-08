import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {PEN_TYPES,PEN_CLASSES,penGeometry,bodyPenType} from '../src/game/pens.ts';
import {createPenBody,applyImpulseAtPoint,advancePhysics,localToWorld,FIXED_STEP} from '../src/game/physics.ts';
import {createMatch,startMatch,seededRandom,acceptAction,recordElimination,scoreAction,nextTurn,WIN_SCORE} from '../src/game/rules.ts';
import {findSpawn,isSafeSpawn,RESPAWN_RETRY_MS} from '../src/game/spawn.ts';
import {isInShakeDangerZone} from '../src/game/shake.ts';
import {STRIKE_IMPACT,STRIKE_DURATION,strikePose} from '../src/game/strike.ts';
import {PenBattle} from '../src/game/PenBattle.ts';
const {Body,Engine,Composite,Query,Bodies}=Matter;
let count=0;
function check(name,fn){fn();count++;console.log(`✓ ${name}`);}
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
function fixture(mode='evolution',seed=42){
 const history=[],listeners=new Map();let capture=null;
 const canvas={width:0,height:0,getContext:()=>({}),getBoundingClientRect:()=>({left:0,top:0,width:400,height:620}),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),setPointerCapture:id=>{capture=id;},hasPointerCapture:id=>capture===id,releasePointerCapture:()=>{capture=null;}};
 const game=new PenBattle(canvas,s=>history.push(s),{mode,seed});return {game,history};
}
function until(game,predicate,limit=1600){for(let i=0;i<limit&&!predicate();i++)game.step();assert.ok(predicate(),`did not resolve; phase ${game.snapshot().phase}`);}
function resolve(game){until(game,()=>['aiming','finished'].includes(game.snapshot().phase));}
function readyShake(game,victims){
 const actor=game.snapshot().currentPlayer;
 victims.forEach((id,i)=>Body.setPosition(game.pens[id].body,{x:i%2===0?20:380,y:120+110*i}));
 assert.equal(game.shake(actor),true);return actor;
}
check('Mode selection initializes waiting state, Classic ballpoints and Evolution first shared pen',()=>{
 const classic=createMatch('classic',9),evolution=createMatch('evolution',9);assert.equal(classic.phase,'waiting');assert.equal(evolution.phase,'waiting');
 assert.ok(classic.players.every(p=>p.penType==='ballpoint'));assert.ok(evolution.players.every(p=>p.penType===evolution.progression[0]));startMatch(evolution);assert.equal(evolution.phase,'aiming');
 const {game}=fixture('classic',9);assert.equal(game.snapshot().mode,'classic');game.reset('evolution',9);assert.equal(game.snapshot().mode,'evolution');assert.ok(game.pens.every(p=>bodyPenType(p.body)===game.snapshot().progression[0]));game.destroy();
});
check('Seeded PRNG, progression and randomized Evolution turn order are deterministic',()=>{
 const a=createMatch('evolution',123),b=createMatch('evolution',123);assert.deepEqual(a,b);assert.equal(new Set(a.progression).size,5);assert.equal(new Set(a.turnOrder).size,4);
 const variants=new Set(Array.from({length:20},(_,seed)=>createMatch('evolution',seed).turnOrder.join('')));assert.ok(variants.size>5);
 const routes=new Set(Array.from({length:20},(_,seed)=>createMatch('evolution',seed).progression.join(',')));assert.ok(routes.size>5);
 const r1=seededRandom(0),r2=seededRandom(0);for(let i=0;i<100;i++){const n=r1();assert.equal(n,r2());assert.ok(n>=0&&n<1);}
 assert.deepEqual(createMatch('classic',999).turnOrder,[0,1,2,3]);
});
check('Five pen classes have strictly ordered masses, unique outlines, COMs, inertia, friction and damping',()=>{
 let mass=0;const inertias=new Set(),centers=new Set(),frictions=new Set(),damping=new Set();
 for(const type of PEN_TYPES){const b=createPenBody(200,300,0,type),p=PEN_CLASSES[type],g=penGeometry(type);assert.ok(b.mass>mass);mass=b.mass;assert.ok(Math.abs(b.mass-p.mass)<1e-10);assert.ok(Math.abs(b.inertia-g.inertia)<1e-8);assert.ok(Matter.Vertices.isConvex(p.outline));inertias.add(b.inertia);centers.add(JSON.stringify(g.center));frictions.add(b.friction);damping.add(p.angularDrag);}
 assert.equal(inertias.size,5);assert.equal(centers.size,5);assert.equal(frictions.size,5);assert.equal(damping.size,5);
});
check('All five weighted-COM collision outlines match the render model at arbitrary rotations',()=>{
 for(const type of PEN_TYPES)for(const angle of [0,.7,-1.3]){
  const b=createPenBody(140,320,angle,type),g=penGeometry(type);assert.deepEqual(b.position,{x:140,y:320});assert.equal(b.vertices.length,g.vertices.length);
  g.vertices.forEach((v,i)=>{const expected=localToWorld(b,v);assert.ok(Math.hypot(expected.x-b.vertices[i].x,expected.y-b.vertices[i].y)<1e-8,`${type} vertex ${i}`);});
  const centered=createPenBody(200,300,angle,type);applyImpulseAtPoint(centered,{x:0,y:3000},centered.position);assert.ok(Math.abs(centered.angularVelocity)<1e-12);
 }
});
const responses={};
check('Identical physical impulses produce low/medium/high class spin through inertia and damping',()=>{
 for(const type of PEN_TYPES){
  const body=createPenBody(0,0,0,type),e=Engine.create({gravity:{x:0,y:0}});Composite.add(e.world,body);
  applyImpulseAtPoint(body,{x:0,y:3000},{x:35,y:0});const initial=Body.getAngularVelocity(body);
  for(let i=0;i<120;i++)advancePhysics(e);responses[type]={initial,displacement:body.angle};
 }
 console.log('  Standardized J=3000, offset=35:',JSON.stringify(responses));
 for(const metric of ['initial','displacement']){
  assert.ok(responses.ballpoint[metric]>responses.mechanical[metric]);assert.ok(responses.ballpoint[metric]>responses.highlighter[metric]);
  assert.ok(responses.mechanical[metric]>responses.wooden[metric]);assert.ok(responses.highlighter[metric]>responses.wooden[metric]);
  assert.ok(responses.mechanical[metric]>responses.fountain[metric]);assert.ok(responses.highlighter[metric]>responses.fountain[metric]);
 }
});
check('Action attribution is deduplicated, excludes self, commits multiple kills atomically and caps upgrades',()=>{
 const state=createMatch('evolution',5);startMatch(state);const actor=state.currentPlayer,victims=state.turnOrder.filter(id=>id!==actor);
 assert.ok(acceptAction(state,{type:'flick',playerId:actor,dx:.5,dy:0}));assert.equal(acceptAction(state,{type:'shake',playerId:actor}),false);
 for(const id of [actor,...victims,victims[0],actor])recordElimination(state,id);
 assert.equal(state.players[actor].score,0);assert.equal(state.activeAction.eliminated.length,4);
 const changed=scoreAction(state);assert.equal(state.players[actor].score,3);assert.equal(state.players[actor].currentPenStage,2);assert.equal(state.players[actor].penType,state.progression[2]);assert.deepEqual(changed,[actor]);
 scoreAction(state);assert.equal(state.players[actor].score,3);assert.ok(state.players.every(p=>p.respawn==='pending'));
 state.players.forEach(p=>{p.alive=true;p.respawn='active';});state.phase='next_turn';assert.equal(nextTurn(state),true);assert.equal(state.activeAction,null);
 assert.ok(acceptAction(state,{type:'flick',playerId:state.currentPlayer,dx:.1,dy:0}));assert.deepEqual(state.activeAction.eliminated,[]);
});
check('Five-pen achievement victory and achievements are evaluated before any respawn or turn advancement',()=>{
 const state=createMatch('evolution',3);startMatch(state);const actor=state.currentPlayer;state.players[actor].score=4;state.players[actor].currentPenStage=4;state.players[actor].penType=state.progression[4];state.players[actor].completedPenKills=state.progression.slice(0,4);
 acceptAction(state,{type:'shake',playerId:actor});for(const p of state.players)recordElimination(state,p.id);scoreAction(state);
 assert.equal(state.players[actor].score,7);assert.equal(state.players[actor].currentPenStage,3);assert.equal(state.winner,actor);assert.equal(state.phase,'finished');const turn=state.turn;assert.equal(nextTurn(state),false);assert.equal(state.turn,turn);
});
check('Spawn placement is seeded, fully inside safe zone, non-overlapping and starts at rest for every class',()=>{
 for(const type of PEN_TYPES){const placed=[];
  for(let id=0;id<4;id++){
   const body=findSpawn(type,placed,28,id),again=findSpawn(type,placed,28,id);assert.ok(body);assert.deepEqual(body.position,again.position);assert.equal(body.angle,again.angle);assert.ok(isSafeSpawn(body,placed));assert.equal(isInShakeDangerZone(body.position),false);assert.equal(Body.getSpeed(body),0);assert.equal(Body.getAngularVelocity(body),0);placed.push(body);
  }
  for(let i=0;i<placed.length;i++)assert.equal(Query.collides(placed[i],placed.filter((_,j)=>i!==j)).length,0);
 }
 assert.equal(findSpawn('wooden',[Bodies.rectangle(200,310,1000,1000)],2,0),null);
});
check('Classic still eliminates permanently, awards no Evolution points and preserves its fixed turn order',()=>{
 const {game}=fixture('classic',77);readyShake(game,[1]);resolve(game);const s=game.snapshot();assert.equal(s.alive[1],false);assert.equal(s.currentPlayer,2);assert.equal(s.phase,'aiming');assert.ok(s.players.every(p=>p.score===0&&p.currentPenStage===0&&p.penType==='ballpoint'));assert.equal(s.players[1].respawn,'eliminated');assert.equal(game.engine.world.bodies.length,3);game.destroy();
});
check('Evolution shake multiple kills score, upgrade and respawn before advancing in randomized order',()=>{
 const {game,history}=fixture();const initial=game.snapshot(),actor=initial.currentPlayer,victims=initial.turnOrder.filter(id=>id!==actor).slice(0,2);
 readyShake(game,victims);until(game,()=>game.snapshot().phase==='scoring');assert.equal(game.snapshot().players[actor].score,0);game.step();assert.equal(game.snapshot().players[actor].score,2);assert.equal(game.snapshot().phase,'upgrading');
 resolve(game);const s=game.snapshot();assert.equal(s.players[actor].currentPenStage,2);assert.equal(s.players[actor].penType,s.progression[2]);assert.equal(bodyPenType(game.pens[actor].body),s.progression[2]);assert.ok(s.players.every(p=>p.alive&&p.respawn==='active'));assert.equal(s.players[actor].shakeCharge,0);assert.equal(s.currentPlayer,s.turnOrder[1]);assert.equal(s.turn,2);
 for(const phase of ['hand_animation','falling','scoring','upgrading','respawning','next_turn','aiming'])assert.ok(history.some(h=>h.phase===phase),phase);
 assert.ok(s.notices.some(n=>n.kind==='upgrade'));assert.equal(s.notices.filter(n=>n.kind==='respawn').length,2);
 for(const victim of victims){const body=game.pens[victim].body;assert.ok(isSafeSpawn(body,game.engine.world.bodies.filter(b=>b!==body)));assert.equal(Body.getSpeed(body),0);}
 game.destroy();
});
check('Self-elimination preserves score and spent shake, and respawns at the downgraded type',()=>{
 const {game}=fixture();const actor=game.snapshot().currentPlayer;game.match.players[actor].score=2;game.match.players[actor].currentPenStage=2;game.match.players[actor].penType=game.match.progression[2];game.replaceUpgrade(actor);
 readyShake(game,[actor]);resolve(game);const p=game.snapshot().players[actor];assert.equal(p.score,2);assert.equal(p.currentPenStage,1);assert.equal(p.penType,game.snapshot().progression[1]);assert.equal(p.shakeCharge,0);assert.equal(p.alive,true);assert.equal(p.respawn,'active');assert.equal(bodyPenType(game.pens[actor].body),p.penType);game.destroy();
});
check('Indirect collision falls are credited to the acting player and do not leak into the next action',()=>{
 const {game}=fixture();const actor=game.snapshot().currentPlayer,target=game.snapshot().turnOrder[1];let other=0;
 game.pens.forEach(p=>{Body.setVelocity(p.body,{x:0,y:0});if(p.id===actor){Body.setAngle(p.body,0);Body.setPosition(p.body,{x:220,y:310});}else if(p.id===target){Body.setAngle(p.body,Math.PI/2);Body.setPosition(p.body,{x:378,y:310});}else Body.setPosition(p.body,{x:100+other++*180,y:110});});
 assert.ok(game.shoot({playerId:actor,dx:1,dy:0}));resolve(game);assert.ok(game.snapshot().players[actor].score>=1);assert.ok(game.snapshot().players[target].alive);assert.equal(game.snapshot().activeAction,null);
 const before=game.snapshot().players.map(p=>p.score),next=game.snapshot().currentPlayer;assert.ok(game.shoot({playerId:next,dx:.08,dy:0}));resolve(game);assert.deepEqual(game.snapshot().players.map(p=>p.score),before);game.destroy();
});
check('Blocked respawns remain pending and retry every safe interval without advancing turns',()=>{
 const {game}=fixture();const initial=game.snapshot(),victim=initial.turnOrder[1];readyShake(game,[victim]);until(game,()=>game.snapshot().phase==='respawning');
 const blocker=Bodies.rectangle(200,310,1000,1000,{isStatic:true});Composite.add(game.engine.world,blocker);
 for(let i=0;i<40;i++)game.step();assert.equal(game.snapshot().phase,'respawning');assert.equal(game.snapshot().players[victim].respawn,'pending');assert.equal(game.snapshot().turn,1);assert.equal(game.snapshot().currentPlayer,initial.currentPlayer);assert.equal(game.shoot({playerId:initial.currentPlayer,dx:1,dy:0}),false);assert.ok(RESPAWN_RETRY_MS>0);
 Composite.remove(game.engine.world,blocker);resolve(game);assert.equal(game.snapshot().turn,2);assert.equal(game.snapshot().players[victim].respawn,'active');game.destroy();
});
check('A winning Evolution action commits every victim, excludes self, and stops before upgrades or respawns',()=>{
 const {game,history}=fixture();const actor=game.snapshot().currentPlayer;game.match.players[actor].completedPenKills=game.match.progression.slice(0,4);game.match.players[actor].score=4;game.match.players[actor].currentPenStage=4;game.match.players[actor].penType=game.match.progression[4];game.replaceUpgrade(actor);
 readyShake(game,[0,1,2,3]);until(game,()=>game.snapshot().phase==='scoring');const length=history.length;game.step();const s=game.snapshot();assert.equal(s.phase,'finished');assert.equal(s.winner,actor);assert.equal(s.players[actor].score,7);assert.equal(s.players[actor].completedPenKills.length,5);assert.equal(s.turn,1);assert.equal(s.activeAction.eliminated.length,4);assert.equal(s.activeAction.scored,true);assert.equal(game.engine.world.bodies.length,0);
 for(let i=0;i<100;i++)game.step();assert.equal(game.snapshot().phase,'finished');assert.ok(!history.slice(length).some(h=>['upgrading','respawning','next_turn'].includes(h.phase)));game.destroy();
});
check('Explicit seeded restart preserves mode and seed, resets scores/progression/charges and reproduces turn order',()=>{
 const {game}=fixture('evolution',55),original=game.snapshot();readyShake(game,[original.turnOrder[1]]);resolve(game);assert.ok(game.snapshot().players.some(p=>p.score>0));
 game.reset(original.mode,original.seed);const s=game.snapshot();assert.equal(s.mode,'evolution');assert.equal(s.seed,55);assert.deepEqual(s.turnOrder,original.turnOrder);assert.deepEqual(s.progression,original.progression);assert.equal(s.turn,1);assert.equal(s.activeAction,null);assert.equal(s.winner,null);assert.equal(s.notices.length,0);assert.ok(s.players.every(p=>p.score===0&&p.currentPenStage===0&&p.penType===s.progression[0]&&p.shakeCharge===1&&p.alive));game.destroy();
});
check('Table-strike impact timing creates no duplicate bodies and checks danger exactly once at contact',()=>{
 const {game}=fixture('classic');const originalBodies=[...game.engine.world.bodies],positions=originalBodies.map(b=>({...b.position}));readyShake(game,[1]);const selectedPosition={...game.pens[1].body.position};
 for(let i=0;i<Math.ceil(STRIKE_IMPACT/FIXED_STEP)-1;i++){game.step();assert.equal(game.pens[1].fall,null);assert.equal(game.engine.world.bodies.length,4);}
 assert.ok(strikePose(STRIKE_IMPACT*.5).lift>0);assert.equal(strikePose(STRIKE_IMPACT).lift,0);game.step();assert.equal(game.strike.impacted,true);assert.equal(game.strike.elapsed,STRIKE_IMPACT);assert.ok(game.pens[1].fall);assert.equal(game.engine.world.bodies.length,3);assert.deepEqual(game.pens[1].body.position,selectedPosition);
 assert.equal(game.match.activeAction.eliminated.length,1);game.step();assert.equal(game.match.activeAction.eliminated.length,1);assert.equal(strikePose(STRIKE_DURATION).opacity,0);game.destroy();
});
check('Match snapshots are detached and no pending-respawn player can receive the next turn',()=>{
 const {game}=fixture();const snapshot=game.snapshot();snapshot.players[0].score=99;snapshot.progression.reverse();snapshot.turnOrder.reverse();assert.equal(game.snapshot().players[0].score,0);assert.notDeepEqual(snapshot.progression,game.snapshot().progression);game.destroy();
 const state=createMatch('evolution',2);startMatch(state);state.phase='next_turn';state.players[state.turnOrder[1]].respawn='pending';assert.equal(nextTurn(state),false);assert.equal(state.turn,1);
});
check('Shake checks live COM positions at impact, not a stale selection-time victim list',()=>{
 const {game}=fixture('classic');Body.setPosition(game.pens[1].body,{x:20,y:300});game.shake(0);
 for(let i=0;i<5;i++)game.step();assert.equal(game.pens[1].fall,null);
 Body.setPosition(game.pens[1].body,{x:200,y:300});Body.setPosition(game.pens[2].body,{x:380,y:420});
 until(game,()=>game.strike?.impacted===true);assert.equal(game.pens[1].fall,null);assert.ok(game.pens[2].fall);assert.deepEqual(game.snapshot().activeAction.eliminated,[2]);game.destroy();
});
check('An upgrade that would overlap queues a safe relocation without awarding another elimination',()=>{
 const {game}=fixture();const actor=game.snapshot().currentPlayer,other=game.snapshot().turnOrder[1];
 Body.setAngle(game.pens[actor].body,Math.PI/2);Body.setPosition(game.pens[actor].body,{x:200,y:310});Body.setAngle(game.pens[other].body,Math.PI/2);Body.setPosition(game.pens[other].body,{x:216,y:310});
 assert.equal(Query.collides(game.pens[actor].body,[game.pens[other].body]).length,0);
 game.match.players[actor].penType='highlighter';game.match.players[actor].score=1;game.match.players[actor].currentPenStage=1;
 game.replaceUpgrade(actor);assert.equal(game.match.players[actor].respawn,'pending');assert.equal(game.pens[actor].alive,false);assert.equal(game.snapshot().players[actor].score,1);
 game.respawn();assert.equal(game.match.players[actor].respawn,'active');const body=game.pens[actor].body;assert.equal(bodyPenType(body),'highlighter');assert.ok(isSafeSpawn(body,game.engine.world.bodies.filter(b=>b!==body)));assert.equal(game.snapshot().players[actor].score,1);game.destroy();
});
check('V2.1 standardized travel and rotation improve highlighter and fountain while ballpoint leads spin',()=>{
 const results={};
 for(const type of PEN_TYPES){
  const travel=createPenBody(0,0,0,type),spin=createPenBody(0,0,0,type);
  const e1=Engine.create({gravity:{x:0,y:0}}),e2=Engine.create({gravity:{x:0,y:0}});Composite.add(e1.world,travel);Composite.add(e2.world,spin);
  applyImpulseAtPoint(travel,{x:0,y:3000},travel.position);applyImpulseAtPoint(spin,{x:0,y:3000},{x:35,y:0});
  for(let i=0;i<120;i++){advancePhysics(e1);advancePhysics(e2);}
  results[type]={travel:travel.position.y,rotation:spin.angle};
 }
 console.log('  V2.1 standardized 2-second travel / rotation:',JSON.stringify(results));
 assert.ok(results.highlighter.travel>66.5741*1.2);assert.ok(results.fountain.travel>42.5721*1.2);
 assert.ok(results.highlighter.rotation>3.9500);assert.ok(results.fountain.rotation>1.0806);
 for(const type of PEN_TYPES.filter(t=>t!=='ballpoint'))assert.ok(results.ballpoint.rotation>results[type].rotation);
});
check('Self-elimination penalty floors at zero, follows earned upgrades, preserves score and applies once',()=>{
 for(const type of ['flick','shake'])for(const [stage,kills,expected] of [[0,0,0],[3,0,2],[1,1,1],[3,3,3]]){
  const s=createMatch('evolution',9);startMatch(s);const actor=s.currentPlayer;s.players[actor].currentPenStage=stage;s.players[actor].score=1;
  acceptAction(s,type==='shake'?{type,playerId:actor}:{type,playerId:actor,dx:.2,dy:0});recordElimination(s,actor);recordElimination(s,actor);
  s.turnOrder.filter(id=>id!==actor).slice(0,kills).forEach(id=>recordElimination(s,id));scoreAction(s);
  assert.equal(s.players[actor].currentPenStage,expected);assert.equal(s.players[actor].penType,s.progression[expected]);assert.equal(s.players[actor].score,1+kills);scoreAction(s);assert.equal(s.players[actor].currentPenStage,expected);
 }
});
check('An opponent elimination never downgrades its victim; Classic never applies self downgrade',()=>{
 const s=createMatch('evolution',8);startMatch(s);const actor=s.currentPlayer,target=s.turnOrder[1];s.players[target].currentPenStage=3;s.players[target].penType=s.progression[3];acceptAction(s,{type:'flick',playerId:actor,dx:.1,dy:0});recordElimination(s,target);scoreAction(s);assert.equal(s.players[target].currentPenStage,3);
 const c=createMatch('classic',8);startMatch(c);acceptAction(c,{type:'shake',playerId:0});recordElimination(c,0);scoreAction(c);assert.equal(c.players[0].currentPenStage,0);assert.equal(c.players[0].penType,'ballpoint');
});
console.log(`${count} Evolution validation groups passed.`);
