'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const ROOT=path.resolve(__dirname,'..');
function loadConfig(env=process.env){
 const mode=env.SCOPEWISE_MODE||((env.NODE_ENV==='production')?'production':'development');
 if(!['production','development'].includes(mode))throw Error('SCOPEWISE_MODE must be production or development.');
 if(env.NODE_ENV==='production'&&mode!=='production')throw Error('Production NODE_ENV requires production Scopewise mode.');
 const port=Number(env.SCOPEWISE_PORT||env.PORT||4173);if(!Number.isInteger(port)||port<1||port>65535)throw Error('SCOPEWISE_PORT must be a valid port.');
 const host=env.SCOPEWISE_HOST||(mode==='production'?'0.0.0.0':'127.0.0.1');if(!net.isIP(host))throw Error('SCOPEWISE_HOST must be an IP address.');
 if(mode==='development'&&!['127.0.0.1','::1'].includes(host))throw Error('Development authentication is only served on loopback. Use production behind HTTPS for remote access.');
 const storage=env.SCOPEWISE_STORAGE||'sqlite';if(!['sqlite','postgres'].includes(storage))throw Error('SCOPEWISE_STORAGE must be sqlite or postgres.');
 const databaseUrl=env.DATABASE_URL||null;if(storage==='postgres'&&!databaseUrl)throw Error('PostgreSQL storage requires a private DATABASE_URL.');
 const maxBodyBytes=Number(env.SCOPEWISE_MAX_BODY_BYTES||8388608);if(!Number.isInteger(maxBodyBytes)||maxBodyBytes<4096||maxBodyBytes>8388608)throw Error('SCOPEWISE_MAX_BODY_BYTES must be 4096–8388608.');
 const workDir=path.resolve(env.SCOPEWISE_WORK_DIR||path.join(ROOT,'work')),base=path.join(ROOT,'work');
 if(workDir!==base&&!workDir.startsWith(base+path.sep))throw Error('SCOPEWISE_WORK_DIR must remain inside Scopewise/work.');
 if(storage==='sqlite'){fs.mkdirSync(workDir,{recursive:true,mode:0o700});
 const actual=fs.realpathSync(workDir),actualBase=fs.realpathSync(base);if(actual!==actualBase&&!actual.startsWith(actualBase+path.sep))throw Error('Workspace storage resolves outside Scopewise/work.');}
 let publicOrigin=null;
 if(env.SCOPEWISE_PUBLIC_ORIGIN){let parsed;try{parsed=new URL(env.SCOPEWISE_PUBLIC_ORIGIN);}catch{throw Error('SCOPEWISE_PUBLIC_ORIGIN must be an origin URL.');}
 if(parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||!['http:','https:'].includes(parsed.protocol))throw Error('SCOPEWISE_PUBLIC_ORIGIN must contain only scheme and host.');
 publicOrigin=parsed.origin;
 if(mode==='production'&&parsed.protocol!=='https:')throw Error('Production public origin must use HTTPS.');
 if(mode==='development'&&!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw Error('Development public origin must be loopback.');}
 if(mode==='production'&&!publicOrigin)throw Error('Production requires SCOPEWISE_PUBLIC_ORIGIN.');
 let backendOrigin=null;if(env.SCOPEWISE_BACKEND_ORIGIN||env.RENDER_EXTERNAL_URL){const value=env.SCOPEWISE_BACKEND_ORIGIN||env.RENDER_EXTERNAL_URL;let parsed;try{parsed=new URL(value);}catch{throw Error('Backend origin must be an HTTPS origin.');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('Backend origin must contain only HTTPS scheme and host.');backendOrigin=parsed.origin;}
 const managedSecret=env.SCOPEWISE_SESSION_SECRET||null;const proxyRaw=env.SCOPEWISE_PROXY_SECRET||null;let proxySecret=null;if(proxyRaw){if(Buffer.byteLength(proxyRaw)<32||Buffer.byteLength(proxyRaw)>4096||/[\r\n\0]/.test(proxyRaw))throw Error('Proxy secret must be a private random value of at least 32 bytes.');proxySecret=Buffer.from(proxyRaw);}if(mode==='production'&&backendOrigin&&backendOrigin!==publicOrigin&&!proxySecret)throw Error('Split-host production requires SCOPEWISE_PROXY_SECRET shared privately with Vercel.');
 let secretFile=env.SCOPEWISE_SESSION_SECRET_FILE?path.resolve(env.SCOPEWISE_SESSION_SECRET_FILE):null;
 if(managedSecret&&secretFile)throw Error('Configure either a managed session secret or a private secret file, not both.');
 if(mode==='production'&&!secretFile&&!managedSecret)throw Error('Production requires a private SCOPEWISE_SESSION_SECRET or SCOPEWISE_SESSION_SECRET_FILE.');
 if(storage==='postgres'&&!managedSecret&&!secretFile)throw Error('External storage requires an explicitly managed session secret.');
 if(!secretFile&&!managedSecret){secretFile=path.join(workDir,'secrets/session-secret');fs.mkdirSync(path.dirname(secretFile),{recursive:true,mode:0o700});try{fs.writeFileSync(secretFile,require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}
 const raw=managedSecret?Buffer.from(managedSecret):fs.readFileSync(secretFile);if(raw.length>4096)throw Error('Session secret file is too large.');
 const text=raw.toString('utf8').trim(),sessionSecret=/^[a-fA-F0-9]{64,128}$/.test(text)?Buffer.from(text,'hex'):raw;
 if(sessionSecret.length<32)throw Error('Session secret file requires at least 32 random bytes.');
 if(secretFile&&mode==='production'&&process.platform!=='win32'){const stat=fs.statSync(secretFile);if(stat.mode&0o077)throw Error('Session secret file must not be accessible to group or other users.');}
 if(managedSecret&&/[\r\n\0]/.test(managedSecret))throw Error('Managed session secret must be a single private value.');
 const serveFrontend=env.SCOPEWISE_SERVE_FRONTEND===undefined?mode==='development':env.SCOPEWISE_SERVE_FRONTEND==='true';if(env.SCOPEWISE_SERVE_FRONTEND!==undefined&&!['true','false'].includes(env.SCOPEWISE_SERVE_FRONTEND))throw Error('SCOPEWISE_SERVE_FRONTEND must be true or false.');
 return {storage,databaseUrl,maxBodyBytes,mode,port,host,publicOrigin,backendOrigin,proxySecret,serveFrontend,workDir,workRelative:path.relative(ROOT,workDir).split(path.sep).join('/'),sessionSecret,secretFile,secureCookies:mode==='production'};
}
module.exports={loadConfig,ROOT};
