import core from '../api.mjs';

export default async function handler(req,res){
  try{
    const incoming=new URL(req.url,'https://gabriel.local');
    const target=incoming.searchParams.get('path')||'/health';
    if(!target.startsWith('/')||target.includes('://')) return res.status(400).json({error:'Caminho inválido.'});
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
    const request=new Request('https://gabriel.local'+target,{
      method:req.method||'GET',headers,body:requestBody
    });
    const response=await core.fetch(request);
    res.status(response.status);
    response.headers.forEach((value,key)=>{
      if(!['content-length','transfer-encoding','connection'].includes(key.toLowerCase())) res.setHeader(key,value);
    });
    const payload=Buffer.from(await response.arrayBuffer());
    res.send(payload);
  }catch(error){
    console.error('gabriel-vercel-wrapper',error);
    res.status(500).json({error:'Não foi possível concluir. Tente novamente.'});
  }
}
