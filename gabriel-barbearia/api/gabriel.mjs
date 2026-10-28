import core from '../api.mjs';
import {Pool} from 'pg';
import {randomBytes,createHash} from 'node:crypto';
import {validate,phone,active} from '../validation.mjs';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,ssl:{rejectUnauthorized:true}});
const hash=v=>createHash('sha256').update(v).digest('hex');
const num=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
const normalizePrice=p=>({id:p.id,name:p.name??p.service,value:Number(p.value??p.price),duration:Number(p.duration)||60});
const nowSP=()=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
const publicRules=s=>({openTime:s.openTime||'08:00',closeTime:'24:00',slotStep:num(s.slotStep,30),depositPercent:num(s.depositPercent,50),cancelHours:num(s.cancelHours,4),lateTolerance:num(s.lateTolerance,10)});
const setCors=res=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, PUT, POST, OPTIONS');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff')};
async function stateRow(client=pool){const {rows}=await client.query('SELECT data,revision FROM gabriel_demo_state WHERE id=1');if(!rows[0])throw Error('Estado não encontrado.');return rows[0]}

async function publicAvailability(res){
  const {data}=await stateRow();
  const rules=publicRules(data.settings||{});
  return res.status(200).json({
    business:{name:data.settings.name,phone:phone(data.settings.phone),info:data.settings.info,pix:data.settings.pix},
    prices:data.prices.map(normalizePrice),
    busy:data.appointments.filter(active).map(a=>({date:a.date,time:a.time,duration:a.duration,status:a.status})),
    rules,timezone:'America/Sao_Paulo'
  });
}

async function publicBook(req,res){
  const d=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(typeof d.name!=='string'||!d.name.trim()||d.name.length>80||typeof d.phone!=='string'||d.phone.length>25||typeof d.service!=='string'||!d.service.trim()||d.service.length>80||typeof d.requestId!=='string'||!/^[a-zA-Z0-9-]{20,100}$/.test(d.requestId)||typeof (d.note??'')!=='string'||String(d.note??'').length>300)return res.status(400).json({error:'Preencha os dados corretamente.'});
  const tel=phone(d.phone);if(!tel)return res.status(400).json({error:'Informe um telefone válido com DDD.'});
  const n=nowSP(),today=n.year+'-'+n.month+'-'+n.day,nowTime=n.hour+':'+n.minute;const last=new Date(today+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+90);
  if(typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||d.date<today||d.date>last.toISOString().slice(0,10)||typeof d.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)||(d.date===today&&d.time<=nowTime))return res.status(400).json({error:'Escolha uma data e horário futuros, nos próximos 90 dias.'});
  const ip=req.headers['x-forwarded-for']?.toString().split(',')[0]||'unknown',rate=hash('booking:'+ip);
  const attempts=await pool.query(`INSERT INTO gabriel_login_limits(key,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN gabriel_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE gabriel_login_limits.attempts+1 END,window_start=CASE WHEN gabriel_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE gabriel_login_limits.window_start END RETURNING attempts`,[rate]);
  if(attempts.rows[0].attempts>30)return res.status(429).json({error:'Muitas tentativas. Aguarde alguns minutos.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');const row=await stateRow(client);let next=row.data;next.schema=2;
    const previous=next.appointments.find(a=>a.id===d.requestId);
    if(previous){await client.query('COMMIT');const rules=publicRules(next.settings||{});return res.status(200).json({ok:true,id:previous.id,date:previous.date,time:previous.time,value:previous.value,signal:(previous.value||0)*(rules.depositPercent/100),depositPercent:rules.depositPercent,business:{phone:phone(next.settings.phone),pix:next.settings.pix,name:next.settings.name}})}
    const priceRaw=next.prices.find(p=>String(p.name??p.service).trim().toLowerCase()===d.service.trim().toLowerCase());
    if(!priceRaw){await client.query('ROLLBACK');return res.status(409).json({error:'Esse serviço não está disponível para agendamento online.'})}
    const price=normalizePrice(priceRaw),rules=publicRules(next.settings||{}),start=Number(d.time.slice(0,2))*60+Number(d.time.slice(3)),open=Number(rules.openTime.slice(0,2))*60+Number(rules.openTime.slice(3)),close=1440;
    if(start<open||start+price.duration>close||start%Math.max(5,rules.slotStep)!==open%Math.max(5,rules.slotStep)){await client.query('ROLLBACK');return res.status(400).json({error:'Escolha um horário disponível dentro do funcionamento da barbearia.'})}
    let person=next.clients.find(c=>phone(c.phone)===tel);
    if(!person){person={id:randomBytes(16).toString('hex'),name:d.name.trim(),phone:tel,about:''};next.clients.push(person)}else if(d.name.trim()&&person.name!==d.name.trim()){person.name=d.name.trim()}
    const note=['Pré-agendado pelo cliente na página pública.',d.note?.trim()?('Observação do cliente: '+d.note.trim()):''].filter(Boolean).join(' ');
    next.appointments.push({id:d.requestId,client:person.id,date:d.date,time:d.time,duration:price.duration,service:price.name,value:price.value,status:'Agendado',signalPaid:false,note,createdAt:new Date().toISOString()});
    try{validate(next)}catch(e){await client.query('ROLLBACK');return res.status(409).json({error:e.message.includes('sobrepostos')?'Esse horário acabou de ser reservado. Escolha outro.':e.message})}
    const saved=await client.query('UPDATE gabriel_demo_state SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision',[JSON.stringify(next),row.revision]);
    if(!saved.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'A agenda acabou de mudar. Atualize os horários e tente novamente.'})}
    await client.query('COMMIT');return res.status(201).json({ok:true,id:d.requestId,date:d.date,time:d.time,value:price.value,signal:price.value*(rules.depositPercent/100),depositPercent:rules.depositPercent,business:{phone:phone(next.settings.phone),pix:next.settings.pix,name:next.settings.name}});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

export default async function handler(req,res){
  try{
    const incoming=new URL(req.url,'https://gabriel.local');
    const target=incoming.searchParams.get('path')||'/health';
    if(!target.startsWith('/')||target.includes('://')) return res.status(400).json({error:'Caminho inválido.'});
    if(target==='/public/availability'&&req.method==='GET'){setCors(res);return await publicAvailability(res)}
    if(target==='/public/book'&&req.method==='POST'){setCors(res);return await publicBook(req,res)}
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers||{})){
      if(Array.isArray(value)) value.forEach(v=>headers.append(key,v));
      else if(value!==undefined) headers.set(key,String(value));
    }
    let requestBody;
    if(!['GET','HEAD','OPTIONS'].includes(req.method||'GET')){
      if(typeof req.body==='string'||Buffer.isBuffer(req.body)) requestBody=req.body;
      else if(req.body!==undefined) requestBody=JSON.stringify(req.body);
    }
    const request=new Request('https://gabriel.local'+target,{method:req.method||'GET',headers,body:requestBody});
    const response=await core.fetch(request);
    res.status(response.status);
    response.headers.forEach((value,key)=>{if(!['content-length','transfer-encoding','connection'].includes(key.toLowerCase())) res.setHeader(key,value)});
    const payload=Buffer.from(await response.arrayBuffer());
    res.send(payload);
  }catch(error){
    console.error('gabriel-vercel-wrapper',error);
    setCors(res);res.status(500).json({error:'Não foi possível concluir. Tente novamente.'});
  }
}
