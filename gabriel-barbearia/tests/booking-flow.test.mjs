import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../validation.mjs';

let database,revision,events,conflict=false,notificationStatus='sent';
const clone=value=>JSON.parse(JSON.stringify(value));
function reset(){database=defaults();database.settings.workingDays=[0,1,2,3,4,5,6];database.prices=[{id:'corte',name:'Corte',value:30,duration:60}];revision=1;events=[];conflict=false;notificationStatus='sent'}
class Pool{
 async connect(){let pending;return {async query(sql,args){
  if(sql==='BEGIN'){events.push('begin');return {}}
  if(sql.startsWith('SELECT data,revision'))return {rows:[{data:clone(database),revision}]};
  if(sql.startsWith('UPDATE gabriel_demo_state')){if(conflict)return {rowCount:0,rows:[]};pending=JSON.parse(args[0]);return {rowCount:1,rows:[{revision:revision+1}]}}
  if(sql==='COMMIT'){if(pending){database=pending;revision++;}events.push('commit');return {}}
  if(sql==='ROLLBACK'){pending=null;events.push('rollback');return {}}
  throw Error('Unexpected SQL: '+sql);
 },release(){events.push('release')}}}
 async query(sql){if(sql.startsWith('INSERT INTO gabriel_login_limits'))return {rows:[{attempts:1}]};throw Error('Unexpected pool SQL: '+sql)}
}
mock.module('pg',{namedExports:{Pool}});
mock.module('../booking-email.mjs',{namedExports:{notifyBooking:async booking=>{assert.equal(database.appointments.length,1);assert.equal(events.at(-1),'commit');events.push('email');assert.equal(booking.client.name,'Cliente teste');return {status:notificationStatus}}}});
const {default:core}=await import('../api.mjs');
const {default:handler}=await import('../api/gabriel.mjs');
const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
const payload={name:'Cliente teste',phone:'19999999999',service:'Corte',requestId:'booking-test-0000000001',date:day,time:'14:00',paymentChoice:'onsite'};
async function invoke(kind,body){
 if(kind==='core'){const r=await core.fetch(new Request('https://app.test/public/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()}}
 const response={statusCode:200,setHeader(){},status(value){this.statusCode=value;return this},json(value){this.body=value;return this}};
 await handler({url:'/api/gabriel?path=/public/book',method:'POST',headers:{},body},response);
 return {status:response.statusCode,body:response.body};
}
for(const kind of ['core','vercel']){
 test(`${kind}: novo agendamento dispara aviso somente após COMMIT e repetição não duplica`,async()=>{
  reset();const first=await invoke(kind,payload);assert.equal(first.status,201);assert.equal(database.appointments.length,1);assert.equal(events.filter(x=>x==='email').length,1);
  const again=await invoke(kind,payload);assert.equal(again.status,200);assert.equal(database.appointments.length,1);assert.equal(events.filter(x=>x==='email').length,1);
 });
 test(`${kind}: falha de envio mantém o agendamento salvo`,async()=>{
  reset();notificationStatus='failed';assert.equal((await invoke(kind,payload)).status,201);assert.equal(database.appointments.length,1);
 });
 test(`${kind}: conflito ao salvar não dispara aviso`,async()=>{
  reset();conflict=true;assert.equal((await invoke(kind,payload)).status,409);assert.equal(database.appointments.length,0);assert.equal(events.includes('email'),false);
 });
 test(`${kind}: horário ocupado não dispara outro aviso`,async()=>{
  reset();await invoke(kind,payload);const r=await invoke(kind,{...payload,requestId:'booking-test-0000000002'});assert.equal(r.status,409);assert.equal(database.appointments.length,1);assert.equal(events.filter(x=>x==='email').length,1);
 });
}
