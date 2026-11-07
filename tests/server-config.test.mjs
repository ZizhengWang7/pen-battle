import assert from 'node:assert/strict';
import {allowedOrigins,positiveInt} from '../server/config.ts';
import {RateLimits} from '../server/validation.ts';
let checks=0;
function check(name,fn){fn();checks++;console.log(`✓ ${name}`);}
check('Render production origin comes only from configured canonical URL, without wildcard or implicit localhost',()=>{
 assert.deepEqual(allowedOrigins({NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://pen-test.onrender.com'}),['https://pen-test.onrender.com']);
 assert.deepEqual(allowedOrigins({NODE_ENV:'production'}),[]);
 assert.deepEqual(allowedOrigins({NODE_ENV:'production',FRONTEND_ORIGINS:'https://friends.example, https://friends.example',RENDER_EXTERNAL_URL:'https://pen-test.onrender.com'}),['https://friends.example','https://pen-test.onrender.com']);
 assert.ok(allowedOrigins({}).includes('http://localhost:5173'));
});
check('Capacity and timeout configuration rejects invalid values and clamps maximums',()=>{
 assert.equal(positiveInt('25',5,100),25);for(const invalid of ['-1','0','NaN','Infinity','1.5'])assert.equal(positiveInt(invalid,5,100),5);assert.equal(positiveInt('50000',5,100),100);
});
check('Rate-limit storage is bounded, fails closed, expires entries and forgets disconnected sockets',()=>{
 const limits=new RateLimits(2);assert.equal(limits.allow('socket-a:action',1,100,0),true);assert.equal(limits.allow('socket-a:action',1,100,0),false);assert.equal(limits.allow('ip:b',2,100,0),true);assert.equal(limits.allow('ip:c',2,100,0),false);assert.equal(limits.size,2);
 limits.forgetPrefix('socket-a:');assert.equal(limits.size,1);assert.equal(limits.allow('ip:c',2,100,0),true);assert.equal(limits.allow('ip:d',2,100,1001),true);assert.equal(limits.size,1);
});
console.log(`${checks} production configuration groups passed.`);
