const MAX_RECORDS=5000;
const digits=s=>String(s??'').replace(/\D/g,'');
function phone(s){let p=digits(s);if((p.length===12||p.length===13)&&p.startsWith('55'))p=p.slice(2);return /^[1-9]{2}[0-9]{8,9}$/.test(p)?p:null}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number(s.slice(0,4))>=2000&&Number(s.slice(0,4))<=2100&&!Number.isNaN(new Date(s+'T12:00:00').getTime())}
function validTime(s){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s||''))}
const active=a=>!['Cancelado','Faltou'].includes(a.status);
function conflict(a,items){
  if(!active(a))return false;
  const aStart=Number(a.time.slice(0,2))*60+Number(a.time.slice(3)),aEnd=aStart+a.duration;
  return items.some(b=>{
    if(b.id===a.id||!active(b)||b.date!==a.date)return false;
    const bStart=Number(b.time.slice(0,2))*60+Number(b.time.slice(3)),bEnd=bStart+b.duration;
    return aStart<bEnd&&bStart<aEnd;
  });
}
const defaults=()=>({
  schema:2,
  clients:[],
  appointments:[],
  prices:[],
  settings:{
    name:'Gabriel Barbeiro',phone:'19996281210',pix:'',info:'',
    openTime:'08:00',closeTime:'20:00',slotStep:30,depositPercent:50,cancelHours:4,lateTolerance:10,
    auth:null
  }
});
function validate(x){
  if(!x||![1,2].includes(x.schema)||!x.settings)throw Error('Estrutura de dados inválida.');
  const s=x.settings;
  if(typeof s.name!=='string'||!s.name.trim()||s.name.length>80||!phone(s.phone)||typeof s.pix!=='string'||s.pix.length>180||typeof s.info!=='string'||s.info.length>500)throw Error('Dados da barbearia inválidos.');
  if(s.openTime!==undefined&&!validTime(s.openTime))throw Error('Horário de abertura inválido.');
  if(s.closeTime!==undefined&&!validTime(s.closeTime))throw Error('Horário de fechamento inválido.');
  if(s.slotStep!==undefined&&(!Number.isInteger(s.slotStep)||s.slotStep<5||s.slotStep>120))throw Error('Intervalo da agenda inválido.');
  if(s.depositPercent!==undefined&&(!Number.isFinite(s.depositPercent)||s.depositPercent<1||s.depositPercent>100))throw Error('Percentual do sinal inválido.');
  if(s.cancelHours!==undefined&&(!Number.isFinite(s.cancelHours)||s.cancelHours<0||s.cancelHours>168))throw Error('Regra de cancelamento inválida.');
  if(s.lateTolerance!==undefined&&(!Number.isFinite(s.lateTolerance)||s.lateTolerance<0||s.lateTolerance>120))throw Error('Tolerância de atraso inválida.');
  if(s.auth!==undefined&&s.auth!==null){
    if(typeof s.auth!=='object'||typeof s.auth.username!=='string'||s.auth.username.length<3||s.auth.username.length>60||typeof s.auth.passwordHash!=='string'||s.auth.passwordHash.length>300||typeof s.auth.mustChange!=='boolean')throw Error('Configuração de acesso inválida.');
  }
  for(const k of ['clients','appointments','prices'])if(!Array.isArray(x[k])||x[k].length>MAX_RECORDS||new Set(x[k].map(a=>a.id)).size!==x[k].length||x[k].some(a=>typeof a.id!=='string'||!a.id||a.id.length>100))throw Error('Dados inválidos ou acima do limite de segurança.');
  for(const c of x.clients)if(typeof c.name!=='string'||!c.name.trim()||c.name.length>80||!phone(c.phone)||typeof (c.about??'')!=='string'||String(c.about??'').length>500)throw Error('Cliente inválido.');
  if(new Set(x.clients.map(c=>phone(c.phone))).size!==x.clients.length)throw Error('Telefones de clientes duplicados.');
  for(const p of x.prices){
    if(typeof (p.name??p.service)!=='string'||!(p.name??p.service).trim()||(p.name??p.service).length>80||typeof (p.value??p.price)!=='number'||!Number.isFinite(p.value??p.price)||(p.value??p.price)<0||(p.value??p.price)>99999)throw Error('Tabela de valores inválida.');
    if(p.duration!==undefined&&(!Number.isInteger(p.duration)||p.duration<5||p.duration>240))throw Error('Duração de serviço inválida.');
  }
  for(const a of x.appointments){
    if(!x.clients.some(c=>c.id===a.client)||!validDate(a.date)||!validTime(a.time)||!Number.isInteger(a.duration)||a.duration<5||a.duration>240||Number(a.time.slice(0,2))*60+Number(a.time.slice(3))+a.duration>1440||!['Agendado','Confirmado','Concluído','Cancelado','Faltou'].includes(a.status)||typeof a.service!=='string'||!a.service.trim()||a.service.length>80||typeof (a.note??'')!=='string'||String(a.note??'').length>500||(a.value!==null&&a.value!==undefined&&(typeof a.value!=='number'||!Number.isFinite(a.value)||a.value<0||a.value>99999))||(a.signalPaid!==undefined&&typeof a.signalPaid!=='boolean'))throw Error('Agendamento inválido.');
    if(conflict(a,x.appointments))throw Error('Existem horários sobrepostos para Gabriel.');
  }
  x.schema=2;
  return x;
}
export {validate,defaults,phone,active};
