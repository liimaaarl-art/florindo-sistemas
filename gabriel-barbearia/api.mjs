import {Pool} from 'pg';
import {attachDatabasePool} from '@neon/functions';
import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {validate,phone,active} from './validation.mjs';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:{rejectUnauthorized:true}});
attachDatabasePool(pool);
const hash=v=>createHash('sha256').update(v).digest('hex');
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization',
  'Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
};
const response=(body,status=200)=>Response.json(body,{status,headers:cors});
const safePassword=(p,encoded)=>{try{const [salt,key]=String(encoded||'').split(':');const wanted=Buffer.from(key,'hex'),actual=scryptSync(String(p),salt,32);return wanted.length===actual.length&&timingSafeEqual(wanted,actual)}catch{return false}};
const passwordHash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,32).toString('hex')};
async function body(req){const text=await req.text();if(text.length>100000)throw Error('Arquivo muito grande.');return JSON.parse(text)}
const nowSP=()=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
const num=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
const cfg=s=>({
  openTime:s.openTime||'08:00',closeTime:s.closeTime||'20:00',slotStep:num(s.slotStep,30),
  depositPercent:num(s.depositPercent,50),cancelHours:num(s.cancelHours,4),lateTolerance:num(s.lateTolerance,10)
});
const normalizePrice=p=>({id:p.id,name:p.name??p.service,value:Number(p.value??p.price),duration:Number(p.duration)||60});
async function stateRow(client=pool){const {rows}=await client.query('SELECT data,revision FROM gabriel_demo_state WHERE id=1');if(!rows[0])throw Error('Estado não encontrado.');return rows[0]}
function publicState(d){const c=cfg(d.settings);return {
  business:{name:d.settings.name,phone:phone(d.settings.phone),info:d.settings.info,pix:d.settings.pix},
  prices:d.prices.map(normalizePrice),
  busy:d.appointments.filter(active).map(a=>({date:a.date,time:a.time,duration:a.duration,status:a.status})),
  rules:c,timezone:'America/Sao_Paulo'
}}
function sanitizedAdminState(d){return {...d,settings:{...d.settings,auth:d.settings.auth?{username:d.settings.auth.username,mustChange:!!d.settings.auth.mustChange}:null}}}

export default {async fetch(req){
  const path=new URL(req.url).pathname.replace(/\/+$/,'')||'/';
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(path==='/health')return response({ok:true,app:'gabriel-barbearia',version:'5.0',mode:'production'});
  try{
    if(path==='/auth/status'&&req.method==='GET'){
      const {data}=await stateRow();const a=data.settings?.auth;
      return response({setup:!!a,username:a?.username||null,mustChange:!!a?.mustChange});
    }
    if(path==='/public/availability'&&req.method==='GET'){
      const {data}=await stateRow();return response(publicState(data));
    }
    if(path==='/public/book'&&req.method==='POST'){
      const d=await body(req);
      if(typeof d.name!=='string'||!d.name.trim()||d.name.length>80||typeof d.phone!=='string'||d.phone.length>25||typeof d.service!=='string'||!d.service.trim()||d.service.length>80||typeof d.requestId!=='string'||!/^[a-zA-Z0-9-]{20,100}$/.test(d.requestId)||typeof (d.note??'')!=='string'||String(d.note??'').length>300)return response({error:'Preencha os dados corretamente.'},400);
      const tel=phone(d.phone);if(!tel)return response({error:'Informe um telefone válido com DDD.'},400);
      const n=nowSP(),today=n.year+'-'+n.month+'-'+n.day,nowTime=n.hour+':'+n.minute;const last=new Date(today+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+90);
      if(typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||d.date<today||d.date>last.toISOString().slice(0,10)||typeof d.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)||(d.date===today&&d.time<=nowTime))return response({error:'Escolha uma data e horário futuros, nos próximos 90 dias.'},400);
      const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown',rate=hash('booking:'+ip);
      const attempts=await pool.query(`INSERT INTO gabriel_login_limits(key,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN gabriel_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE gabriel_login_limits.attempts+1 END,window_start=CASE WHEN gabriel_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE gabriel_login_limits.window_start END RETURNING attempts`,[rate]);
      if(attempts.rows[0].attempts>30)return response({error:'Muitas tentativas. Aguarde alguns minutos.'},429);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');const row=await stateRow(client);let next=row.data;next.schema=2;
        const previous=next.appointments.find(a=>a.id===d.requestId);if(previous){await client.query('COMMIT');return response({ok:true,id:previous.id,date:previous.date,time:previous.time,value:previous.value,signal:(previous.value||0)*(cfg(next.settings).depositPercent/100),depositPercent:cfg(next.settings).depositPercent,business:{phone:phone(next.settings.phone),pix:next.settings.pix,name:next.settings.name}})}
        const priceRaw=next.prices.find(p=>String(p.name??p.service).trim().toLowerCase()===d.service.trim().toLowerCase());if(!priceRaw){await client.query('ROLLBACK');return response({error:'Esse serviço não está disponível para agendamento online.'},409)}
        const price=normalizePrice(priceRaw),c=cfg(next.settings),start=Number(d.time.slice(0,2))*60+Number(d.time.slice(3)),open=Number(c.openTime.slice(0,2))*60+Number(c.openTime.slice(3)),close=Number(c.closeTime.slice(0,2))*60+Number(c.closeTime.slice(3));
        if(start<open||start+price.duration>close||start%Math.max(5,c.slotStep)!==open%Math.max(5,c.slotStep)){await client.query('ROLLBACK');return response({error:'Escolha um horário disponível dentro do funcionamento da barbearia.'},400)}
        let person=next.clients.find(c=>phone(c.phone)===tel);if(!person){person={id:randomBytes(16).toString('hex'),name:d.name.trim(),phone:tel,about:''};next.clients.push(person)}else if(d.name.trim()&&person.name!==d.name.trim()){person.name=d.name.trim()}
        const note=['Pré-agendado pelo cliente na página pública.',d.note?.trim()?('Observação do cliente: '+d.note.trim()):''].filter(Boolean).join(' ');
        next.appointments.push({id:d.requestId,client:person.id,date:d.date,time:d.time,duration:price.duration,service:price.name,value:price.value,status:'Agendado',signalPaid:false,note,createdAt:new Date().toISOString()});
        try{validate(next)}catch(e){await client.query('ROLLBACK');return response({error:e.message.includes('sobrepostos')?'Esse horário acabou de ser reservado. Escolha outro.':e.message},409)}
        const saved=await client.query('UPDATE gabriel_demo_state SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision',[JSON.stringify(next),row.revision]);if(!saved.rowCount){await client.query('ROLLBACK');return response({error:'A agenda acabou de mudar. Atualize os horários e tente novamente.'},409)}
        await client.query('COMMIT');return response({ok:true,id:d.requestId,date:d.date,time:d.time,value:price.value,signal:price.value*(c.depositPercent/100),depositPercent:c.depositPercent,business:{phone:phone(next.settings.phone),pix:next.settings.pix,name:next.settings.name}},201);
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }

    if(path==='/login'&&req.method==='POST'){
      const data=await body(req),name=String(data.username||'').trim().toLowerCase(),password=String(data.password||'');if(password.length<1||password.length>200||name.length>60)return response({error:'Credenciais inválidas.'},401);
      const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown',rate=hash('login:'+ip+':'+name);const attempts=await pool.query(`INSERT INTO gabriel_login_limits(key,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN gabriel_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE gabriel_login_limits.attempts+1 END,window_start=CASE WHEN gabriel_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE gabriel_login_limits.window_start END RETURNING attempts`,[rate]);if(attempts.rows[0].attempts>20)return response({error:'Muitas tentativas. Aguarde 15 minutos.'},429);
      const {data:current}=await stateRow();const custom=current.settings?.auth;let role=null,mustChange=false;
      if(custom){if(name===String(custom.username).toLowerCase()&&safePassword(password,custom.passwordHash)){role='admin';mustChange=!!custom.mustChange}}
      else{
        const legacyRole=name==='gabriel'?'agenda':name==='florindo'?'admin':null,encoded=legacyRole==='agenda'?process.env.AGENDA_PASSWORD_HASH:process.env.ADMIN_PASSWORD_HASH;
        if(legacyRole&&safePassword(password,encoded||''))role=legacyRole;
      }
      if(!role)return response({error:'Usuário ou senha incorretos.'},401);
      const token=randomBytes(32).toString('base64url');await pool.query(`INSERT INTO gabriel_sessions(token_hash,role,expires_at) VALUES($1,$2,now()+interval '12 hours')`,[hash(token),role]);return response({token,role,mustChange,expiresAt:Date.now()+12*3600000});
    }

    const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token||token.length>180)return response({error:'Entre para acessar o painel.'},401);
    const tokenHash=hash(token),sessions=await pool.query('SELECT role FROM gabriel_sessions WHERE token_hash=$1 AND expires_at>now()',[tokenHash]),role=sessions.rows[0]?.role;if(!role)return response({error:'Sessão encerrada. Entre novamente.'},401);
    if(path==='/logout'&&req.method==='POST'){await pool.query('DELETE FROM gabriel_sessions WHERE token_hash=$1',[tokenHash]);return response({ok:true})}
    if(path==='/change-credentials'&&req.method==='POST'){
      if(role!=='admin')return response({error:'Acesso restrito.'},403);const d=await body(req),username=String(d.username||'').trim(),password=String(d.password||'');if(!/^[A-Za-z0-9._-]{3,40}$/.test(username)||password.length<8||password.length>100)return response({error:'Use um usuário com 3 a 40 caracteres e senha com pelo menos 8 caracteres.'},400);
      const client=await pool.connect();try{await client.query('BEGIN');const row=await stateRow(client),next=row.data;next.schema=2;next.settings.auth={username,passwordHash:passwordHash(password),mustChange:false};validate(next);await client.query('UPDATE gabriel_demo_state SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1',[JSON.stringify(next)]);await client.query('DELETE FROM gabriel_sessions WHERE token_hash<>$1',[tokenHash]);await client.query('COMMIT');return response({ok:true,username})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }
    if(!['/state','/agenda'].includes(path))return response({error:'Página não encontrada.'},404);
    if(path==='/state'&&role!=='admin')return response({error:'Acesso restrito ao administrador.'},403);
    const row=await stateRow();
    if(req.method==='GET'){
      const data=path==='/agenda'?{schema:2,clients:row.data.clients,appointments:row.data.appointments,settings:{name:row.data.settings.name,phone:row.data.settings.phone,info:row.data.settings.info,openTime:row.data.settings.openTime,closeTime:row.data.settings.closeTime,depositPercent:row.data.settings.depositPercent,cancelHours:row.data.settings.cancelHours,lateTolerance:row.data.settings.lateTolerance}}:sanitizedAdminState(row.data);
      return response({state:data,revision:row.revision,role});
    }
    if(req.method==='PUT'){
      const d=await body(req);if(!Number.isInteger(d.revision))return response({error:'Versão dos dados inválida.'},400);let next;
      if(path==='/agenda')next={...row.data,clients:d.state?.clients,appointments:d.state?.appointments};else{next=d.state;next.settings={...next.settings,auth:row.data.settings?.auth||null}}
      try{validate(next)}catch(e){return response({error:e.message},400)}
      const saved=await pool.query('UPDATE gabriel_demo_state SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision',[JSON.stringify(next),d.revision]);if(!saved.rowCount)return response({error:'A agenda mudou em outro aparelho. Atualize e tente novamente.'},409);return response({ok:true,revision:saved.rows[0].revision});
    }
    return response({error:'Operação não disponível.'},405);
  }catch(e){console.error('gabriel-api',e.code||e.name,e.message);return response({error:'Não foi possível concluir. Tente novamente.'},500)}
}};
