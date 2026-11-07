import type {SceneFrame} from '../shared/protocol';
import Matter from 'matter-js';
import {FALL_DURATION,startFalling,fallingPose} from './falling';
import type {FallingPen} from './falling';
import {FIXED_STEP, createPenBody, advancePhysics, getPenContactPoint, calculateFlickImpulse, applyImpulseAtPoint, isPenOffTable} from './physics';
import {handTiming} from './hand';
import {SHAKE_DURATION,isInShakeDangerZone} from './shake';
import {createMatch,startMatch,canAct,acceptAction,recordElimination,scoreAction,nextTurn,notice} from './rules';
import {findSpawn,RESPAWN_RETRY_MS} from './spawn';
import {bodyPenType,PEN_CLASSES} from './pens';
import {STRIKE_IMPACT,STRIKE_DURATION} from './strike';
import type {GameSnapshot, PlayerId, ShotCommand, GameAction,GameMode} from './types';
const {Engine, Body, Composite, Vector} = Matter;
type Pen = {body: Matter.Body; id: PlayerId; alive: boolean;fall:FallingPen|null};
export class MatchEngine {
  protected engine=Engine.create({gravity:{x:0,y:0}});
  protected pens:Pen[]=[];
  protected match=createMatch();
  protected get current(){return this.match.currentPlayer;}
  protected get phase(){return this.match.phase;}
  protected set phase(value:GameSnapshot['phase']){this.match.phase=value;}
  protected flick: {point:Matter.Vector;direction:Matter.Vector;impulse:Matter.Vector;elapsed:number;power:number;contacted:boolean}|null=null;
  protected strike:{elapsed:number;impacted:boolean;playerId:PlayerId}|null=null;
  protected shakeElapsed:number|null=null;
  protected phaseTime=0;
  protected upgrades:PlayerId[]=[];
  protected upgraded=false;
  protected respawnRetry=0;
  protected respawnGlows=new Map<PlayerId,number>();
  protected settledTime=0;
  protected onReset:(()=>void)|undefined;
  protected onAction:(()=>void)|undefined;
  protected onChange:(state:GameSnapshot)=>void;
  protected movingTime=0;
  simulationTick=0;
  constructor(options:{mode?:GameMode;seed?:number}={},onChange:(s:GameSnapshot)=>void=()=>{}){
    this.onChange=onChange;this.reset(options.mode??'classic',options.seed??1);
  }
  get status(){return this.phase;}
  get needsStep(){return !['waiting','aiming','finished'].includes(this.phase)||this.respawnGlows.size>0;}
  snapshot():GameSnapshot{return {...structuredClone(this.match),alive:this.pens.map(p=>p.alive),shakeCharges:this.match.players.map(p=>p.shakeCharge),canShake:this.canShake(this.current)};}
  protected emit(){this.onChange(this.snapshot());}
  reset(mode:GameMode=this.match.mode,seed=this.match.seed){
    this.onReset?.();this.simulationTick=0;this.flick=null;this.strike=null;this.shakeElapsed=null;this.settledTime=0;this.phaseTime=0;
    this.upgrades=[];this.upgraded=false;this.respawnRetry=0;this.respawnGlows.clear();
    this.match=createMatch(mode,seed);startMatch(this.match);Composite.clear(this.engine.world,false);
    const positions=[[105,165],[295,165],[105,455],[295,455]];
    this.pens=this.match.players.map(player=>{
      const [x,y]=positions[player.id];const angle=mode==='evolution'?Math.PI/2:(player.id%2===0?.27:-.27);
      const body=createPenBody(x,y,angle,player.penType);Composite.add(this.engine.world,body);
      return {body,id:player.id,get alive(){return player.alive;},set alive(value:boolean){player.alive=value;},fall:null};
    });this.movingTime=0;this.emit();
  }
  canShake(playerId:PlayerId):boolean {
    return canAct(this.match,playerId)&&this.match.players[playerId].shakeCharge===1&&!this.flick&&!this.strike&&this.shakeElapsed===null&&!this.pens.some(p=>p.fall);
  }
  act(action:GameAction):boolean {return action.type==='shake'?this.shake(action.playerId):this.shoot(action);}
  shake(playerId:PlayerId):boolean {
    if(!this.canShake(playerId)||!acceptAction(this.match,{type:'shake',playerId}))return false;
    this.strike={elapsed:0,impacted:false,playerId};this.movingTime=0;this.settledTime=0;this.emit();return true;
  }
  protected beginFall(pen:Pen){
    if(pen.fall||!pen.alive)return;
    recordElimination(this.match,pen.id);this.match.players[pen.id].respawn='falling';
    pen.fall=startFalling(pen.body);Composite.remove(this.engine.world,pen.body);
  }
  shoot(cmd:ShotCommand){
    if(!canAct(this.match,cmd.playerId))return false;
    const pen=this.pens[this.current];if(!pen.alive||pen.fall)return false;
    const len=Math.hypot(cmd.dx,cmd.dy);if(!Number.isFinite(len)||len<.02)return false;
    const scale=Math.min(len,1)/len;
    const contact=cmd.contact?getPenContactPoint(pen.body,cmd.contact,.001):{world:pen.body.position};if(!contact)return false;
    const impulse=calculateFlickImpulse({x:cmd.dx*scale*135,y:cmd.dy*scale*135});if(Vector.magnitude(impulse)===0)return false;
    if(!acceptAction(this.match,{...cmd,type:'flick'}))return false;
    this.onAction?.();this.flick={point:{...contact.world},direction:Vector.normalise(impulse),impulse,elapsed:0,power:Math.min(len,1),contacted:false};
    this.movingTime=0;this.settledTime=0;this.emit();return true;
  }
  protected enterPhase(phase:GameSnapshot['phase']){this.phase=phase;this.phaseTime=0;this.emit();}
  protected replaceUpgrade(id:PlayerId){
    const pen=this.pens[id],player=this.match.players[id];if(!pen.alive)return;
    const body=createPenBody(pen.body.position.x,pen.body.position.y,pen.body.angle,player.penType);
    const others=Composite.allBodies(this.engine.world).filter(b=>b!==pen.body);
    Composite.remove(this.engine.world,pen.body);
    if(Matter.Query.collides(body,others).length){player.alive=false;player.respawn='pending';return;}
    pen.body=body;Composite.add(this.engine.world,body);
  }
  protected respawn(){
    for(const id of this.match.turnOrder){
      const player=this.match.players[id];if(player.respawn!=='pending')continue;
      const body=findSpawn(player.penType,Composite.allBodies(this.engine.world),this.match.seed,id);if(!body)continue;
      this.pens[id].body=body;this.pens[id].fall=null;player.alive=true;player.respawn='active';
      Composite.add(this.engine.world,body);this.respawnGlows.set(id,0);notice(this.match,'respawn',id,`${player.name} 已重生 · ${PEN_CLASSES[player.penType].name}`);
    }
  }
  step(){
    this.simulationTick++;
    for(const [id,time] of this.respawnGlows){if(time>=600)this.respawnGlows.delete(id);else this.respawnGlows.set(id,time+FIXED_STEP);}
    this.phaseTime+=FIXED_STEP;
    if(this.phase==='scoring'){
      this.upgrades=scoreAction(this.match);this.upgraded=false;
      if(this.match.phase==='finished'){this.emit();return;}
      this.respawnRetry=0;this.enterPhase(this.upgrades.length?'upgrading':this.match.mode==='evolution'?'respawning':'next_turn');return;
    }
    if(this.phase==='upgrading'){
      if(this.phaseTime>=210&&!this.upgraded){this.upgraded=true;for(const id of this.upgrades)this.replaceUpgrade(id);}
      if(this.phaseTime>=420){this.respawnRetry=0;this.enterPhase('respawning');}return;
    }
    if(this.phase==='respawning'){
      this.respawnRetry-=FIXED_STEP;
      if(this.respawnRetry<=0){this.respawn();this.respawnRetry=RESPAWN_RETRY_MS;this.emit();}
      if(!this.match.players.some(p=>p.respawn==='pending')&&this.phaseTime>=320)this.enterPhase('next_turn');return;
    }
    if(this.phase==='next_turn'){if(nextTurn(this.match))this.emit();return;}
    if(this.flick){
      this.flick.elapsed+=FIXED_STEP;const timing=handTiming(this.flick.power);
      if(!this.flick.contacted&&this.flick.elapsed>=timing.impact){
        applyImpulseAtPoint(this.pens[this.current].body,this.flick.impulse,this.flick.point);
        this.flick.elapsed=timing.impact;this.flick.contacted=true;this.enterPhase('physics');return true;
      }
      if(this.flick.elapsed>=timing.impact+timing.follow+timing.recovery)this.flick=null;
    }
    if(this.strike){
      this.strike.elapsed+=FIXED_STEP;
      if(!this.strike.impacted&&this.strike.elapsed>=STRIKE_IMPACT){
        this.strike.elapsed=STRIKE_IMPACT;this.strike.impacted=true;this.shakeElapsed=0;
        for(const pen of this.pens)if(pen.alive&&!pen.fall&&isInShakeDangerZone(pen.body.position))this.beginFall(pen);
        this.enterPhase(this.pens.some(p=>p.fall)?'falling':'physics');return true;
      }
      if(this.strike.elapsed>=STRIKE_DURATION)this.strike=null;
    }
    if(this.shakeElapsed!==null){this.shakeElapsed+=FIXED_STEP;if(this.shakeElapsed>=SHAKE_DURATION)this.shakeElapsed=null;}
    if(this.phase==='physics'||this.phase==='falling'){
      let changed=false;
      for(const p of this.pens)if(p.fall){p.fall.elapsed+=FIXED_STEP;if(p.fall.elapsed>=FALL_DURATION){p.fall=null;p.alive=false;changed=true;}}
      const detectFalls=()=>{for(const p of this.pens)if(p.alive&&!p.fall&&isPenOffTable(p.body)){this.beginFall(p);changed=true;}};
      detectFalls();if(this.match.activeAction?.type!=='shake')advancePhysics(this.engine,detectFalls);
      this.movingTime+=FIXED_STEP;
      const falling=this.pens.some(p=>p.fall),nextPhase=falling?'falling':'physics';if(this.phase!==nextPhase){this.phase=nextPhase;changed=true;}
      const moving=this.pens.some(p=>p.alive&&!p.fall&&(Vector.magnitude(Body.getVelocity(p.body))>.045||Math.abs(Body.getAngularVelocity(p.body))>.0015));
      this.settledTime=moving?0:this.settledTime+FIXED_STEP;
      if(this.settledTime>=180&&this.movingTime>400&&!falling&&!this.flick&&!this.strike&&this.shakeElapsed===null){
        for(const p of this.pens)if(p.alive){Body.setVelocity(p.body,{x:0,y:0});Body.setAngularVelocity(p.body,0);}
        this.enterPhase('scoring');return;
      }
      if(changed)this.emit();
    }
  }
  setPlayerNames(names:string[]){this.match.players.forEach((player,id)=>{player.name=names[id]??player.name;});this.emit();}
  getScene():SceneFrame {
    return {state:this.snapshot(),pens:this.pens.map(p=>({id:p.id,type:bodyPenType(p.body),position:{...p.body.position},angle:p.body.angle,velocity:{...Body.getVelocity(p.body)},angularVelocity:Body.getAngularVelocity(p.body),alive:p.alive,fall:p.fall?structuredClone(p.fall):null})),
      flick:this.flick?structuredClone(this.flick):null,strike:this.strike?{...this.strike}:null,shakeElapsed:this.shakeElapsed,phaseTime:this.phaseTime,upgrades:[...this.upgrades],respawnGlows:[...this.respawnGlows]};
  }
  destroy(){Composite.clear(this.engine.world,false);Engine.clear(this.engine);}
}
