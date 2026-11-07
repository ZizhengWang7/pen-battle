import Matter from 'matter-js';

// One convex silhouette: rounded tail, barrel, tapered metal cone and nib.
// A single solid avoids seams, overlapping parts and compound-body contact gaps.
export const PEN_GEOMETRY = {
  outline: [
    {x:-56,y:-5},{x:-53,y:-8},{x:32,y:-8},{x:44,y:-6},
    {x:57,y:0},{x:44,y:6},{x:40,y:7},{x:-53,y:7},{x:-56,y:4},
  ],
  barrelEnd:44,
  tip:{x:57,y:0},
  clip:{x:-50,y:-8,width:31,height:4},
};
export const PEN_CENTROID=Matter.Vertices.centre(PEN_GEOMETRY.outline);
export const PEN_VERTICES=PEN_GEOMETRY.outline.map(v=>({x:v.x-PEN_CENTROID.x,y:v.y-PEN_CENTROID.y}));
export const PEN_RADIUS=Math.max(...PEN_VERTICES.map(v=>Math.hypot(v.x,v.y)));
export function tracePenOutline(c:CanvasRenderingContext2D){
  c.beginPath();PEN_GEOMETRY.outline.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.closePath();
}
