import Matter from 'matter-js';
import {PEN_GEOMETRY} from './geometry';
export type PenType='wooden'|'mechanical'|'ballpoint'|'highlighter'|'fountain';
export interface PenClass {
  id:PenType;name:string;mass:number;outline:Matter.Vector[];coreFraction:number;
  weights:{fraction:number;position:Matter.Vector}[];friction:number;linearDrag:number;sliding:number;angularDrag:number;spinDrag:number;
}
const outline=(points:number[][])=>points.map(([x,y])=>({x,y}));
export const PEN_CLASSES:Record<PenType,PenClass>={
 wooden:{id:'wooden',name:'木铅笔',mass:3.4,outline:outline([[-90,-3],[-87,-5],[70,-5],[90,0],[70,5],[-87,5],[-90,3]]),coreFraction:.78,weights:[{fraction:.17,position:{x:-80,y:0}},{fraction:.05,position:{x:75,y:0}}],friction:.35,linearDrag:3.1,sliding:.05,angularDrag:5.2,spinDrag:6.5},
 mechanical:{id:'mechanical',name:'自动铅笔',mass:4.4,outline:outline([[-70,-3],[-67,-6],[49,-6],[60,-3],[70,0],[60,3],[49,6],[-67,6],[-70,3]]),coreFraction:.9,weights:[{fraction:.07,position:{x:-57,y:0}},{fraction:.03,position:{x:60,y:0}}],friction:.22,linearDrag:2.8,sliding:.04,angularDrag:3,spinDrag:5},
 ballpoint:{id:'ballpoint',name:'圆珠笔',mass:5.4425,outline:PEN_GEOMETRY.outline,coreFraction:1,weights:[],friction:.26,linearDrag:2.76,sliding:.045,angularDrag:1.8,spinDrag:6},
 highlighter:{id:'highlighter',name:'荧光笔',mass:6.8,outline:outline([[-57,-12],[-52,-17],[43,-17],[57,-10],[57,10],[43,17],[-52,17],[-57,12]]),coreFraction:.94,weights:[{fraction:.04,position:{x:-40,y:0}},{fraction:.02,position:{x:40,y:0}}],friction:.32,linearDrag:2.3,sliding:.038,angularDrag:2.2,spinDrag:5},
 fountain:{id:'fountain',name:'金属钢笔',mass:8.8,outline:outline([[-58,-3],[-54,-7],[-38,-8],[24,-8],[40,-5],[56,0],[40,5],[24,8],[-38,8],[-54,7],[-58,3]]),coreFraction:.8,weights:[{fraction:.1,position:{x:-42,y:0}},{fraction:.1,position:{x:40,y:0}}],friction:.25,linearDrag:2.45,sliding:.04,angularDrag:2.8,spinDrag:6},
};
export const PEN_TYPES=Object.keys(PEN_CLASSES) as PenType[];
export function penGeometry(type:PenType){
 const p=PEN_CLASSES[type],geometricCenter=Matter.Vertices.centre(p.outline);
 const center={x:geometricCenter.x*p.coreFraction,y:geometricCenter.y*p.coreFraction};
 for(const weight of p.weights){center.x+=weight.position.x*weight.fraction;center.y+=weight.position.y*weight.fraction;}
 const centeredCore=p.outline.map(v=>Matter.Vector.sub(v,geometricCenter));
 const coreOffset=Matter.Vector.sub(geometricCenter,center);
 let inertia=p.mass*p.coreFraction*(Matter.Vertices.inertia(centeredCore,1)+Matter.Vector.dot(coreOffset,coreOffset));
 for(const weight of p.weights){const r=Matter.Vector.sub(weight.position,center);inertia+=p.mass*weight.fraction*Matter.Vector.dot(r,r);}
 const vertices=p.outline.map(v=>Matter.Vector.sub(v,center));
 return {center,geometricCenter,vertices,inertia,radius:Math.max(...vertices.map(v=>Math.hypot(v.x,v.y)))};
}
export function bodyPenType(body:Matter.Body):PenType{return body.plugin.penType??'ballpoint';}
