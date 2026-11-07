const DEVELOPMENT_ORIGINS=['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3001','http://127.0.0.1:3001'];
export function allowedOrigins(env:Record<string,string|undefined>){
 const origins=(env.FRONTEND_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(env.RENDER_EXTERNAL_URL){const url=new URL(env.RENDER_EXTERNAL_URL);if(url.protocol==='https:')origins.push(url.origin);}
 if(!origins.length&&env.NODE_ENV!=='production')origins.push(...DEVELOPMENT_ORIGINS);
 return [...new Set(origins)];
}
export function positiveInt(value:string|undefined,fallback:number,max=Number.MAX_SAFE_INTEGER){const n=Number(value);return Number.isSafeInteger(n)&&n>0?Math.min(max,n):fallback;}
