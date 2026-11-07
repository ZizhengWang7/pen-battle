import {BattleServer} from './service';
try{process.loadEnvFile?.();}catch{/* Environment variables may be supplied directly by the host. */}
const positive=(name:string,fallback:number)=>{const n=Number(process.env[name]);return Number.isFinite(n)&&n>0?n:fallback;};
const server=new BattleServer({origins:(process.env.FRONTEND_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(',').map(s=>s.trim()),roomTtlMs:positive('ROOM_TTL_MS',600000),graceMs:positive('RECONNECT_GRACE_MS',60000)});
server.listen(positive('PORT',3001),process.env.HOST??'0.0.0.0').then(port=>console.log(`Pen Battle server listening on ${port}`)).catch(error=>{console.error('Could not start server:',error.message);process.exitCode=1;void server.close();});
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void server.close().then(()=>process.exit(0));});
