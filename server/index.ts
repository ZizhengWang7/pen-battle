import {BattleServer} from './service';
import {allowedOrigins,positiveInt} from './config';
try{process.loadEnvFile?.();}catch{/* Hosting environments supply variables directly. */}
const server=new BattleServer({origins:allowedOrigins(process.env),roomTtlMs:positiveInt(process.env.ROOM_TTL_MS,600000),graceMs:positiveInt(process.env.RECONNECT_GRACE_MS,60000),maxRooms:positiveInt(process.env.MAX_ACTIVE_ROOMS,25,500),maxConnections:positiveInt(process.env.MAX_CONNECTIONS,120,2000)});
server.listen(positiveInt(process.env.PORT,3001,65535),process.env.HOST??'0.0.0.0').then(port=>console.log(`Pen Battle server listening on ${port}`)).catch(error=>{console.error('Could not start server:',error.message);process.exitCode=1;void server.close();});
let shuttingDown=false;
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{if(shuttingDown)return;shuttingDown=true;const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();void server.close().then(()=>process.exit(0));});
