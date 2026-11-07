export const STRIKE_IMPACT=180;
export const STRIKE_DURATION=380;
export function strikePose(elapsed:number){
 const t=Math.max(0,Math.min(elapsed/STRIKE_IMPACT,1));
 // Lift during the wind-up; accelerated descent ends exactly on the tabletop.
 const lift=t<.55?18*Math.sin(t/.55*Math.PI/2):18*(1-Math.pow((t-.55)/.45,2));
 const recovery=Math.max(0,Math.min(1,(elapsed-STRIKE_IMPACT)/(STRIKE_DURATION-STRIKE_IMPACT)));
 return {lift:t>=1?0:Math.max(0,lift),scale:1+lift*.0015,withdraw:recovery*25,opacity:1-recovery};
}
