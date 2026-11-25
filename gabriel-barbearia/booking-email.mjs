import nodemailer from 'nodemailer';
import {createHash} from 'node:crypto';

const emailPattern=/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const singleLine=value=>String(value??'').replace(/[\r\n]+/g,' ').trim();

export function emailConfiguration(env=process.env){
  const from=String(env.GMAIL_USER||'').trim();
  const to=String(env.BOOKING_NOTIFICATION_EMAIL||'').trim();
  const pass=String(env.GMAIL_APP_PASSWORD||'').replace(/\s/g,'');
  const ready=emailPattern.test(from)&&/@gmail\.com$/i.test(from)&&emailPattern.test(to)&&/^[a-zA-Z0-9]{16}$/.test(pass);
  return {ready,from,to,pass};
}

export function bookingEmail({appointment,client,businessName},config,env=process.env){
  const [year,month,day]=String(appointment.date).split('-');
  const date=`${day}/${month}/${year}`;
  const name=singleLine(client.name),service=singleLine(appointment.service);
  let panel='https://gabriel-barbearia.vercel.app/admin.html';
  try{const url=new URL(env.BOOKING_APP_URL||'https://gabriel-barbearia.vercel.app');if(url.protocol==='https:')panel=new URL('/admin.html',url).href}catch{}
  const reference=createHash('sha256').update(String(appointment.id)).digest('hex');
  return {
    from:{name:'Florindo Sistemas',address:config.from},
    to:config.to,
    subject:`Novo agendamento - ${name} - ${date} às ${singleLine(appointment.time)}`,
    messageId:`<agendamento-${reference}@gmail.com>`,
    text:[
      `Novo agendamento em ${singleLine(businessName)||'Gabriel Cortes'}`,'',
      `Cliente: ${name}`,`Telefone: ${singleLine(client.phone)}`,`Serviço: ${service}`,
      `Data: ${date}`,`Horário: ${singleLine(appointment.time)}`,
      `Situação: ${singleLine(appointment.status)}`,
      `Pagamento: ${appointment.paymentChoice==='onsite'?'No atendimento':'Sinal pendente de conferência'}`,
      appointment.note?`Observações: ${String(appointment.note).trim()}`:'','',
      `Consultar agenda: ${panel}`,'',
      'Aviso automático do sistema. Consulte a agenda para conferir alterações posteriores.'
    ].filter(value=>value!==null).join('\n')
  };
}

// Awaited only after COMMIT. SMTP errors must never turn a saved reservation into an error.
export function createBookingNotifier({env=process.env,createTransport=nodemailer.createTransport,logger=console,timeoutMs=8000,messageBuilder=bookingEmail}={}){
  return async function notifyBooking(booking){
    const config=emailConfiguration(env);
    if(!config.ready)return {status:'not_configured'};
    let transport,timer;
    try{
      transport=createTransport({
        service:'gmail',auth:{user:config.from,pass:config.pass},
        connectionTimeout:4000,greetingTimeout:4000,socketTimeout:6000,
        tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}
      });
      const result=await Promise.race([
        transport.sendMail(messageBuilder(booking,config,env)),
        new Promise((_,reject)=>{timer=setTimeout(()=>{const e=Error('SMTP timeout');e.code='ETIMEDOUT';reject(e)},timeoutMs)})
      ]);
      if(!result.accepted?.some(address=>String(address).toLowerCase()===config.to.toLowerCase()))throw Object.assign(Error('Recipient rejected'),{code:'ERECIPIENT'});
      return {status:'sent'};
    }catch(error){
      // Never log SMTP responses, credentials, message content, or client details.
      const code=String(error?.code||'SMTP_ERROR');
      logger.error('gabriel-booking-email',/^[A-Z0-9_]{1,40}$/.test(code)?code:'SMTP_ERROR');
      return {status:'failed'};
    }finally{
      if(timer)clearTimeout(timer);
      try{transport?.close()}catch{}
    }
  };
}

export const notifyBooking=createBookingNotifier();

export function validCustomerEmail(value){
  return typeof value==='string' && value.length<=254 && value===value.trim() && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value) && !value.includes('..');
}
export function customerBookingEmail({appointment,client,businessName},config){
  const [year,month,day]=String(appointment.date).split('-');
  const pending=appointment.paymentChoice!=='onsite';
  const reference=createHash('sha256').update(String(appointment.id)).digest('hex');
  return {from:{name:singleLine(businessName)||'Gabriel Cortes',address:config.from},to:config.to,
    subject:pending?'Pré-agendamento recebido - Gabriel Cortes':'Agendamento realizado - Gabriel Cortes',
    messageId:`<cliente-${reference}@gmail.com>`,
    text:[`Olá, ${singleLine(client.name)}!`,'',
      pending?'Recebemos seu pré-agendamento. Ele ainda depende da conferência do sinal pela barbearia.':'Seu horário foi agendado. O pagamento será feito no atendimento.',
      `Serviço: ${singleLine(appointment.service)}`,`Data: ${day}/${month}/${year}`,`Horário: ${singleLine(appointment.time)}`,
      '','Para dúvidas ou alterações, entre em contato com a barbearia.'].join('\n')};
}
export async function notifyCustomer(booking,email){
  if(!email)return {status:'not_requested'};
  if(!validCustomerEmail(email))return {status:'invalid'};
  const env={...process.env,BOOKING_NOTIFICATION_EMAIL:email};
  return createBookingNotifier({env,messageBuilder:customerBookingEmail})(booking);
}
