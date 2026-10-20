import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticInspector, handleEchoDiagnosticApi, MAX_DIAGNOSTIC_BYTES, purgeExpiredEchoDiagnostics } from '../src/echo_diagnostics';
import type { Env, MemberContext } from '../src/types';

const member: MemberContext={memberId:'singer',choirId:'choir',displayName:'Singer',voicePart:'tenore',roles:['singer'],groupIds:[],viewableGroupIds:[]};
const director: MemberContext={...member,memberId:'director',roles:['director']};
const endpoint='https://choir.example/api/echo-diagnostics';
function fixture() {
  const metadata={schemaVersion:1,pieceId:'song',scoreVersion:'score-v1',partId:'P3',frames:4,sampleRate:48000,format:'float32le',
    channelNames:['microphone-raw','app-reference','microphone-processed','echo-prediction-unscaled'],pitchFrames:[],echo:{},mixer:{}};
  const encoded=new TextEncoder().encode(JSON.stringify(metadata)), b=new Uint8Array(44+64+8+encoded.length+encoded.length%2),v=new DataView(b.buffer);
  const tag=(at:number,s:string)=>b.set(new TextEncoder().encode(s),at);
  tag(0,'RIFF');v.setUint32(4,b.length-8,true);tag(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,4,true);
  v.setUint32(24,48000,true);v.setUint32(28,48000*16,true);v.setUint16(32,16,true);v.setUint16(34,32,true);tag(36,'data');v.setUint32(40,64,true);
  for(let i=0;i<16;i++)v.setFloat32(44+i*4,i/10,true);
  tag(108,'chAI');v.setUint32(112,encoded.length,true);b.set(encoded,116);return b;
}
function request(bytes=fixture(), consent=true,id='test-one') {
  return new Request(`${endpoint}?id=${id}&pieceId=song&scoreVersionId=score-v1&partId=P3`,{method:'POST',
    headers:{'Content-Type':'audio/wav','Content-Length':String(bytes.length),...(consent?{'X-Diagnostic-Consent':'capture-store-share-v1'}:{})},body:bytes as BodyInit});
}
type Row=Record<string,string|number>;
function setup() {
  const records:Row[]=[],objects=new Map<string,Uint8Array>(),queue=new Set<string>();let failPut=false,failCommit=false;
  vi.stubGlobal('FixedLengthStream',class {
    readable:ReadableStream;writable:WritableStream;
    constructor(length:number){let count=0;const t=new TransformStream({transform(chunk,controller){count+=chunk.length;if(count>length)throw Error('length');controller.enqueue(chunk)},flush(){if(count!==length)throw Error('length')}});this.readable=t.readable;this.writable=t.writable;}
  });
  const db={prepare(query:string){let bound:unknown[]=[];const s={bind(...values:unknown[]){bound=values;return s},
    async first(){if(query.includes('SELECT * FROM echo_diagnostics'))return records.find(r=>r.id===bound[0]&&r.member_id===bound[1]&&r.choir_id===bound[2]&&r.expires_at!>String(bound[3]))??null;
      return records.find(r=>r.id===bound[0]&&r.choir_id===bound[1]&&r.expires_at!>String(bound[2])&&(bound.length<4||r.member_id===bound[3]))??null;},
    async all(){return {results:query.includes('echo_diagnostic_cleanup')?[...queue].filter(k=>!records.some(r=>r.object_key===k)).map(object_key=>({object_key})):records.filter(r=>r.choir_id===bound[0]&&r.piece_id===bound[1]&&r.expires_at!>String(bound[2])&&(bound.length<4||r.member_id===bound[3]))}},
    async run(){
      if(query.startsWith('INSERT INTO echo_diagnostic_cleanup'))queue.add(String(bound[0]));
      if(query.startsWith('DELETE FROM echo_diagnostic_cleanup'))queue.delete(String(bound[0]));
      if(query.startsWith('INSERT INTO echo_diagnostics(')){
        if(failCommit)throw Error('D1 unavailable');
        const old=records.findIndex(r=>r.member_id===bound[2]&&r.piece_id===bound[3]);if(old>=0){queue.add(String(records[old].object_key));records.splice(old,1)}
        const keys=['id','choir_id','member_id','piece_id','score_version_id','part_id','object_key','audio_size','duration_ms','consented_at','expires_at'];
        records.push(Object.fromEntries(keys.map((k,i)=>[k,bound[i]])) as Row);
      }
      if(query.startsWith('DELETE FROM echo_diagnostics'))for(let i=records.length-1;i>=0;i--){const r=records[i];
        if(query.includes('expires_at')?r.expires_at!<=String(bound[0]):r.id===bound[0]&&r.member_id===bound[1]&&r.choir_id===bound[2]){queue.add(String(r.object_key));records.splice(i,1)}}
      return {success:true};
    }};return s;}};
  const bucket={async put(key:string,body:ReadableStream){if(failPut)throw Error('R2 unavailable');objects.set(key,new Uint8Array(await new Response(body).arrayBuffer()));return {etag:'test'}},
    async get(key:string){const b=objects.get(key);return b?{body:new Blob([b as BlobPart]).stream(),size:b.length}:null},async delete(key:string){objects.delete(key)}};
  const env={AUTH_DB:db,PERFORMANCE_BUCKET:bucket,ASSETS:{fetch:async()=>Response.json({published:true,piece_id:'song',score_version_id:'score-v1',parts:[{id:'P3'}]})}} as unknown as Env;
  return {env,records,objects,queue,failPut:()=>{failPut=true},failCommit:()=>{failCommit=true}};
}
afterEach(()=>vi.unstubAllGlobals());
describe('echo diagnostic upload',()=>{
  it('validates arbitrary stream chunk boundaries and exact provenance',()=>{
    const b=fixture();for(const size of [1,17,43,44,97,b.length]){const p=new DiagnosticInspector(b.length,'song','score-v1','P3');for(let i=0;i<b.length;i+=size)p.consume(b.subarray(i,i+size));expect(p.finish().durationMs).toBe(0)}
    const wrong=new DiagnosticInspector(b.length,'other','score-v1','P3');wrong.consume(b);expect(()=>wrong.finish()).toThrow('invalid_diagnostic');
  });
  it('rejects missing consent, oversize, incompatible audio and corrupt metadata without committing',async()=>{
    const f=setup();expect((await handleEchoDiagnosticApi(request(fixture(),false),f.env,member))?.status).toBe(400);
    const big=request();big.headers.set('Content-Length',String(MAX_DIAGNOSTIC_BYTES+1));expect((await handleEchoDiagnosticApi(big,f.env,member))?.status).toBe(413);
    const invalid=fixture();invalid[20]=1;expect((await handleEchoDiagnosticApi(request(invalid),f.env,member))?.status).toBe(400);
    const corrupt=fixture();corrupt[116]=0;expect((await handleEchoDiagnosticApi(request(corrupt),f.env,member))?.status).toBe(400);
    expect(f.records).toHaveLength(0);expect(f.objects.size).toBe(0);
  });
  it('saves intact PCM, retries idempotently, replaces latest and enforces owner and same-choir director access',async()=>{
    const f=setup();const response=await handleEchoDiagnosticApi(request(),f.env,member);expect(response?.status).toBe(200);
    expect([...f.objects.values()][0]).toEqual(fixture());expect(f.records).toHaveLength(1);
    await handleEchoDiagnosticApi(request(),f.env,member);expect(f.objects.size).toBe(1);
    const path=endpoint+'/test-one';
    expect((await handleEchoDiagnosticApi(new Request(path),f.env,{...member,memberId:'other'}))?.status).toBe(404);
    expect((await handleEchoDiagnosticApi(new Request(path.replace('/api/','/api/cockpit/')),f.env,{...member,roles:['section_viewer']}))?.status).toBe(403);
    expect((await handleEchoDiagnosticApi(new Request(path.replace('/api/','/api/cockpit/')),f.env,director))?.status).toBe(200);
    expect((await handleEchoDiagnosticApi(new Request(path.replace('/api/','/api/cockpit/')),f.env,{...director,choirId:'other'}))?.status).toBe(404);
    expect((await handleEchoDiagnosticApi(new Request(endpoint+'?pieceId=song'),f.env,member))?.status).toBe(200);
    await handleEchoDiagnosticApi(request(fixture(),true,'test-two'),f.env,member);expect(f.records).toHaveLength(1);expect(f.records[0].id).toBe('test-two');
    await purgeExpiredEchoDiagnostics(f.env);expect(f.objects.size).toBe(1);
    expect((await handleEchoDiagnosticApi(new Request(endpoint+'/test-two',{method:'DELETE'}),f.env,member))?.status).toBe(204);expect(f.objects.size).toBe(0);
  });
  it('never confirms failed R2 or D1 writes and queues abandoned objects',async()=>{
    const f=setup();f.failPut();expect((await handleEchoDiagnosticApi(request(),f.env,member))?.status).toBe(503);expect(f.records).toHaveLength(0);
    const g=setup();g.failCommit();await expect(handleEchoDiagnosticApi(request(),g.env,member)).rejects.toThrow('D1 unavailable');expect(g.objects.size).toBe(0);expect(g.queue.size).toBe(1);
  });
  it('expires downloads after seven days and purges their objects',async()=>{
    const f=setup();await handleEchoDiagnosticApi(request(),f.env,member);f.records[0].expires_at='2020-01-01T00:00:00.000Z';
    expect((await handleEchoDiagnosticApi(new Request(endpoint+'/test-one'),f.env,member))?.status).toBe(404);
    await purgeExpiredEchoDiagnostics(f.env);expect(f.records).toHaveLength(0);expect(f.objects.size).toBe(0);
  });
});
