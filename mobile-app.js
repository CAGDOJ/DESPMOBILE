const app=document.getElementById('app'),net=document.getElementById('net');
const SUPABASE_URL='https://xbefmjcagmlqptkrrtse.supabase.co';
const SUPABASE_PUBLISHABLE='sb_publishable_J7wi8MGYRKcVCE7fQRsMxg_bPtEd44e';
const externalMode=location.hostname.endsWith('.supabase.co')||new URLSearchParams(location.search).has('token');
const token=decodeURIComponent(new URLSearchParams(location.search).get('token')||location.pathname.split('/').pop()||'');
let mission=null,gpsWatch=null,lastGps=0;
const checklistItems=['Extintor','Macaco','Chave de rodas','Estepe','Parte elétrica','Lataria','Óleo lubrificante','Água','Fluido de freio','Pneus','Triângulo','Limpeza','CRLV','Bateria','Pintura','Para-brisas / Vidros'];
const requiredShots=[
  {key:'FRENTE',label:'Frente da VTR'},
  {key:'TRASEIRA',label:'Traseira da VTR'},
  {key:'LATERAL_ESQUERDA',label:'Lateral esquerda'},
  {key:'LATERAL_DIREITA',label:'Lateral direita'},
  {key:'PAINEL',label:'Painel / hodômetro'}
];
const shotState={SAÍDA:{},RETORNO:{}};
let returnMode=false, initializedState=false;
const draftKey='sivtr-draft-'+token;
let draft={};
try{draft=JSON.parse(localStorage.getItem(draftKey)||'{}')||{}}catch{draft={}}
function saveDraftField(id,value){draft[id]=value;try{localStorage.setItem(draftKey,JSON.stringify(draft))}catch{}persistMobileState()}
function clearDraft(){draft={};try{localStorage.removeItem(draftKey)}catch{}persistMobileState()}
function bindDraftAutosave(){
  document.querySelectorAll('input:not([type=file]), textarea, select').forEach(el=>{
    const key=el.id||el.name;if(!key)return;
    const ev=(el.type==='radio'||el.type==='checkbox'||el.tagName==='SELECT')?'change':'input';
    el.addEventListener(ev,()=>{
      if(el.type==='radio'){ if(el.checked) saveDraftField(key,el.value); }
      else saveDraftField(key,el.value);
    });
  });
}
function restoreDraftToDom(){
  for(const [key,val] of Object.entries(draft)){
    const byId=document.getElementById(key);
    if(byId && byId.type!=='file'){byId.value=val; if(byId.type==='hidden' && key.startsWith('fuel')){document.querySelectorAll(`#${key}Picker .fuel-option`).forEach(x=>x.classList.toggle('selected',x.dataset.value===val));}}
    document.querySelectorAll(`input[type=radio][name="${CSS.escape(key)}"]`).forEach(r=>r.checked=r.value===val);
  }
  for(const stage of ['SAÍDA','RETORNO']) for(const x of requiredShots){
    const shot=shotState[stage][x.key]; if(!shot) continue;
    const prev=document.getElementById(`preview_${stage}_${x.key}`); if(prev)prev.innerHTML=`<img src="${shot.dataUrl}" alt="${x.key}">`;
    const state=document.getElementById(`state_${stage}_${x.key}`); if(state){state.textContent='Foto pronta';state.classList.add('done')}
  }
}
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function updateNet(){net.textContent=navigator.onLine?'ONLINE':'OFFLINE';net.classList.toggle('off',!navigator.onLine)}
window.addEventListener('online',()=>{updateNet();flushQueue();refresh();backgroundRefresh()});window.addEventListener('offline',updateNet);updateNet();
function ticketFromHash(){try{const h=new URLSearchParams(location.hash.replace(/^#/,''));const b=h.get('ticket');if(!b)return null;const s=b.replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(decodeURIComponent(escape(atob(s+'==='.slice((s.length+3)%4)))))}catch{return null}}
function idb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('sivtr-mobile',4);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('missions'))d.createObjectStore('missions',{keyPath:'token'});if(!d.objectStoreNames.contains('queue'))d.createObjectStore('queue',{keyPath:'id'});if(!d.objectStoreNames.contains('drafts'))d.createObjectStore('drafts',{keyPath:'token'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function put(store,val){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(val);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function get(store,key){const d=await idb();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function all(store){const d=await idb();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function del(store,key){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).delete(key);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function persistMobileState(){try{await put('drafts',{token,draft,shots:shotState,returnMode,at:new Date().toISOString()})}catch{}}
async function restoreMobileState(){try{const x=await get('drafts',token);if(x){draft=x.draft||draft;Object.assign(shotState.SAÍDA,x.shots?.SAÍDA||{});Object.assign(shotState.RETORNO,x.shots?.RETORNO||{});returnMode=!!x.returnMode}}catch{}initializedState=true}
async function fetchTimeout(url,opt={},ms=7000){const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),ms);try{return await fetch(url,{...opt,signal:ctrl.signal})}finally{clearTimeout(t)}}
async function supabaseRpc(name,payload){const r=await fetchTimeout(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','apikey':SUPABASE_PUBLISHABLE},body:JSON.stringify(payload)},7000);let d=null;try{d=await r.json()}catch{}if(!r.ok)throw new Error(d?.message||d?.error||'Falha na conexão externa');return d}
async function remoteMission(){return await supabaseRpc('sivtr_get_mission',{p_token:token})}
async function send(path,data){if(!navigator.onLine)throw new Error('offline');if(externalMode){const kind=String(path).split('/').filter(Boolean).pop();return await supabaseRpc('sivtr_enqueue_action',{p_token:token,p_action_type:kind,p_payload:data||{}})}const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'Falha');return d}
async function queue(kind,data){const item={id:crypto.randomUUID?crypto.randomUUID():Date.now()+'_'+Math.random(),kind,data,at:new Date().toISOString(),token};await put('queue',item);return item}
async function flushQueue(){if(!navigator.onLine)return;const q=await all('queue');for(const x of q.sort((a,b)=>a.at.localeCompare(b.at))){try{await send(`/api/mobile/${encodeURIComponent(x.token)}/${x.kind}`,x.data);await del('queue',x.id)}catch(e){break}}}
async function refresh(){
  if(!initializedState)await restoreMobileState();
  // Mostra imediatamente o último estado salvo ou o ticket do QR. F5 nunca deixa uma tela vazia esperando rede.
  const cached=await get('missions',token).catch(()=>null);
  const ticket=ticketFromHash();
  if(!mission){mission=cached?.data||ticket||null;if(mission)render();}
  let data=null;
  try{
    if(externalMode)data=await remoteMission();
    else{const r=await fetchTimeout('/api/mobile/mission/'+encodeURIComponent(token)+'?_='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}},5000);const d=await r.json();if(r.ok&&d.ok)data=d.data}
  }catch{}
  if(data){mission=data;await put('missions',{token,data,at:new Date().toISOString()});render()}
  else if(!mission){app.innerHTML='<div class="card"><h2>Ficha da missão</h2><div class="notice warn">Não foi possível atualizar a ficha agora. Verifique a conexão e tente novamente.</div><button class="btn" onclick="refresh()">Tentar novamente</button></div>'}
}
if(!externalMode&&'serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
refresh().then(flushQueue);
setInterval(()=>{flushQueue();backgroundRefresh()},1000);

