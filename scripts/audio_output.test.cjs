const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse,TTL}=require('../frontend/audio_output.js');
const now=Date.UTC(2026,9,22,12);
test('a choice survives reloads for 24 hours without extending the confirmation',()=>{
  for(const type of ['bluetooth','standard']){
    const raw=JSON.stringify({type,confirmedAt:now});
    assert.deepEqual(parse(raw,now),{type,confirmedAt:now});
    assert.deepEqual(parse(raw,now+TTL-1),{type,confirmedAt:now});
    assert.equal(parse(raw,now+TTL),null);
    assert.equal(parse(raw,now+TTL+1),null);
  }
});
test('unknown, malformed, missing and future confirmations always require a choice',()=>{
  for(const raw of [null,'undefined','{}','[]','false','{',
    JSON.stringify({type:'headphones',confirmedAt:now}),
    JSON.stringify({type:'bluetooth'}),
    JSON.stringify({type:'standard',confirmedAt:String(now)}),
    JSON.stringify({type:'standard',confirmedAt:now+1})])assert.equal(parse(raw,now),null);
});
