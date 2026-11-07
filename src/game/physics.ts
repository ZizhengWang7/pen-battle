import Matter from 'matter-js';
import {PEN_CLASSES,penGeometry,bodyPenType} from './pens';
import type {PenType} from './pens';
const {Body, Vector, Query} = Matter;
export const FIXED_STEP = 1000 / 60;
export const MAX_DRAG = 135;
export const TABLE = {min: {x:17,y:17}, max: {x:383,y:603}};
export function screenToWorld(client: Matter.Vector, rect: Pick<DOMRect,'left'|'top'|'width'|'height'>): Matter.Vector {
  return {x:(client.x-rect.left)/rect.width*400,y:(client.y-rect.top)/rect.height*620};
}
export function localToWorld(body: Matter.Body, local: Matter.Vector): Matter.Vector {
  return Vector.add(body.position,Vector.rotate(local,body.angle));
}
// Preserve exact interior clicks; only clamp tolerance hits to the collision surface.
export function getPenContactPoint(body: Matter.Body, point: Matter.Vector, tolerance=5): {world:Matter.Vector;local:Matter.Vector}|null {
  let world = {...point};
  if (!Query.point([body],point).length) {
    let distance=Infinity;
    for(let i=0;i<body.vertices.length;i++) {
      const a=body.vertices[i], b=body.vertices[(i+1)%body.vertices.length];
      const edge=Vector.sub(b,a);
      const t=Math.max(0,Math.min(1,Vector.dot(Vector.sub(point,a),edge)/Vector.dot(edge,edge)));
      const candidate=Vector.add(a,Vector.mult(edge,t));
      const d=Vector.magnitude(Vector.sub(point,candidate));
      if(d<distance){distance=d;world=candidate;}
    }
    if(distance>tolerance)return null;
  }
  return {world,local:Vector.rotate(Vector.sub(world,body.position),-body.angle)};
}
// Impulse uses mass * world units / second. Matter velocities use units per base step.
export function calculateFlickImpulse(drag: Matter.Vector): Matter.Vector {
  const length=Vector.magnitude(drag);
  return length<9?{x:0,y:0}:Vector.mult(drag,Math.pow(Math.min(length,MAX_DRAG)/MAX_DRAG,1.35)/length*6000);
}
export function applyImpulseAtPoint(body:Matter.Body, impulse:Matter.Vector, point:Matter.Vector) {
  const seconds=FIXED_STEP/1000;
  const r=Vector.sub(point,body.position);
  Body.setVelocity(body,Vector.add(Body.getVelocity(body),Vector.mult(impulse,seconds/body.mass)));
  Body.setAngularVelocity(body,Body.getAngularVelocity(body)+Vector.cross(r,impulse)*seconds/body.inertia);
}
export function getPenBounds(body:Matter.Body): Matter.Bounds {
  return {min:{x:Math.min(...body.vertices.map(v=>v.x)),y:Math.min(...body.vertices.map(v=>v.y))},max:{x:Math.max(...body.vertices.map(v=>v.x)),y:Math.max(...body.vertices.map(v=>v.y))}};
}
export const EDGE_TOLERANCE=1.5;
export function isPenOffTable(body:Matter.Body):boolean {
  const {x,y}=body.position;
  return x<TABLE.min.x-EDGE_TOLERANCE||x>TABLE.max.x+EDGE_TOLERANCE||y<TABLE.min.y-EDGE_TOLERANCE||y>TABLE.max.y+EDGE_TOLERANCE;
}
export function createPenBody(x:number,y:number,angle=0,type:PenType='ballpoint'):Matter.Body {
  const p=PEN_CLASSES[type],g=penGeometry(type);
  // Matter initially centers a polygon geometrically. Shift the rotation center
  // to the weighted COM without moving its vertices, then rotate about that COM.
  const body=Body.create({position:{x:x+g.geometricCenter.x-g.center.x,y:y+g.geometricCenter.y-g.center.y},vertices:p.outline.map(v=>({...v})),
    frictionAir:0,friction:p.friction,frictionStatic:p.friction+.12,restitution:.10,slop:.02});
  Body.setMass(body,p.mass);Body.setCentre(body,{x,y});Body.setInertia(body,g.inertia);
  body.plugin.penType=type;Body.setAngle(body,angle);return body;
}

// Independently dissipate translation and rotation; no generic air friction.
export function applyDeskResistance(body:Matter.Body,dt=FIXED_STEP){
  const p=PEN_CLASSES[bodyPenType(body)];
  const velocity=Body.getVelocity(body), speed=Vector.magnitude(velocity);
  const fraction=dt/FIXED_STEP;
  const nextSpeed=Math.max(0,speed-p.sliding*fraction)*Math.exp(-p.linearDrag*dt/1000);
  if(speed>0)Body.setVelocity(body,Vector.mult(velocity,nextSpeed/speed));
  const angular=Body.getAngularVelocity(body);
  // Viscous drag plus speed-dependent rotational drag limits energetic flicks
  // while allowing low-speed rotation to persist longer than in V1.2.
  Body.setAngularVelocity(body,angular*Math.exp(-(p.angularDrag+p.spinDrag*Math.abs(angular))*dt/1000));
}
export function collisionSubsteps(bodies:Matter.Body[]):number {
  const motion=Math.max(0,...bodies.map(b=>Body.getSpeed(b)+Math.abs(Body.getAngularVelocity(b))*penGeometry(bodyPenType(b)).radius));
  // Target <=1 pixel of fastest-point motion per substep (relative <=2).
  // Bound cost for pathological injected velocities; normal flicks stay below the cap.
  return Math.min(128,Math.max(4,Math.ceil(motion)));
}
export function advancePhysics(engine:Matter.Engine,afterSubstep:()=>void=()=>{}){
  const steps=collisionSubsteps(Matter.Composite.allBodies(engine.world));
  for(let i=0;i<steps;i++){
    for(const body of Matter.Composite.allBodies(engine.world))applyDeskResistance(body,FIXED_STEP/steps);
    Matter.Engine.update(engine,FIXED_STEP/steps);
    afterSubstep();
  }
}
