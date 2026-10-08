'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {configuration,backendOrigin}=require('./configure-vercel.cjs'),root=path.resolve(__dirname,'..');
function check({allowPlaceholder=false}={}){const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
assert.equal(config.outputDirectory,'public');assert.equal(config.framework,null);assert(!config.functions&&!config.rewrites&&!config.headers);
const route=config.routes?.[0];assert.equal(route?.src,'/api/(.*)');const origin=backendOrigin(route.dest.replace(/\/api\/\$1$/,''),allowPlaceholder);
assert.deepEqual(config,configuration(origin,allowPlaceholder));
const dir=path.join(root,'public'),files=fs.readdirSync(dir);const allowed=['auth.css','auth.js','costing-ui.js','costing.css','cyberpunk.css','index.html','intelligence.js','operations-data.js','operations-ui.js','operations.css','planner.js','platform.css','rule-catalogue.js','rules-engine.js','server-client.js','storage.js','theme.css','workspace-data.js','workspace.css','workspace.js'];
assert.deepEqual(files.sort(),allowed.sort(),'Only approved static assets may be in the Vercel output directory.');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)){if(!m[1].startsWith('#'))assert(fs.existsSync(path.join(dir,m[1])),m[1]+' missing');}
for(const name of files){const content=fs.readFileSync(path.join(dir,name),'utf8');assert(!/SCOPEWISE_PROXY_SECRET|SCOPEWISE_SESSION_SECRET/.test(content),'Private environment names/values must not be baked into public assets');}
if(process.env.VERCEL==='1'&&(!process.env.SCOPEWISE_PROXY_SECRET||Buffer.byteLength(process.env.SCOPEWISE_PROXY_SECRET)<32))throw Error('Vercel Production requires the private proxy secret before build.');
return {origin,staticFiles:files.length};}
if(require.main===module){try{const a=process.argv.slice(2);if(a.length&&!(a.length===1&&a[0]==='--allow-placeholder'))throw Error('Usage: node scripts/check-frontend.cjs [--allow-placeholder]');
if(process.env.VERCEL==='1'&&a.length)throw Error('Hosted builds cannot allow placeholder origins.');
const result=check({allowPlaceholder:a.length===1});console.log('Frontend checks passed: '+result.staticFiles+' static assets; API -> '+result.origin);if(a.length)console.log('TEMPLATE ONLY: exact backend URL is still required; a hosted build will fail closed.');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={check};
