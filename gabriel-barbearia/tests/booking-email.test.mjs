import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingEmail,emailConfiguration,createBookingNotifier} from '../booking-email.mjs';

const env={GMAIL_USER:'sender@gmail.com',BOOKING_NOTIFICATION_EMAIL:'owner@gmail.com',GMAIL_APP_PASSWORD:'aaaa bbbb cccc dddd'};
const booking={appointment:{id:'booking-123',date:'2026-12-01',time:'14:30',service:'Corte',status:'Agendado',paymentChoice:'deposit',note:'Pré-agendado pelo cliente.'},client:{name:'João',phone:'19999999999'},businessName:'Gabriel Cortes'};

test('sem senha não conecta nem envia mensagens',async()=>{
 let calls=0;
 const notify=createBookingNotifier({env:{...env,GMAIL_APP_PASSWORD:''},createTransport(){calls++}});
 assert.deepEqual(await notify(booking),{status:'not_configured'});assert.equal(calls,0);
});
test('configuração aceita a senha de aplicativo com espaços e rejeita destinatário malformado',()=>{
 assert.equal(emailConfiguration(env).pass,'aaaabbbbccccdddd');
 assert.equal(emailConfiguration({...env,BOOKING_NOTIFICATION_EMAIL:'a@gmail.com\nBcc:other@gmail.com'}).ready,false);
});
test('mensagem usa apenas os endereços do servidor e preserva a data brasileira',()=>{
 const message=bookingEmail({...booking,to:'intruder@gmail.com',client:{...booking.client,name:'João\r\nBcc: intruder@gmail.com'}},emailConfiguration(env));
 assert.equal(message.to,'owner@gmail.com');assert.equal(message.from.address,'sender@gmail.com');
 assert.match(message.text,/Data: 01\/12\/2026/);assert.match(message.text,/Horário: 14:30/);
 assert.match(message.text,/Serviço: Corte/);assert.match(message.text,/admin\.html/);
 assert.doesNotMatch(message.subject,/[\r\n]/);assert.doesNotMatch(message.text,/aaaabbbbccccdddd/);
});
test('aceite SMTP resulta em sucesso e fecha a conexão',async()=>{
 let closed=false,sent;
 const notify=createBookingNotifier({env,createTransport(options){assert.equal(options.service,'gmail');assert.equal(options.tls.rejectUnauthorized,true);return {async sendMail(message){sent=message;return {accepted:['owner@gmail.com']}},close(){closed=true}}}});
 assert.deepEqual(await notify(booking),{status:'sent'});assert.equal(closed,true);assert.equal(sent.to,'owner@gmail.com');
});
test('falha SMTP não escapa e não expõe credenciais nos logs',async()=>{
 const logs=[];
 const notify=createBookingNotifier({env,logger:{error(...args){logs.push(args)}},createTransport(){return {async sendMail(){throw Object.assign(Error('senha aaaabbbbccccdddd'),{code:'EAUTH'})},close(){}}}});
 assert.deepEqual(await notify(booking),{status:'failed'});assert.deepEqual(logs,[['gabriel-booking-email','EAUTH']]);
});
test('destinatário recusado resulta em falha',async()=>{
 const notify=createBookingNotifier({env,logger:{error(){}},createTransport(){return {async sendMail(){return {accepted:[]}},close(){}}}});
 assert.deepEqual(await notify(booking),{status:'failed'});
});
test('SMTP travado tem prazo e conexão encerrada',async()=>{
 let closed=false;
 const notify=createBookingNotifier({env,timeoutMs:20,logger:{error(){}},createTransport(){return {sendMail(){return new Promise(()=>{})},close(){closed=true}}}});
 assert.deepEqual(await notify(booking),{status:'failed'});assert.equal(closed,true);
});
