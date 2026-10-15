import pg from 'pg';
import serverModule from '../../server.cjs';
import configModule from '../../lib/config.cjs';
import {Readable} from 'node:stream';
const {createApp}=serverModule;
const {loadConfig}=configModule;
const LIMIT=4*1024*1024;
export const config={path:['/api/*','/health/*']};
function reply(status,value){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function createFunction(options={}){
 let appPromise=null;
 return async function handler(request,context={}){
  const env=options.env||process.env;
  if(env.SCOPEWISE_STORAGE!=='postgres')return reply(503,{error:'External PostgreSQL storage must be configured.',code:'STORAGE_REQUIRED'});
  let url,settings;
  try{url=new URL(request.url);settings=loadConfig({...env,SCOPEWISE_MODE:'production',NODE_ENV:'production',SCOPEWISE_SERVE_FRONTEND:'false',SCOPEWISE_MAX_BODY_BYTES:String(LIMIT)});}
  catch{return reply(503,{error:'Verify private database, origin and session settings.',code:'SERVICE_UNAVAILABLE'});}
  if(url.origin!==settings.publicOrigin||(context.deploy?.context&&context.deploy.context!=='production'))return reply(403,{error:'Use the configured production address.',code:'INVALID_HOST'});
  if(url.pathname==='/health/live'&&['GET','HEAD'].includes(request.method))return request.method==='HEAD'?new Response(null,{status:200,headers:{'Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store'}}):reply(200,{status:'ok'});
  if(!appPromise){
   const attempt=Promise.resolve().then(()=>options.app||createApp({config:settings,Pool:pg.Pool})).then(async app=>{try{await app.ready();return app;}catch(error){await app.close().catch(()=>{});throw error;}});
   appPromise=attempt;
   attempt.catch(()=>{if(appPromise===attempt)appPromise=null;});
  }
  let app;try{app=await appPromise;}catch{return reply(503,{error:'Database unavailable. Retry later or contact the operator.',code:'SERVICE_UNAVAILABLE'});}
  const req=request.body?Readable.fromWeb(request.body):Readable.from([]);
  req.method=request.method;req.url=url.pathname+url.search;req.headers=Object.fromEntries(request.headers);req.headers.host=url.host;req.socket={remoteAddress:typeof context.ip==='string'?context.ip:'netlify'};
  const headers=new Headers();let status=200,body=null,ended=false;
  const res={
   headersSent:false,
   setHeader(name,value){headers.set(name,Array.isArray(value)?value.join(', '):String(value));},
   writeHead(code,values={}){status=code;for(const [key,value] of Object.entries(values))this.setHeader(key,value);this.headersSent=true;},
   end(value){ended=true;body=value===undefined?null:Buffer.from(value);this.headersSent=true;}
  };
  await app.handler(req,res);
  if(!ended)return reply(500,{error:'Request did not complete.',code:'SERVER_ERROR'});
  if(body&&body.length>5*1024*1024)return reply(413,{error:'The saved response exceeds the hosted size limit. Use the operator export tool.',code:'RESPONSE_TOO_LARGE'});
  headers.set('Cache-Control','private, no-store');headers.set('Netlify-CDN-Cache-Control','no-store');
  return new Response(request.method==='HEAD'?null:body,{status,headers});
 };
}
export default createFunction();
