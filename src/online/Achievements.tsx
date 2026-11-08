import {PEN_TYPES,PEN_CLASSES} from '../game/pens';
import type {PlayerState} from '../game/types';
export function Achievements({player}:{player:PlayerState}){
 return <div className="achievements" aria-label={`${player.name} 笔型成就 ${player.completedPenKills.length}/5`}>{PEN_TYPES.map(type=><span key={type} className={player.completedPenKills.includes(type)?'completed':''} title={PEN_CLASSES[type].name}>{player.completedPenKills.includes(type)?'✓':'○'} {PEN_CLASSES[type].name}</span>)}</div>;
}
