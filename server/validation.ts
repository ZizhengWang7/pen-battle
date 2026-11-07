export class ClientError extends Error {constructor(public code:string,message:string){super(message);}}
export function requireThat(condition:unknown,code:string,message:string):asserts condition {if(!condition)throw new ClientError(code,message);}
export function object(raw:unknown,keys:string[]):Record<string,unknown>{requireThat(!!raw&&typeof raw==='object'&&!Array.isArray(raw),'invalid_payload','请求格式不正确');const value=raw as Record<string,unknown>;requireThat(Object.keys(value).every(key=>keys.includes(key)),'invalid_payload','请求包含不支持的字段');return value;}
export const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode(value:unknown):string {requireThat(typeof value==='string','invalid_code','请输入六位房间码');const code=value.trim().toUpperCase();requireThat(new RegExp(`^[${ALPHABET}]{6}$`).test(code),'invalid_code','房间码为六位字母或数字，不含 I、O、0、1');return code;}
export function nickname(value:unknown):string {requireThat(typeof value==='string','invalid_name','请输入昵称');const name=value.trim().replace(/ +/g,' ');requireThat([...name].length>=1&&[...name].length<=20&&/^[\p{L}\p{N} _.\-]+$/u.test(name),'invalid_name','昵称需为 1–20 个文字、数字、空格、下划线或短横线');return name;}
export function mode(value:unknown):'classic'|'evolution' {requireThat(value==='classic'||value==='evolution','invalid_mode','玩法不正确');return value;}
export function finite(value:unknown,min:number,max:number):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
export function point(raw:unknown):{x:number;y:number}{const p=object(raw,['x','y']);requireThat(finite(p.x,-1000,1500)&&finite(p.y,-1000,1500),'invalid_point','接触位置不正确');return {x:p.x,y:p.y};}
export class RateLimits {
 private buckets=new Map<string,{count:number;until:number}>();
 private nextSweep=0;
 constructor(private capacity=10000){}
 get size(){return this.buckets.size;}
 forgetPrefix(prefix:string){for(const key of this.buckets.keys())if(key.startsWith(prefix))this.buckets.delete(key);}
 allow(key:string,maximum:number,windowMs:number,now=Date.now()):boolean {
  if(now>=this.nextSweep){for(const [k,v] of this.buckets)if(now>=v.until)this.buckets.delete(k);this.nextSweep=now+1000;}
  let bucket=this.buckets.get(key);
  if(!bucket||now>=bucket.until){
   if(!bucket&&this.buckets.size>=this.capacity)return false;
   bucket={count:0,until:now+windowMs};this.buckets.set(key,bucket);
  }
  bucket.count++;return bucket.count<=maximum;
 }
}
