import { validRepertoireContext } from './performances';
import type { Env, MemberContext } from './types';

export const MAX_DIAGNOSTIC_BYTES = 100_000_000;
const MAX_METADATA_BYTES = 7_000_000;
const CHANNELS = ['microphone-raw', 'app-reference', 'microphone-processed', 'echo-prediction-unscaled'];
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const validId = (value: string | null): value is string => Boolean(value && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value));
interface Row {
  id: string; member_id: string; choir_id: string; piece_id: string; score_version_id: string;
  part_id: string; object_key: string; audio_size: number; duration_ms: number; consented_at: string; expires_at: string;
}
const summary = (r: Row) => ({ id: r.id, pieceId: r.piece_id, partId: r.part_id, createdAt: r.consented_at,
  expiresAt: r.expires_at, durationMs: r.duration_ms, audioSize: r.audio_size });

// Inspect only the small header and bounded provenance tail; never buffer the PCM in a Worker.
export class DiagnosticInspector {
  private header = new Uint8Array(44);
  private tail: Uint8Array | null = null;
  private total = 0;
  private tailOffset = 0;
  private rate = 0;
  private frames = 0;
  constructor(private length: number, private pieceId: string, private scoreVersion: string, private partId: string) {}
  consume(chunk: Uint8Array) {
    const from = this.total, end = from + chunk.length;
    if (end > this.length) throw Error('invalid_diagnostic');
    if (from < 44) this.header.set(chunk.subarray(0, Math.min(chunk.length, 44-from)), from);
    if (!this.tail && end >= 44) {
      const v = new DataView(this.header.buffer), tag = (a: number, b: number) => new TextDecoder().decode(this.header.subarray(a, b));
      this.rate = v.getUint32(24, true); const pcm = v.getUint32(40, true); this.frames = pcm / 16;
      this.tailOffset = 44 + pcm;
      const tailSize = this.length-this.tailOffset;
      if (tag(0,4) !== 'RIFF' || tag(8,16) !== 'WAVEfmt ' || tag(36,40) !== 'data'
        || v.getUint32(4,true) !== this.length-8 || v.getUint32(16,true) !== 16
        || v.getUint16(20,true) !== 3 || v.getUint16(22,true) !== 4 || v.getUint16(34,true) !== 32
        || v.getUint16(32,true) !== 16 || v.getUint32(28,true) !== this.rate*16
        || this.rate < 8000 || this.rate > 96000 || !Number.isInteger(this.frames)
        || this.frames < 1 || this.frames > this.rate*60 || tailSize < 8 || tailSize > MAX_METADATA_BYTES) throw Error('invalid_diagnostic');
      this.tail = new Uint8Array(tailSize);
    }
    if (this.tail && end > this.tailOffset) {
      const start = Math.max(from, this.tailOffset);
      this.tail.set(chunk.subarray(start-from), start-this.tailOffset);
    }
    this.total = end;
  }
  finish() {
    if (this.total !== this.length || !this.tail) throw Error('invalid_diagnostic');
    const v = new DataView(this.tail.buffer), count = v.getUint32(4,true);
    if (new TextDecoder().decode(this.tail.subarray(0,4)) !== 'chAI' || count+8+(count%2) !== this.tail.length) throw Error('invalid_diagnostic');
    let m;
    try { m=JSON.parse(new TextDecoder().decode(this.tail.subarray(8,8+count))); }
    catch(_) { throw Error('invalid_diagnostic'); }
    if (!m || typeof m !== 'object' || m.schemaVersion !== 1 || m.pieceId !== this.pieceId || m.scoreVersion !== this.scoreVersion || m.partId !== this.partId
      || m.frames !== this.frames || m.sampleRate !== this.rate || m.format !== 'float32le'
      || JSON.stringify(m.channelNames) !== JSON.stringify(CHANNELS)
      || !Array.isArray(m.pitchFrames) || m.pitchFrames.length > 7200 || !m.echo || !m.mixer) throw Error('invalid_diagnostic');
    return { durationMs: Math.round(this.frames/this.rate*1000) };
  }
}

async function save(request: Request, env: Env, member: MemberContext) {
  const q = new URL(request.url).searchParams;
  const id=q.get('id'), piece=q.get('pieceId'), score=q.get('scoreVersionId'), part=q.get('partId');
  const length=Number(request.headers.get('Content-Length'));
  if (request.headers.get('X-Diagnostic-Consent') !== 'capture-store-share-v1') return json({ error:'consent_required' },400);
  if (!validId(id) || !validId(piece) || !validId(score) || !validId(part)
    || request.headers.get('Content-Type') !== 'audio/wav' || !request.body) return json({ error:'invalid_diagnostic' },400);
  if (!Number.isSafeInteger(length) || length < 52 || length > MAX_DIAGNOSTIC_BYTES) return json({ error:'diagnostic_too_large' },413);
  if (!await validRepertoireContext(env,piece,score,part)) return json({ error:'invalid_repertoire' },400);
  const existing=await env.AUTH_DB.prepare('SELECT * FROM echo_diagnostics WHERE id=?1 AND member_id=?2 AND choir_id=?3 AND expires_at>?4')
    .bind(id,member.memberId,member.choirId,new Date().toISOString()).first<Row>();
  if (existing) return existing.piece_id===piece ? json({ diagnostic:summary(existing) }) : json({ error:'invalid_diagnostic' },409);
  const bucket=env.PERFORMANCE_BUCKET!;
  // A server-generated object suffix isolates simultaneous retries of the same client request.
  const key=`echo-diagnostics/${member.choirId}/${member.memberId}/${piece}/${crypto.randomUUID()}.wav`;
  await env.AUTH_DB.prepare('INSERT INTO echo_diagnostic_cleanup(object_key,delete_after) VALUES(?1,?2)')
    .bind(key,new Date(Date.now()+86400000).toISOString()).run();
  const inspector=new DiagnosticInspector(length,piece,score,part), fixed=new FixedLengthStream(length);
  const reader=request.body!.getReader(), writer=fixed.writable.getWriter();
  const upload=bucket.put(key,fixed.readable,{ httpMetadata:{ contentType:'audio/wav' } }).catch(async error=>{
    await writer.abort(error).catch(()=>undefined);await reader.cancel().catch(()=>undefined);throw error;
  });
  const copy=(async()=>{
    try {
      while(true) { const {done,value}=await reader.read(); if(done)break; inspector.consume(value); await writer.write(value); }
      const result=inspector.finish(); await writer.close(); return result;
    } catch(error) { await writer.abort(error).catch(()=>undefined); await reader.cancel().catch(()=>undefined); throw error; }
  })();
  const results=await Promise.allSettled([upload,copy]);
  if (results[0].status==='rejected' || results[1].status==='rejected') {
    await bucket.delete(key).catch(()=>undefined);
    const invalid=results[1].status==='rejected' && /invalid_diagnostic|JSON/.test(String(results[1].reason));
    return json({ error:invalid?'invalid_diagnostic':'diagnostic_upload_failed' },invalid?400:503);
  }
  const now=new Date().toISOString(), expires=new Date(Date.now()+7*86400000).toISOString();
  try {
    await env.AUTH_DB.prepare(`INSERT INTO echo_diagnostics(id,choir_id,member_id,piece_id,score_version_id,part_id,object_key,audio_size,duration_ms,consented_at,expires_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
      ON CONFLICT(member_id,piece_id) DO UPDATE SET id=excluded.id,choir_id=excluded.choir_id,
      score_version_id=excluded.score_version_id,part_id=excluded.part_id,object_key=excluded.object_key,
      audio_size=excluded.audio_size,duration_ms=excluded.duration_ms,consented_at=excluded.consented_at,expires_at=excluded.expires_at`)
      .bind(id,member.choirId,member.memberId,piece,score,part,key,length,results[1].value.durationMs,now,expires).run();
  } catch(error) { await bucket.delete(key).catch(()=>undefined); throw error; }
  await env.AUTH_DB.prepare('DELETE FROM echo_diagnostic_cleanup WHERE object_key=?1').bind(key).run().catch(()=>undefined);
  return json({ diagnostic:summary({ id,member_id:member.memberId,choir_id:member.choirId,piece_id:piece,score_version_id:score,
    part_id:part,object_key:key,audio_size:length,duration_ms:results[1].value.durationMs,consented_at:now,expires_at:expires }) });
}

export async function handleEchoDiagnosticApi(request: Request, env: Env, member: MemberContext): Promise<Response|null> {
  const url=new URL(request.url), director=url.pathname.startsWith('/api/cockpit/echo-diagnostics');
  const base=director?'/api/cockpit/echo-diagnostics':'/api/echo-diagnostics';
  if (url.pathname!==base && !url.pathname.startsWith(base+'/')) return null;
  if (director && !member.roles.includes('director')) return json({ error:'forbidden' },403);
  if (!env.PERFORMANCE_BUCKET) return json({ error:'diagnostic_unavailable' },503);
  if (!director && url.pathname===base && request.method==='POST') return save(request,env,member);
  const id=url.pathname.slice(base.length+1), now=new Date().toISOString();
  if (url.pathname===base && request.method==='GET') {
    const piece=url.searchParams.get('pieceId'); if(!validId(piece))return json({error:'invalid_piece'},400);
    const result=await env.AUTH_DB.prepare(`SELECT d.* FROM echo_diagnostics d JOIN authorized_members m ON m.member_id=d.member_id AND m.choir_id=d.choir_id
      WHERE d.choir_id=?1 AND d.piece_id=?2 AND d.expires_at>?3 AND m.active=1 ${director?'':'AND d.member_id=?4'} ORDER BY d.consented_at DESC`)
      .bind(...(director?[member.choirId,piece,now]:[member.choirId,piece,now,member.memberId])).all<Row>();
    return json({ diagnostics:(result.results??[]).map(r=>({...summary(r),...(director?{memberId:r.member_id}:{}),
      audioUrl:`${base}/${encodeURIComponent(r.id)}`})) });
  }
  if (!validId(id)) return json({error:'not_found'},404);
  const row=await env.AUTH_DB.prepare(`SELECT d.* FROM echo_diagnostics d JOIN authorized_members m ON m.member_id=d.member_id AND m.choir_id=d.choir_id
    WHERE d.id=?1 AND d.choir_id=?2 AND d.expires_at>?3 AND m.active=1 ${director?'':'AND d.member_id=?4'}`)
    .bind(...(director?[id,member.choirId,now]:[id,member.choirId,now,member.memberId])).first<Row>();
  if(!row)return json({error:'not_found'},404);
  if(request.method==='GET') {
    const object=await env.PERFORMANCE_BUCKET.get(row.object_key);
    if(!object)return json({error:'not_found'},404);
    return new Response(object.body,{headers:{'Content-Type':'audio/wav','Content-Length':String(object.size),
      'Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="test-rientro.wav"'}});
  }
  if(!director && request.method==='DELETE') {
    await env.AUTH_DB.prepare('DELETE FROM echo_diagnostics WHERE id=?1 AND member_id=?2 AND choir_id=?3').bind(id,member.memberId,member.choirId).run();
    await env.PERFORMANCE_BUCKET.delete(row.object_key).catch(()=>undefined);
    return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  }
  return json({error:'method_not_allowed'},405);
}

export async function purgeExpiredEchoDiagnostics(env: Env) {
  if(!env.PERFORMANCE_BUCKET)return;
  await env.AUTH_DB.prepare('DELETE FROM echo_diagnostics WHERE expires_at<=?1').bind(new Date().toISOString()).run();
  const result=await env.AUTH_DB.prepare(`SELECT c.object_key FROM echo_diagnostic_cleanup c
    WHERE julianday(c.delete_after)<=julianday(?1) AND NOT EXISTS(SELECT 1 FROM echo_diagnostics d WHERE d.object_key=c.object_key) LIMIT 50`)
    .bind(new Date().toISOString()).all<{object_key:string}>();
  for(const row of result.results??[]) {
    await env.PERFORMANCE_BUCKET.delete(row.object_key);
    await env.AUTH_DB.prepare('DELETE FROM echo_diagnostic_cleanup WHERE object_key=?1').bind(row.object_key).run();
  }
}
