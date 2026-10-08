'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const root=path.resolve(__dirname,'..');
function backendOrigin(value,allowPlaceholder=false){let u;try{u=new URL(value)}catch{throw Error('Provide the exact HTTPS backend origin.')}
 const hostname=u.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.port||net.isIP(hostname)||hostname==='localhost')throw Error('Backend must be a public HTTPS origin without path, credentials, query or custom port.');
 if(/\.(invalid|example|test|localhost)$/.test(hostname)&&!allowPlaceholder)throw Error('Replace the placeholder with the real Render HTTPS origin.');
 return u.origin;
}
const apiHeaders={'Cache-Control':'no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','x-vercel-enable-rewrite-caching':'0'};
const security={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
function configuration(origin,allowPlaceholder=false){origin=backendOrigin(origin,allowPlaceholder);return {$schema:'https://openapi.vercel.sh/vercel.json',framework:null,installCommand:'node --version',buildCommand:'node scripts/check-frontend.cjs',outputDirectory:'public',routes:[
 {src:'/api/(.*)',dest:origin+'/api/$1',headers:apiHeaders,transforms:[{type:'request.headers',op:'set',target:{key:'x-scopewise-proxy'},args:'$SCOPEWISE_PROXY_SECRET',env:['SCOPEWISE_PROXY_SECRET']}]},
 {src:'/(.*)',headers:security,continue:true},{handle:'filesystem'}
 ]};}
if(require.main===module){try{const a=process.argv.slice(2);if(a.length!==2||a[0]!=='--backend')throw Error('Usage: node scripts/configure-vercel.cjs --backend https://ACTUAL.onrender.com');
const config=configuration(a[1]);fs.writeFileSync(path.join(root,'vercel.json'),JSON.stringify(config,null,2)+'\n');console.log('Vercel API destination configured: '+backendOrigin(a[1]));console.log('Set the PRIVATE Production SCOPEWISE_PROXY_SECRET in Vercel to the Render proxy secret. No secret was written to source.');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={configuration,backendOrigin,apiHeaders,security};
