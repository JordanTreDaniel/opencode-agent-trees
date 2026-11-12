(()=>{var R="openchamber.sdk",y=1;var ot=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [data-oc-scrolling] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [data-oc-scrolling] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [data-oc-scrolling]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [data-oc-scrolling] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function nt(e){let t=e.documentElement;if(t.hasAttribute("data-oc-scrollbar-activity"))return;t.setAttribute("data-oc-scrollbar-activity","");let n=new WeakMap;e.addEventListener("scroll",(s)=>{let a=s.target===e?t:s.target;if(!(a instanceof Element))return;if(!a.hasAttribute("data-oc-scrolling"))a.setAttribute("data-oc-scrolling","");let i=n.get(a);if(i!==void 0)clearTimeout(i);n.set(a,setTimeout(()=>{n.delete(a),a.removeAttribute("data-oc-scrolling")},1000))},{capture:!0,passive:!0})}var nn=`(${nt.toString()})(document);`;var rt=128,st=65536;var Ge=128;var He=65536;var to=/^[a-z][a-z0-9-]{0,39}$/;var Qt=(e)=>Object(e)===e&&!Array.isArray(e),it=(e,t)=>Object.keys(e).every((n)=>t.includes(n)),Zt=(e)=>String(e)===e&&e.length>=1&&e.length<=60,eo=(e)=>String(e)===e&&e.length>=1&&e.length<=80,oo=(e)=>{if(!Array.isArray(e)||e.length>4)return!1;let t=new Set;for(let n of e){if(!Qt(n)||!to.test(n.id)||!Zt(n.label))return!1;if(n.disabled!==void 0&&n.disabled!==!0&&n.disabled!==!1)return!1;if(t.has(n.id))return!1;if(t.add(n.id),n.kind==="button"){if(!it(n,["kind","id","label","disabled"]))return!1;continue}if(n.kind!=="select"||!it(n,["kind","id","label","value","options","disabled"]))return!1;if(!eo(n.value)||!Array.isArray(n.options)||n.options.length<1||n.options.length>16)return!1;let s=new Set;for(let a of n.options){if(!Qt(a)||!it(a,["value","label"])||!eo(a.value)||!Zt(a.label)||s.has(a.value))return!1;s.add(a.value)}if(!s.has(n.value))return!1}return!0};var no=["{id}","{segment}","{segments+}"];var zn=new Set(no);var ro=["turn-finished","turn-failed","permission-asked","question-asked"];var Yn=new Set(ro);var $e=20000000,Fe=256;var at=(e)=>("bytes"in e)?e.bytes.byteLength:e.content.length,so=(e,t)=>{if(e.path!==t.path||e.readOnly!==t.readOnly)return!1;if(e.encoding==="text"||t.encoding==="text")return e.encoding==="text"&&t.encoding==="text"&&e.content===t.content;if(e.bytes.byteLength!==t.bytes.byteLength)return!1;for(let n=0;n<e.bytes.byteLength;n+=1)if(e.bytes[n]!==t.bytes[n])return!1;return!0};var io=/^[A-Za-z0-9_-]{1,80}$/;var ao=["left","right","top","bottom"];var co=(e,t=0,n={remaining:16000})=>{if(--n.remaining<0||t>=32)return!1;if(e===null)return!0;let s=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let a of s)if(!co(a,t+1,n))return!1;return!0},ct=(e)=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every((t)=>/^(0|[1-9]\d*)$/.test(t)&&Number(t)<e.length)&&e.every(ct);if(Object(e)===e){let t=Object.getPrototypeOf(e);return(t===null||t===Object.prototype)&&Object.values(e).every(ct)}return String(e)===e||Number.isFinite(e)},dt=(e)=>{try{if(String(e.id)!==e.id||!io.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!ao.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!co(e.data)||!ct(e.data))return!1;return JSON.stringify(e.data).length<=16000}catch{return!1}};var po=["file","directory","other","missing"],pt=(e)=>Boolean(e&&"sessionId"in e),ut=(e)=>Boolean(e&&"sent"in e&&!("sessionId"in e));var uo=/^[0-9a-f]{7,64}$/i,ft=(e)=>uo.test(e),Xe=500,Ve=32000,fo=16000,Eo=128,_o=200,ho=2000,So=16000,To=80,mo=200,bo=16000;var go=2000;var Et=20000,Be=1024,je=2000000;var Ke=64000,We=8000,_t=4000;var ht=960000;var xo=999,vo=1e4,Ue=500,Oo=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],Ao=["stopped","starting","ready","failed"],sn=new Set(Oo),Ro=(e)=>sn.has(e),yo=(e)=>e&&Ro(e)?e:"HOST_REJECTED",ye=(e)=>{if(e===void 0)return!1;if(e===null||e===!0||e===!1)return!0;if(String(e)===e)return!0;if(Number(e)===e)return Number.isFinite(e);if(Array.isArray(e))return e.every(ye);if(Object(e)===e)return Object.values(e).every(ye);return!1},ko=(e)=>ye(e)&&JSON.stringify(e).length<=bo,lo=(e)=>e?.trim().slice(0,mo)??"",ke=(e)=>{let t=e.id.trim().slice(0,Eo),n=e.title.trim().slice(0,_o),s=e.url.trim().slice(0,ho),a=e.text?.trim().slice(0,So),i=e.author?.trim().slice(0,To),d=e.kind==="pull"?"pull":"issue",p={providerId:e.providerId.trim(),id:t,title:n||t,url:s,kind:d};if(a)p.text=a;if(i)p.author=i;if(d==="pull"){let g=lo(e.branches?.head),x=lo(e.branches?.base);if(g&&x)p.branches={head:g,base:x}}if(ko(e.data))p.data=e.data;return p},St=(e)=>{let t=ke(e);if(e.projectId)t.projectId=e.projectId;if(e.navigation)t.navigation=e.navigation;if(e.worktree)t.worktree=e.worktree;return t},Tt=(e)=>{let t={text:e.text.trim().slice(0,fo)};if(e.send)t.send=!0;return t},mt=(e)=>{if(e===null||!Number.isFinite(e))return null;return Math.min(xo,Math.max(0,Math.round(e)))},bt=(e)=>{if(!Number.isFinite(e))return 0;return Math.min(vo,Math.max(0,Math.ceil(e)))};var Ie=(e)=>e.length>0&&e.length<=Be&&!e.includes("\x00")&&!e.includes("\\");var ze=(e)=>{if(!e.startsWith("/")||e.includes("\x00")||e.includes("\\")||e.includes("://"))return!1;if(e.length>go)return!1;return!e.split("/").some((n)=>n==="."||n==="..")},an=new Set(Ao),gt=(e)=>Boolean(e&&"status"in e&&an.has(String(e.status))&&!("body"in e)),Je=(e)=>Boolean(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),xt=(e)=>Boolean(e&&"content"in e&&String(e.content)===e.content),vt=(e)=>Boolean(e&&"written"in e&&e.written===!0),Ot=(e)=>Boolean(e&&"entries"in e&&Array.isArray(e.entries)),cn=new Set(po),At=(e)=>Boolean(e&&"kind"in e&&"size"in e&&cn.has(String(e.kind))&&Number.isFinite(e.size)),Rt=(e)=>Boolean(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),dn=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late"]),ln=(e)=>Object(e)===e?e:null,lt=(e)=>String(e)===e&&e.length>0,pn=(e)=>{if(!lt(e.id))return null;if(e.ok===!0){let t={channel:R,v:y,type:"result",id:e.id,ok:!0};if(Object(e.payload)===e.payload)t.payload=e.payload;return t}if(e.ok===!1&&lt(e.error))return{channel:R,v:y,type:"result",id:e.id,ok:!1,error:e.error,code:yo(lt(e.code)?e.code:void 0)};return null},yt=(e)=>{let t=ln(e);if(!t||t.channel!==R||t.v!==y)return null;if(t.type==="result")return pn(t);if(!dn.has(String(t.type))||Object(t.payload)!==t.payload)return null;return t};var Io=(e)=>("key"in e)&&("metaKey"in e)&&("ctrlKey"in e),un=(e)=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s";class m extends Error{code;constructor(e,t){super(t);this.name="HostRequestError",this.code=e}}var wo=()=>Promise.reject(new m("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Ye=()=>Promise.reject(new m("BAD_PATH",`File path must be 1 to ${Be} characters without NUL or backslash.`)),qe=(e)=>{if(e===void 0)return;if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new m("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0},v=(e)=>(e.value+=1,`oc-${e.value}`),kt=(e={})=>{let t=e.target??("window"in globalThis?window:null);if(!t)throw new m("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let n=e.acceptSource??((o)=>o===t.parent),s=e.requestTimeoutMs??Et,a=new Set,i=new Set,d=new Set,p=new Set,g=new Set,x=new Set,w=new Set,J=new Set,oe=new Set,C=new Set,N=[],ce=null,re=null,Y=new Set,h=new Set,k=null,W=null,ue=!1,z=new Map,se=new Map,q=new Map,Q=!1,T={value:0},f=null,b=null,O=!1,me=!1,Me=null,Le=(o)=>{if(!o)return null;return{sessionId:o.id,phase:o.busy?"started":"completed"}},ne=(o)=>{t.parent.postMessage(o,"*")},Pe=()=>{if(Q||t.parent===t||C.size===0||f?.features?.lateGenerateResults!==!0)return;ne({channel:R,v:y,type:"generate-late-listen"})},P=(o,r)=>{for(let E of o)try{E(r)}catch(S){console.error(S)}},he=(o)=>{if(!(o instanceof MessageEvent))return;if(!n(o.source))return;let r=yt(o.data);if(!r)return;if(r.type==="workspace"){let S=se.get(r.payload.subscriptionId);if(S)P([S],r.payload.snapshot);return}if(r.type==="shells"){let S=q.get(r.payload.subscriptionId);if(S)P([S],r.payload.snapshot);return}if(r.type==="ready"){if(f=r.payload,b=Le(r.payload.session),P(a,r.payload),P(i,r.payload.directory),P(d,r.payload.session),b)P(p,b);P(g,r.payload.connection),P(x,r.payload.settings),P(w,r.payload.item),Pe();return}if(r.type==="generate-late"){if(C.size===0)N.push(r.payload);else P(C,r.payload);return}if(r.type==="directory"){if(f)f={...f,directory:r.payload.directory};P(i,r.payload.directory);return}if(r.type==="session"){if(f)f={...f,session:r.payload.session};if(!r.payload.session)b=null;else if(b?.sessionId!==r.payload.session.id)b=Le(r.payload.session);P(d,r.payload.session);return}if(r.type==="session-lifecycle"){b=r.payload,P(p,r.payload);return}if(r.type==="connection"){if(f)f={...f,connection:r.payload.connection};P(g,r.payload.connection);return}if(r.type==="settings"){if(f)f={...f,settings:r.payload.settings};P(x,r.payload.settings);return}if(r.type==="item"){if(f)f={...f,item:r.payload.item};P(w,r.payload.item);return}if(r.type==="status-control-event"){P(J,r.payload);return}if(r.type==="popover-closed"){P(oe,r.payload);return}if(r.type==="action"){let S=(L)=>{if(!Q)ne({channel:R,v:y,type:"action-result",id:r.id,payload:L})},G=re;if(!G){S({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>G(r.payload)).then(()=>S({ok:!0}),(L)=>{let K=(L instanceof Error?L.message:String(L)).trim();S({ok:!1,error:(K||"Action failed.").slice(0,Ue)})});return}if(r.type==="file-open"){let S=r.payload;if(W&&so(W,S))return;W=S,P(Y,r.payload);return}if(r.type==="file-saved"){P(h,r.payload.version);return}if(r.type==="file-snapshot"){let S=(K)=>{if(!Q)ne({channel:R,v:y,type:"file-snapshot-result",id:r.id,payload:K})},G=(K)=>S({error:(K.trim()||"Could not read the edited file.").slice(0,Ue)}),L=k;if(!L){G("This extension does not edit files.");return}Promise.resolve().then(()=>L(r.payload.purpose)).then((K)=>{if(at(K)>$e){G(`The file is over ${$e} ${"bytes"in K?"bytes":"characters"}.`);return}if(K.version.length>Fe){G(`The snapshot version is over ${Fe} characters.`);return}S({snapshot:"bytes"in K?{bytes:K.bytes,version:K.version}:{content:K.content,version:K.version}})},(K)=>G(K instanceof Error?K.message:String(K)));return}if(r.type==="resolve"){let S=(L)=>{ne({channel:R,v:y,type:"resolve-result",id:r.id,payload:L})},G=ce;if(!G){S({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>G(r.payload)).then((L)=>S({item:L?ke(L):null}),(L)=>{let K=(L instanceof Error?L.message:String(L)).trim();S({error:(K||"Command failed.").slice(0,Ue)})});return}let E=z.get(r.id);if(!E)return;if(clearTimeout(E.timer),z.delete(r.id),r.ok){E.resolve(r.payload);return}E.reject(new m(r.code,r.error))};t.addEventListener("message",he),ne({channel:R,v:y,type:"hello"});let Z=(o,r=s)=>{if(Q||t.parent===t)return Promise.reject(new m("HOST_UNAVAILABLE","No host frame. This page is not in an iframe."));return new Promise((E,S)=>{let G=setTimeout(()=>{z.delete(o.id),S(new m("HOST_TIMEOUT","Host did not answer in time."))},r);z.set(o.id,{resolve:E,reject:S,timer:G}),ne(o)})},F=(o)=>Z(o).then(()=>{return}),X={channel:R,v:y},c=(o)=>{if(!Q&&t.parent!==t)ne(o)},I=()=>c({...X,type:"file-save"}),A=(o)=>{if(!Io(o)||!un(o))return;o.preventDefault(),I()},u=(o)=>{if(!Io(o)||o.key!=="Escape"||f?.surface!=="popover"||!f.popover)return;o.preventDefault(),Yt(f.popover.id,"escape").catch(()=>{return})},_=()=>{let o=f?.surface==="popover"?f.popover:void 0;if(!o)return;let r=O||me;if(Me===r)return;Me=r,qt(o.id,r).catch(()=>{return})},M=()=>{if(f?.surface!=="popover"||O)return;O=!0,_()},pe=(o)=>{if(f?.surface!=="popover"||o.relatedTarget!==null||!O)return;O=!1,_()},D=()=>{if(f?.surface!=="popover"||me)return;me=!0,_()},Re=()=>{if(f?.surface!=="popover"||!me)return;me=!1,_()},ie=(o,r=1024)=>{if(!o.trim()||o.length>r)throw new m("HOST_REJECTED",`Identity must contain 1 to ${r} characters.`)},et=async(o)=>{if(o.kind!=="projects")ie(o.projectId);let r=await Z({...X,type:"workspace-read",id:v(T),payload:o});if(!r||!("kind"in r)||!("state"in r)||r.kind!==o.kind)throw new m("HOST_REJECTED","Host did not return workspace data.");return r},tt=async(o,r)=>{if(o.kind!=="projects")ie(o.projectId);let E=v(T);se.set(E,r);try{await F({...X,type:"workspace-subscribe",id:v(T),payload:{subscriptionId:E,query:o}})}catch(S){if(se.delete(E),!Q)ne({...X,type:"workspace-unsubscribe",id:v(T),payload:{subscriptionId:E}});throw S}return()=>{if(!se.delete(E)||Q)return;ne({...X,type:"workspace-unsubscribe",id:v(T),payload:{subscriptionId:E}})}},on=async(o,r)=>{if(o.kind==="session")ie(o.sessionId);if(o.kind==="project")ie(o.projectId);let E=v(T);q.set(E,r);try{await F({...X,type:"shells-subscribe",id:v(T),payload:{subscriptionId:E,scope:o}})}catch(S){if(q.delete(E),!Q)ne({...X,type:"shells-unsubscribe",id:v(T),payload:{subscriptionId:E}});throw S}return()=>{if(!q.delete(E)||Q)return;ne({...X,type:"shells-unsubscribe",id:v(T),payload:{subscriptionId:E}})}},De=async(o)=>{if("key"in o&&(o.key.length===0||o.key.length>rt))throw new m("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(o.op==="set"&&!ye(o.value))throw new m("HOST_REJECTED","Storage values must be JSON.");if(o.op==="set"&&new TextEncoder().encode(JSON.stringify(o.value)).length>st)throw new m("HOST_REJECTED","Storage value exceeds 64 KiB.");if(o.scope==="device"&&f?.features?.deviceStorage!==!0)throw new m("UNSUPPORTED","This host does not support device storage.");let r=await Z({...X,type:"storage",id:v(T),payload:o});if(!r||!("storage"in r)||r.op!==o.op)throw new m("HOST_REJECTED","Host did not return storage data.");return r},Yt=(o,r)=>f?.features?.popovers!==!0&&!(f?.surface==="popover"&&f.popover?.id===o)?Promise.reject(new m("UNSUPPORTED","This host does not support popovers.")):F({...X,type:"popover-close",id:v(T),payload:r?{id:o,reason:r}:{id:o}}),qt=(o,r)=>f?.features?.popovers!==!0&&!(f?.surface==="popover"&&f.popover?.id===o)?Promise.reject(new m("UNSUPPORTED","This host does not support popovers.")):F({...X,type:"popover-anchor",id:v(T),payload:{id:o,active:r}});return t.addEventListener("keydown",u,!0),t.addEventListener("pointerover",M),t.addEventListener("pointermove",M),t.addEventListener("pointerout",pe),t.addEventListener("focus",D),t.addEventListener("blur",Re),{onAction:(o)=>(re=o,()=>{if(re===o)re=null}),listProjects:async()=>{let o=await et({kind:"projects"});if(o.kind!=="projects")throw new m("HOST_REJECTED","Expected projects.");return o},listWorktrees:async(o)=>{let r=await et({kind:"worktrees",projectId:o});if(r.kind!=="worktrees")throw new m("HOST_REJECTED","Expected worktrees.");return r},listSessions:async(o)=>{let r=await et({kind:"sessions",projectId:o});if(r.kind!=="sessions")throw new m("HOST_REJECTED","Expected sessions.");return r},onProjects:(o)=>tt({kind:"projects"},(r)=>{if(r.kind==="projects")o(r)}),onWorktrees:(o,r)=>tt({kind:"worktrees",projectId:o},(E)=>{if(E.kind==="worktrees")r(E)}),onSessions:(o,r)=>tt({kind:"sessions",projectId:o},(E)=>{if(E.kind==="sessions")r(E)}),onRunningShells:(o,r)=>on(o,r),readShellOutput:async(o,r)=>{ie(o,Ge);let E=r?.cursor;if(E!==void 0&&(!Number.isInteger(E)||E<0))throw new m("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let S=r?.tailBytes;if(S!==void 0&&(!Number.isInteger(S)||S<1||S>He))throw new m("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${He}.`);let L=await Z({...X,type:"shell-output",id:v(T),payload:{shellId:o,cursor:E,tailBytes:S}});if(!L||typeof L.output!=="string"||!Number.isFinite(L.cursor))throw new m("HOST_REJECTED","Host did not return shell output.");return L},stopShell:async(o)=>{if(ie(o,Ge),(await Z({...X,type:"shell-stop",id:v(T),payload:{shellId:o}}))?.stopped!==!0)throw new m("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async(o)=>{ie(o),await F({...X,type:"open-session",id:v(T),payload:{sessionId:o}})},storage:{get:async(o,r)=>{let E=qe(r),S={op:"get",key:o};if(E)S.scope=E;let G=await De(S);return G.op==="get"&&G.found?G.value:void 0},set:async(o,r,E)=>{let S=qe(E),G={op:"set",key:o,value:r};if(S)G.scope=S;await De(G)},delete:async(o,r)=>{let E=qe(r),S={op:"delete",key:o};if(E)S.scope=E;await De(S)},keys:async(o)=>{let r=qe(o),E={op:"keys"};if(r)E.scope=r;let S=await De(E);if(S.op!=="keys")throw new m("HOST_REJECTED","Expected storage keys.");return S.keys}},onReady:(o)=>{if(a.add(o),f)o(f);return()=>{a.delete(o)}},onDirectory:(o)=>{if(i.add(o),f)o(f.directory);return()=>{i.delete(o)}},onSession:(o)=>{if(d.add(o),f)o(f.session);return()=>{d.delete(o)}},onSessionLifecycle:(o)=>{if(p.add(o),b)o(b);return()=>{p.delete(o)}},onConnection:(o)=>{if(g.add(o),f)o(f.connection);return()=>{g.delete(o)}},onSettings:(o)=>{if(x.add(o),f)o(f.settings);return()=>{x.delete(o)}},onItem:(o)=>{if(w.add(o),f)o(f.item);return()=>{w.delete(o)}},onStatusControl:(o)=>(J.add(o),()=>{J.delete(o)}),onPopoverClosed:(o)=>(oe.add(o),()=>{oe.delete(o)}),setStatusControls:(o)=>{if(f?.features?.statusControls!==!0)return Promise.reject(new m("UNSUPPORTED","This host does not support status controls."));if(!oo(o))return Promise.reject(new m("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options."));return F({...X,type:"status-controls",id:v(T),payload:{controls:o}})},openPopover:(o)=>{if(f?.features?.popovers!==!0)return Promise.reject(new m("UNSUPPORTED","This host does not support popovers."));if(!dt(o))return Promise.reject(new m("HOST_REJECTED","Popover requests need bounded geometry and JSON data."));return F({...X,type:"popover-open",id:v(T),payload:o})},closePopover:Yt,setPopoverAnchorActive:qt,onResolve:(o)=>(ce=o,()=>{if(ce===o)ce=null}),toast:(o)=>{let r=o.message.trim();if(!r||r.length>Xe)return Promise.reject(new m("HOST_REJECTED",`Toast message must contain 1 to ${Xe} characters.`));if(o.copy&&o.copy!==!0&&(!o.copy.text.length||o.copy.text.length>Ve))return Promise.reject(new m("HOST_REJECTED",`Toast copy text must contain 1 to ${Ve} characters.`));return F({channel:R,v:y,type:"toast",id:v(T),payload:{...o,message:r}})},openUrl:(o)=>F({channel:R,v:y,type:"open-url",id:v(T),payload:{url:o}}),openCommit:(o)=>ft(o)?F({channel:R,v:y,type:"open-commit",id:v(T),payload:{sha:o}}):Promise.reject(new m("HOST_REJECTED","Commit id must be 7 to 64 hex characters.")),openSurface:(o)=>F({channel:R,v:y,type:"open-surface",id:v(T),payload:{surfaceId:o}}),writeClipboard:(o)=>F({channel:R,v:y,type:"clipboard-write",id:v(T),payload:{text:o}}),compose:(o)=>F({channel:R,v:y,type:"compose",id:v(T),payload:o}),attach:(o)=>F({channel:R,v:y,type:"attach",id:v(T),payload:ke(o)}),startSession:async(o)=>{if(o.projectId!==void 0)ie(o.projectId);let r=o.worktree;if(r&&r!==!0)if(r.kind==="existing")ie(r.directory);else{if(r.name!==void 0)ie(r.name,200);if(r.baseBranch!==void 0)ie(r.baseBranch,200)}let E=await Z({channel:R,v:y,type:"start-session",id:v(T),payload:St(o)},e.requestTimeoutMs??180000);if(!pt(E))throw new m("HOST_REJECTED","Host did not return a session.");return E},prompt:(o)=>Z({channel:R,v:y,type:"prompt",id:v(T),payload:Tt(o)}).then((r)=>{if(!ut(r))throw new m("HOST_REJECTED","Host did not return a prompt result.");return r}),sessionLink:(o)=>F({channel:R,v:y,type:"session-link",id:v(T),payload:ke(o)}),close:()=>F({channel:R,v:y,type:"close",id:v(T)}),oauthStart:()=>F({channel:R,v:y,type:"oauth-start",id:v(T)}),oauthDisconnect:()=>F({channel:R,v:y,type:"oauth-disconnect",id:v(T)}),request:(o)=>(ze(o.path)?Z({channel:R,v:y,type:"request",id:v(T),payload:o}):wo()).then((r)=>{if(!Je(r))throw new m("HOST_REJECTED","Host request result was empty.");return r}),serviceRequest:(o)=>(ze(o.path)?Z({channel:R,v:y,type:"service-request",id:v(T),payload:o}):wo()).then((r)=>{if(!Je(r))throw new m("HOST_REJECTED","Host service request result was empty.");return r}),serviceStatus:()=>Z({channel:R,v:y,type:"service-status",id:v(T)}).then((o)=>{if(!gt(o))throw new m("HOST_REJECTED","Host did not return service status.");return o}),readFile:(o)=>(Ie(o)?Z({channel:R,v:y,type:"file-read",id:v(T),payload:{path:o}}):Ye()).then((r)=>{if(!xt(r))throw new m("HOST_REJECTED","Host did not return file content.");return r}),writeFile:(o,r)=>{if(!Ie(o))return Ye();if(r.length>je)return Promise.reject(new m("FILE_TOO_LARGE",`Content is over ${je} characters.`));return Z({channel:R,v:y,type:"file-write",id:v(T),payload:{path:o,content:r}}).then((E)=>{if(!vt(E))throw new m("HOST_REJECTED","Host did not confirm the write.");return E})},listDir:(o)=>(Ie(o)?Z({channel:R,v:y,type:"file-list",id:v(T),payload:{path:o}}):Ye()).then((r)=>{if(!Ot(r))throw new m("HOST_REJECTED","Host did not return directory entries.");return r}),stat:(o)=>(Ie(o)?Z({channel:R,v:y,type:"file-stat",id:v(T),payload:{path:o}}):Ye()).then((r)=>{if(!At(r))throw new m("HOST_REJECTED","Host did not return file status.");return r}),generate:(o)=>{let r=o.prompt.trim(),E=o.system?.trim();if(r.length===0||r.length>Ke)return Promise.reject(new m("HOST_REJECTED",`Prompt must be 1 to ${Ke} characters.`));if(E!==void 0&&(E.length===0||E.length>We))return Promise.reject(new m("HOST_REJECTED",`System prompt must be 1 to ${We} characters.`));let S=o.maxOutputTokens===void 0?void 0:Math.min(_t,Math.max(1,Math.floor(o.maxOutputTokens)));if(S!==void 0&&!Number.isFinite(S))return Promise.reject(new m("HOST_REJECTED","maxOutputTokens must be a number."));let G={prompt:r};if(E!==void 0)G.system=E;if(S!==void 0)G.maxOutputTokens=S;return Z({channel:R,v:y,type:"generate",id:v(T),payload:G},e.requestTimeoutMs??ht).then((L)=>{if(!Rt(L))throw new m("HOST_REJECTED","Host did not return generated text.");return L})},onLateGenerateResult:(o)=>{C.add(o);for(let r of N.splice(0))P([o],r);return Pe(),()=>{C.delete(o)}},setBadge:(o)=>F({channel:R,v:y,type:"badge",id:v(T),payload:{count:mt(o)}}),setHeight:(o)=>F({channel:R,v:y,type:"resize",id:v(T),payload:{height:bt(o)}}),onFileOpen:(o)=>{if(Y.add(o),!ue)ue=!0,t.addEventListener("keydown",A,!0);if(W)o(W);return()=>{Y.delete(o)}},onFileSnapshot:(o)=>(k=o,()=>{if(k===o)k=null}),onFileSaved:(o)=>(h.add(o),()=>{h.delete(o)}),reportFileChange:(o)=>c({...X,type:"file-change",payload:{dirty:o.dirty,edited:o.edited}}),requestFileSave:I,reportFileUnsupported:()=>c({...X,type:"file-unsupported"}),dispose:()=>{for(let o of se.keys())ne({...X,type:"workspace-unsubscribe",id:v(T),payload:{subscriptionId:o}});se.clear();for(let o of q.keys())ne({...X,type:"shells-unsubscribe",id:v(T),payload:{subscriptionId:o}});if(q.clear(),Q=!0,ce=null,re=null,k=null,Y.clear(),h.clear(),ue)t.removeEventListener("keydown",A,!0);t.removeEventListener("message",he),t.removeEventListener("keydown",u,!0),t.removeEventListener("pointerover",M),t.removeEventListener("pointermove",M),t.removeEventListener("pointerout",pe),t.removeEventListener("focus",D),t.removeEventListener("blur",Re);for(let o of z.values())clearTimeout(o.timer),o.reject(new m("HOST_UNAVAILABLE","Host client was disposed."));z.clear(),a.clear(),i.clear(),d.clear(),p.clear(),g.clear(),x.clear(),w.clear(),J.clear(),oe.clear(),C.clear(),N.length=0}}};var Uo=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var lr=new Set(Uo);var Co=["none","agent","user"];var ur=new Set(Co);var fn=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],En=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],No=(e,t)=>{t.style.colorScheme=e.mode;for(let[n,s]of fn)t.style.setProperty(n,e.tokens[s]);for(let[n,s,a]of En){let i=e.tokens[a]??"";t.style.setProperty(n,i),t.style.setProperty(s,i)}t.style.setProperty("font-family",e.tokens.font),t.style.setProperty("font-size","0.875rem"),t.style.setProperty("line-height","1.45"),t.style.setProperty("color",e.tokens.foreground)},It=(e,t)=>{if(No(e.theme,t),t.dataset)t.dataset.ocSurface=e.surface,t.dataset.ocTheme=e.theme.mode};var _n={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},H=(e,t)=>`var(--${e}, var(--oc-${_n[e]}, ${t}))`,_e=H("surface-background","transparent"),Ze=H("surface-elevated","transparent"),we=H("surface-elevated-foreground","inherit"),de=H("surface-foreground","inherit"),V=H("surface-muted-foreground","gray"),hn=H("surface-muted","transparent"),be=H("interactive-border","currentColor"),ae=H("interactive-hover","transparent"),ge=H("interactive-active","transparent"),wt=H("interactive-selection","transparent"),Ut=H("interactive-selection-foreground","inherit"),Ee=H("primary","currentColor"),Ct=H("primary-text","inherit"),Nt=H("error-text","inherit"),Sn=H("font-sans","inherit"),Mt=H("font-mono","monospace"),Do=H("radius","9px"),Lt=`calc(${Do} - 2px)`,Mo=`calc(${Do} - 4px)`,B=(e,t,n="transparent")=>`color-mix(in srgb, ${e} ${t}%, ${n})`,Lo=`background-image: linear-gradient(${ae}, ${ae});`,Pt=(e,t="0.5px")=>`box-shadow: inset 0 0 0 ${t} ${e}, var(--oc-sdk-field-lift);`,Dt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Po="box-shadow: var(--oc-sdk-lit);",Gt=`inset 0 0.5px 0 0 ${B(de,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,Tn=`
:root {
  --oc-sdk-edge: ${B(de,16)};
  --oc-sdk-field-bg: ${Ze};
  --oc-sdk-raised-bg: ${_e};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${B(de,14)};
  --oc-sdk-field-bg: ${B(_e,50,Ze)};
  --oc-sdk-raised-bg: ${Ze};
  --oc-sdk-field-lift: ${Gt};
  --oc-sdk-raised-lift: ${Gt};
  --oc-sdk-lit: ${Gt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,Qe=(e)=>{let t=H(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${t}; --oc-sdk-tone-text: ${H(`${e}-text`,"inherit")}; }`},mn=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: 6px; height: 28px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: 4px; height: 24px; padding: 0 8px; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: 8px 10px; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 28px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: 14px; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: 2px; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; }
`,Go=`${Tn}
.oc-sdk { color: ${de}; font-family: ${Sn}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${Lo} }
.oc-sdk-mono { font-family: ${Mt}; }
.oc-sdk-muted { color: ${V}; }
${Qe("success")}${Qe("warning")}${Qe("error")}${Qe("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${Ee}; --oc-sdk-tone-text: ${Ct}; }

.oc-sdk-btn { border-radius: ${Lt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Mo}; }
.oc-sdk-btn[data-variant="default"] { color: ${Ct}; background: ${B(Ee,10,_e)}; border-color: ${B(Ee,12)}; ${Po} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${B(Ee,16,_e)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${B(Ee,22,_e)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${hn}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${ae}, ${ae}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${ge}, ${ge}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${we}; ${Dt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${ae}, ${ae}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${ge}, ${ge}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${ae}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${ge}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${H("status-error","red")}; color: ${Nt}; background: ${B("var(--oc-sdk-tone)",7,_e)}; border-color: ${B("var(--oc-sdk-tone)",12)}; ${Po} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${B("var(--oc-sdk-tone)",9,_e)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${B("var(--oc-sdk-tone)",11,_e)}; box-shadow: none; }

.oc-sdk-field-note { color: ${V}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${Nt}; }
.oc-sdk-input { border-radius: ${Lt}; background: var(--oc-sdk-field-bg); color: ${we}; ${Pt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${V}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${ae}, ${ae}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${Pt(B(de,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${Pt(H("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${Mt}; }

.oc-sdk-search-icon { color: ${V}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${Ee}; }
.oc-sdk-search-clear { border-radius: ${Mo}; color: ${V}; }
.oc-sdk-search-clear:hover { background: ${ae}; color: ${de}; }

.oc-sdk-trigger { border-radius: ${Lt}; background: var(--oc-sdk-raised-bg); color: ${we}; ${Dt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${ae}, ${ae}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${ge}, ${ge}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${V}; }
.oc-sdk-trigger-chevron { color: ${V}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${we}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${Ze}; background-clip: padding-box; color: ${we}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${ae}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${wt}; color: ${Ut}; }
.oc-sdk-option-check { color: ${de}; }
.oc-sdk-option[data-destructive="true"] { color: ${Nt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${B(H("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${V}; }
.oc-sdk-popup-empty { color: ${V}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${be}; border-radius: 4px; color: ${de}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${B(de,60,be)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${be}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${_e}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${Ee}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${Lo} }
.oc-sdk-check-desc { color: ${V}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${B(de,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${V}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${de}; }
.oc-sdk-tab[aria-selected="true"] { color: ${Ut}; background: ${wt}; border-color: ${be}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${we}; background: var(--oc-sdk-raised-bg); ${Dt} }
.oc-sdk-tab-count { color: ${V}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${B(de,6)}; color: ${V}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${B("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${ae}; }
.oc-sdk-row[aria-selected="true"] { background: ${wt}; color: ${Ut}; }
.oc-sdk-row-lead { font-family: ${Mt}; color: ${V}; }
.oc-sdk-row-sub { color: ${V}; }
.oc-sdk-row-meta { color: ${V}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${V}; }

.oc-sdk-empty-body { color: ${V}; }

.oc-sdk-spinner { color: ${V}; }
.oc-sdk-spinner-ring { border-color: ${be}; border-top-color: ${Ee}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${B("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${V}; }

.oc-sdk-separator { color: ${V}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${B(be,40)}; }

.oc-sdk-progress-label { color: ${V}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${B(de,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${Ee}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${H("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${H("success-text","inherit")}; }

.oc-sdk-text a { color: ${Ct}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${B(be,60)}; }
`,ee=`
${ot}
${mn}
${Go}`;var Ho="oc-sdk-ui-style",xe=(e)=>{while(e.firstChild)e.removeChild(e.firstChild)},te=(e)=>{let t=document.getElementById(Ho);if(t instanceof HTMLStyleElement){if(t.textContent!==e)t.textContent=e;return}nt(document);let n=document.createElement("style");n.id=Ho,n.textContent=e,document.head.appendChild(n)},U=(e,t)=>{let n=document.createElement(e);if(t)n.className=t;return n},fe=(e)=>{let t=U("button",e);return t.type="button",t},le=(e,t)=>{let n=t??"";if(e.textContent!==n)e.textContent=n},ve=(e,t,n)=>{if(n===void 0||n===null||n==="")e.removeAttribute(t);else if(e.getAttribute(t)!==n)e.setAttribute(t,n)},$o=(e,t)=>{let n=(s)=>{if(s.target instanceof Node&&e.contains(s.target))return;t()};return document.addEventListener("pointerdown",n,!0),()=>{document.removeEventListener("pointerdown",n,!0)}};var bn={search:"M18.031 16.617l4.283 4.282-1.415 1.415-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9 9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617zm-2.006-.742A6.977 6.977 0 0 0 18 11c0-3.868-3.133-7-7-7-3.868 0-7 3.132-7 7 0 3.867 3.132 7 7 7a6.977 6.977 0 0 0 4.875-1.975l.15-.15z",chevron:"M12 13.172l4.95-4.95 1.414 1.414L12 16 5.636 9.636 7.05 8.222z",check:"M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z",close:"M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z"},Oe=(e,t,n)=>{let s=document.createElementNS("http://www.w3.org/2000/svg","svg");if(s.setAttribute("viewBox","0 0 24 24"),s.setAttribute("width",String(t)),s.setAttribute("height",String(t)),s.setAttribute("aria-hidden","true"),s.setAttribute("fill","currentColor"),n)s.setAttribute("class",n);let a=document.createElementNS("http://www.w3.org/2000/svg","path");return a.setAttribute("d",bn[e]),s.append(a),s};var Se=(e,t="vertical")=>{let[n,s]=t==="vertical"?["ArrowDown","ArrowUp"]:["ArrowRight","ArrowLeft"];if(e.key===n||e.ctrlKey&&e.key.toLowerCase()==="n")return"next";if(e.key===s||e.ctrlKey&&e.key.toLowerCase()==="p")return"previous";if(e.key==="Home")return"first";if(e.key==="End")return"last";return null},Ae=(e,t,n)=>{let s=e.filter((g)=>!g.disabled);if(s.length===0)return null;let a=s[0],i=s[s.length-1];if(n==="first"||!a||!i)return a?.id??null;if(n==="last")return i.id;let d=s.findIndex((g)=>g.id===t);if(d===-1)return n==="next"?a.id:i.id;return s[Math.min(s.length-1,Math.max(0,d+(n==="next"?1:-1)))]?.id??null};var Fo=(e,t)=>`${e}-${t??""}`,Ht=(e,t,n,s)=>{let a=fe("oc-sdk-option");if(a.id=Fo(e,n.id),a.setAttribute("role",t),a.tabIndex=-1,a.disabled=Boolean(n.disabled),t==="option")a.setAttribute("aria-selected",n.selected?"true":"false");a.dataset.destructive=n.destructive?"true":"false";let i=U("span","oc-sdk-option-label");if(i.textContent=n.label,a.append(i),n.hint){let d=U("span","oc-sdk-option-hint");d.textContent=n.hint,a.append(d)}if(t==="option"){a.dataset.mark="check";let d=U("span","oc-sdk-option-check");d.append(Oe("check",14)),a.append(d)}return a.addEventListener("pointerenter",s.hover),a.addEventListener("click",s.pick),a},$t=(e,t,n,s)=>{let a=Fo(n,s);for(let i of Array.from(e.children))if(i instanceof HTMLElement&&i.classList.contains("oc-sdk-option"))i.dataset.active=i.id===a?"true":"false";ve(t,"aria-activedescendant",s?a:null),e.querySelector('[data-active="true"]')?.scrollIntoView({block:"nearest"})};var gn=(e,t)=>{let n=t.getBoundingClientRect();e.style.minWidth=`${Math.round(n.width)}px`,e.style.left=`${Math.round(n.left)}px`,e.style.top=`${Math.round(n.bottom+4)}px`;let s=e.offsetHeight,a=window.innerHeight-n.bottom-8;if(s>a&&n.top-8>a)e.style.top=`${Math.max(8,Math.round(n.top-4-s))}px`;let i=n.left+e.offsetWidth-window.innerWidth+8;if(i>0)e.style.left=`${Math.max(8,Math.round(n.left-i))}px`},Ft=(e,t,n,s)=>{e.append(n),gn(n,t);let a=$o(e,s),i=()=>{s()},d=(p)=>{if(p.target instanceof Node&&n.contains(p.target))return;s()};return window.addEventListener("resize",i),window.addEventListener("scroll",d,!0),()=>{a(),window.removeEventListener("resize",i),window.removeEventListener("scroll",d,!0),n.remove()}};var Xo=(e,t)=>{let n=t.trim().toLowerCase();if(!n)return[...e];return e.filter((s)=>s.label.toLowerCase().includes(n)||s.id.toLowerCase().includes(n))},xn=0,Xt=(e,t)=>{te(ee);let n=t,s=`oc-sdk-select-${xn+=1}`,a=U("div","oc-sdk oc-sdk-select"),i=U("span","oc-sdk-field-label");i.id=`${s}-label`;let d=fe("oc-sdk-trigger");d.setAttribute("aria-haspopup","listbox"),d.setAttribute("aria-labelledby",i.id);let p=U("span","oc-sdk-trigger-value");d.append(p,Oe("chevron",14,"oc-sdk-trigger-chevron")),a.append(i,d),e.append(a);let g="",x=null,w=null,J=U("div","oc-sdk oc-sdk-popup"),oe=U("div","oc-sdk-popup-search"),C=U("input","oc-sdk-input");C.type="text",C.autocomplete="off",oe.append(C);let N=U("div");N.setAttribute("role","listbox"),N.tabIndex=-1,J.append(N);let ce=()=>Xo(n.options,n.searchable?g:""),re=()=>n.searchable?C:N,Y=(b)=>{x=b,$t(N,re(),s,b)},h=()=>{xe(N);let b=ce();if(b.length===0){let O=U("div","oc-sdk-popup-empty");O.textContent="No matches",N.append(O)}for(let O of b)N.append(Ht(s,"option",{...O,selected:O.id===n.value},{hover:()=>Y(O.id),pick:()=>ue(O.id)}));Y(b.some((O)=>O.id===x)?x:b[0]?.id??null)},k=()=>{let b=w;w=null,b?.(),g="",C.value="",d.setAttribute("aria-expanded","false")},W=()=>{if(w||n.disabled)return;if(x=n.value,C.placeholder=n.searchPlaceholder??"Search",n.searchable)J.prepend(oe);else oe.remove();h(),w=Ft(a,d,J,k),d.setAttribute("aria-expanded","true"),re().focus()},ue=(b)=>{if(k(),d.focus(),b!==n.value)n.onChange(b)},z=()=>{if(w)k();else W()},se=(b)=>{if(!w&&Se(b))b.preventDefault(),W()},q=(b)=>{let O=Se(b);if(O)b.preventDefault(),Y(Ae(ce(),x,O));else if(b.key==="Enter"){if(b.preventDefault(),x)ue(x)}else if(b.key==="Escape")b.preventDefault(),k(),d.focus();else if(n.searchable&&b.target!==C&&b.key.length===1&&!b.ctrlKey&&!b.metaKey)C.focus()},Q=()=>{g=C.value,h()},T=(b)=>{if(w&&!(b.relatedTarget instanceof Node&&a.contains(b.relatedTarget)))k()},f=()=>{le(i,n.label),i.hidden=!n.label;let b=n.options.find((O)=>O.id===n.value);if(le(p,b?.label??n.placeholder??"Select"),p.dataset.empty=b?"false":"true",d.disabled=Boolean(n.disabled),w)h()};return d.addEventListener("click",z),d.addEventListener("keydown",se),J.addEventListener("keydown",q),C.addEventListener("input",Q),a.addEventListener("focusout",T),f(),{update:(b)=>{n={...n,...b},f()},dispose:()=>{k(),d.removeEventListener("click",z),d.removeEventListener("keydown",se),J.removeEventListener("keydown",q),C.removeEventListener("input",Q),a.removeEventListener("focusout",T),a.remove()}}};var Vt=(e,t)=>{te(ee);let n=t,s=U("div","oc-sdk oc-sdk-tabs");s.setAttribute("role","tablist"),e.append(s);let a=()=>{xe(s),s.dataset.track=n.trackBackground?"true":"false";for(let d of n.items){let p=fe("oc-sdk-tab");p.setAttribute("role","tab");let g=d.id===n.activeId;p.setAttribute("aria-selected",g?"true":"false"),p.tabIndex=g?0:-1,p.dataset.id=d.id;let x=U("span");if(x.textContent=d.label,p.append(x),d.count!==void 0){let w=U("span","oc-sdk-tab-count");w.textContent=String(d.count),p.append(w)}p.addEventListener("click",()=>{if(d.id!==n.activeId)n.onChange(d.id)}),s.append(p)}},i=(d)=>{let p=Se(d,"horizontal");if(!p)return;let g=Ae(n.items,n.activeId,p);if(g&&g!==n.activeId){d.preventDefault(),n.onChange(g);let x=s.querySelector(`[data-id="${CSS.escape(g)}"]`);if(x instanceof HTMLElement)x.focus()}};return s.addEventListener("keydown",i),a(),{update:(d)=>{n={...n,...d},a()},dispose:()=>{s.removeEventListener("keydown",i),s.remove()}}};function On(e){return{claimEvidence:e.some((t)=>typeof t.claimed==="boolean"),forkEvidence:e.some((t)=>typeof t.fork==="boolean"),scheduledEvidence:e.some((t)=>typeof t.scheduled==="boolean"),pendingFormEvidence:e.some((t)=>typeof t.pendingForm==="boolean")}}function An(e){let t=[],n=e.coverage.filter((s)=>s.state!=="ready");if(n.length>0)t.push({id:"coverage",label:"inventory incomplete",text:`${n.length} director${n.length===1?"y":"ies"} still ${n.map((s)=>`${s.state} (${s.directory})`).join(", ")} — an empty view here is not proof of zero sessions.`});if(!e.claimEvidence)t.push({id:"orphaned",label:"orphaned: unknown",text:"this host exposes no execution-claim state, so claimed-but-idle sessions cannot be detected. The orphan arm of needs-restart is unevaluable; never read that view as zero orphans."});if(!e.forkEvidence)t.push({id:"fork",label:"fork: unknown",text:"no fork flag on the workspace record, so the default proxy cannot exclude forked roots (it widens instead of hiding rows)."});if(!e.scheduledEvidence)t.push({id:"scheduled",label:"scheduled: unknown",text:"no metadata source — a scheduled session that was never labelled is indistinguishable from a user-started one (the widening views.json documents for the default proxy)."});return t.push({id:"outcome",label:"interrupted: never",text:"the host vocabulary is completed | failed | null, so `interrupted` (the second arm of needs-restart) can never match from this source."}),t}function Vo(e,t){let n=!1,s=[],a=new Map,i=null,d=()=>{if(n)return;let p=[],g=[];for(let N of a.values())p.push(...N.sessions),g.push(...N.coverage);let x=[...a.values()].map((N)=>N.state),w=x.length>0&&x.every((N)=>N==="ready"),J=x.length===0||x.some((N)=>N==="loading"),oe=i?"error":w?"ready":J?"loading":"ready",C={records:p,coverage:g,...On(p)};t({state:oe,...C,gaps:An(C),...i?{error:i}:{}})};return(async()=>{try{let p=await e.listProjects();if(n)return;for(let g of p.projects){if(n)return;let x=await e.onSessions(g.id,(w)=>{if(n)return;a.set(g.id,w),d()});s.push(x)}d()}catch(p){if(n)return;i=p instanceof Error?p.message:String(p),d()}})(),()=>{n=!0;for(let p of s)try{p()}catch{}}}var Bo={$comment:"Single declarative definition of the status projection's filter vocabulary and named views. Read by src/lib/status.ts and scripts/tree-status.mjs; neither hardcodes a view or a filter.",version:1,sources:{inventory:"session_v2 in the OpenCode SQLite database, paged newest-first and capped (default 2000, --all to ignore).",live:"Host endpoints /api/session/active (running ids) and /api/sessions/status (per-session status + pending[sid].forms). The host is the only cross-project source of pending forms.",notARecord:'Optional fields are omitted when unset. An absent field means null, never "unknown".'},operators:{$any:"Disjunction inside a view's filter set: a non-empty array of sub-filter sets; the session matches when ANY sub-set matches. Every other key in a filter set is conjoined. Used by needs-restart to combine the outcome arm with the orphan arm."},sort:{default:{field:"lastActivity",direction:"desc"},tiebreak:{field:"id",direction:"asc"},fields:{lastActivity:"max(time_updated, time_idle) as epoch milliseconds; null when both are absent.",depth:"Distance from the tree root; a root is 0.",id:"Session id, used only as a stable tiebreak."}},filters:{isRoot:{type:"boolean",derived:"parentId === null",description:"True when the session has no parent row."},hasParent:{type:"boolean",derived:"parentId !== null",description:"True when the session has a parent row."},parentId:{type:"string",derived:"session_v2.parent_id",description:"Direct parent session id, when one exists."},rootId:{type:"string",derived:"walk parent_id to the top of the chain",description:"Id of the tree root this session belongs to. Self for a root."},depth:{type:"integer | { min?: integer, max?: integer }",derived:"number of parent hops to the root",description:"A number matches exactly; an object matches an inclusive range."},inTree:{type:"boolean",derived:"hasParent || childCount > 0",description:"True when the session participates in a tree at all, rather than standing alone."},isSubtreeOf:{type:"string",derived:"anchor === id || anchor is an ancestor of id",description:"Self-inclusive: a session belongs to its own subtree. Backs the subtree:<id> view."},isLeaf:{type:"boolean",derived:"childCount === 0",description:"True when no session names this session as its parent, checked against the whole session table rather than only the capped page."},status:{type:'"running" | "idle" | "unknown" | array of those',derived:"live running set, else host sessions[sid].status, else DB time_idle / idle_outcome",description:"Run state. running means a turn is in flight or the session holds the execution claim; a paused session still reports running. idle means the session has completed a turn. unknown means neither source carries evidence. archived is a separate filter and is not folded into status."},hasPendingForm:{type:"boolean",derived:"pending[sid].forms is non-empty on the host",description:"True only when the host reports at least one pending form for the session. Requires the live source; DB-only projections report it as false and set meta.stale, because absence of evidence is not evidence of absence."},archived:{type:"boolean",derived:"time_archived !== null",description:"Archive flag, independent of status."},claimed:{type:"boolean",derived:"time_suspended !== null",description:"Holds an execution claim. SessionStore.claim sets time_suspended when a turn starts, so a paused session reports claimed even though its status is running. claimed true with status idle is a claim left behind by a turn that is no longer live — the orphan case that core never auto-resumes (see F-36). See `orphaned` for the derived form needs-restart's orphan arm uses."},orphaned:{type:"boolean (tri-state: true | false | null)",derived:"claimed ∧ ¬running, where running means the session appears in the host's GET /api/session/active set",description:"True when a row holds an execution claim but the host does not list it as active — an orphaned claim that core never auto-resumes. false when the row holds no claim (knowable from the database alone) or the host lists the session. null when the row is claimed but the host was not read: unknown is never reported as false, and the projection sets meta.stale plus an orphan-detection warning instead of listing zero. Requires the live source."},project:{type:"string",derived:"session_v2.project_id",description:"Project id the session belongs to."},lastActivity:{type:"epoch-ms | ISO-8601 | { after?: value, before?: value }",derived:"max(time_updated, time_idle)",description:"A single value is an inclusive lower bound; an object bounds the range with inclusive after and exclusive before."},outcome:{type:'"succeeded" | "failed" | "interrupted" | "none" | array of those',derived:"session_v2.idle_outcome",description:'Terminal outcome recorded by the engine. Required by needs-restart, which must not invent a failure state for sessions that recorded none. "none" matches a null idle_outcome.'},fork:{type:"boolean",derived:"fork_session_id !== null",description:"True when the session was forked from another session. Required by the default view's documented proxy."},scheduled:{type:"boolean",derived:'metadata.openchamber.kind === "scheduled"',description:"True only when the metadata explicitly marks the session scheduled. An absent metadata object is not scheduled; nothing is inferred from titles or timing. Required by the default view's documented proxy."},userSpawned:{unavailable:!0,type:"boolean",reason:"No source exists. session_v2 has no spawn-provenance column (checked all 36 columns), metadata is null for every row in the live database, and neither /api/session/active nor /api/sessions/status reports who created a session. Any boolean would be a guess, so the field is absent from every projected session and the projection reports it under meta.unavailable."},waveIndex:{unavailable:!0,type:"integer",reason:'No source exists. Wave or batch membership is not recorded on session_v2 or by the host; only parent links, creation order and depth are observable. depth answers "how deep", not "which wave", so the field is absent and reported under meta.unavailable.'}},views:{default:{filters:{isRoot:!0,fork:!1,scheduled:!1},sort:{field:"lastActivity",direction:"desc"},isProxy:!0,proxyNote:`Documented proxy: root ∧ ¬fork ∧ metadata.openchamber.kind ≠ 'scheduled'. Upstream exposes no user-spawned flag, so this triple is the closest available approximation of "a conversation the user started". A session with no metadata counts as not scheduled, which widens the view rather than hiding rows; a scheduled session that was never labelled is indistinguishable from a user one.`},running:{filters:{status:"running"},sort:{field:"lastActivity",direction:"desc"}},"needs-restart":{filters:{archived:!1,$any:[{outcome:["failed","interrupted"]},{orphaned:!0}]},sort:{field:"lastActivity",direction:"desc"},note:"Restart candidates are non-archived sessions that either recorded a failed or interrupted outcome, or hold an orphaned claim (claimed but absent from the host's active set). A session with no recorded idle_outcome is never listed through the outcome arm: absence of an outcome is not a failure. When the host is unreachable the orphan arm cannot be evaluated — orphaned is unknown, meta.stale is true, and the projection warns that orphan detection is unavailable rather than reporting zero."},"question-paused":{filters:{status:"running",hasPendingForm:!0},sort:{field:"lastActivity",direction:"desc"},note:"Both filters are required. A paused session reports running and holds the execution claim, so status alone cannot find it. A pending form whose turn has ended (form present, idle_outcome succeeded) does not qualify: it is a stale form, not a pause. This view is the verification surface for pause/resume (src/lib/pause.ts): tree.pause reports `paused` only after a NEW pending form and the execution claim are both observed — i.e. the session matches this view — and tree.resume reports `resumed` only after the form has left the pending set — i.e. the session has left it."},tree:{filters:{rootId:"$root"},sort:{field:"lastActivity",direction:"desc"},parameters:["root"],note:"Every session in one tree, including the root itself. Selected with --root <id>."},subtree:{filters:{isSubtreeOf:"$subtree"},sort:{field:"lastActivity",direction:"desc"},parameters:["subtree"],note:"One session and everything beneath it. Selected with --subtree <id>."}}};var j=Bo;function jt(e,t={}){let n=e.trim();if(n.startsWith("tree:")){let i=n.slice(5).trim();if(!i)return{name:n,filters:{},sort:j.views.tree?.sort??j.sort.default,skipped:"view tree:<rootId> requires a root id"};return{name:n,filters:{rootId:i},sort:j.views.tree?.sort??j.sort.default}}if(n.startsWith("subtree:")){let i=n.slice(8).trim();if(!i)return{name:n,filters:{},sort:j.views.subtree?.sort??j.sort.default,skipped:"view subtree:<id> requires a session id"};return{name:n,filters:{isSubtreeOf:i},sort:j.views.subtree?.sort??j.sort.default}}let s=j.views[n];if(!s)throw Error(`unknown view: ${n} (known: ${Object.keys(j.views).join(", ")})`);let a={};for(let[i,d]of Object.entries(s.filters))if(d==="$root"){if(!t.rootId)return{name:n,filters:{},sort:s.sort,skipped:"view requires a root id"};a[i]=t.rootId}else if(d==="$subtree"){if(!t.subtreeOf)return{name:n,filters:{},sort:s.sort,skipped:"view requires a session id"};a[i]=t.subtreeOf}else a[i]=d;return{name:n,filters:a,sort:s.sort}}function Kt(e){let t=[];for(let[n,s]of Object.entries(e)){if(n==="$any"&&Array.isArray(s)){t.push(`(${yn(s)})`);continue}if(s===!1)t.push(`¬${n}`);else if(s===!0)t.push(n);else t.push(`${n} = ${kn(s)}`)}return t.length>0?t.join(" ∧ "):"no filters"}function yn(e){return e.map((t)=>Kt(t)).join(" ∨ ")}function kn(e){if(Array.isArray(e))return e.map((t)=>JSON.stringify(t)).join(" | ");if(typeof e==="object"&&e!==null)return JSON.stringify(e);if(e===!1)return"false";if(e===!0)return"true";return JSON.stringify(e)}var In=256;function wn(e){switch(e){case"running":case"retrying":case"waiting-permission":case"waiting-question":return"running";case"idle":return"idle";default:return"unknown"}}function Un(e){if(e==="completed")return"succeeded";if(e==="failed")return"failed";return"none"}function Ko(e){let t=new Map(e.map((i)=>[i.id,i])),n=new Map;for(let i of e){if(!i.parentId)continue;n.set(i.parentId,(n.get(i.parentId)??0)+1)}let s=new Map,a=(i)=>{let d=s.get(i);if(d)return d;let p=[i],g=new Set([i]),x=t.get(i)?.parentId??null;while(x&&!g.has(x)&&p.length<In)p.push(x),g.add(x),x=t.get(x)?.parentId??null;return s.set(i,p),p};return e.map((i)=>{let d=a(i.id),p=n.get(i.id)??0,g=wn(i.activity),x=typeof i.claimed==="boolean"?i.claimed:null,w=typeof i.pendingForm==="boolean",J=i.activity==="waiting-question"||i.pendingForm===!0,oe=x===null?null:x?g==="running"?!1:g==="idle"?!0:null:!1;return{id:i.id,title:i.title,projectId:i.projectId,directory:i.directory,activity:i.activity,parentId:i.parentId,chain:d,rootId:d[d.length-1]??i.id,depth:Math.max(0,d.length-1),childCount:p,isRoot:i.parentId===null,hasParent:i.parentId!==null,inTree:i.parentId!==null||p>0,isLeaf:p===0,status:g,archived:i.archivedAt!==null,claimed:x,fork:i.fork===!0,forkKnown:typeof i.fork==="boolean",scheduled:i.scheduled===!0,scheduledKnown:typeof i.scheduled==="boolean",hasPendingForm:J,pendingFormKnown:w,paused:g==="running"&&i.activity==="waiting-question",outcome:Un(i.outcome),outcomeRaw:i.outcome,lastActivity:Math.max(i.updatedAt??0,i.createdAt??0)||null,createdAt:i.createdAt,updatedAt:i.updatedAt,orphaned:oe}})}function Wo(e){return Array.isArray(e)?e.map(String):[String(e)]}function Wt(e){if(typeof e==="number"&&Number.isFinite(e))return e;if(typeof e==="string"&&e.trim().length){let t=Date.parse(e);return Number.isFinite(t)?t:null}return null}function Cn(e,t){if(typeof t==="number")return e===t;if(t&&typeof t==="object"){let n=t;if(typeof n.min==="number"&&e<n.min)return!1;if(typeof n.max==="number"&&e>n.max)return!1;return!0}return!0}function Nn(e,t){return Wo(t).map((s)=>s.toLowerCase()).includes(e.outcome.toLowerCase())}function Mn(e,t){if(t&&typeof t==="object"&&!(t instanceof Date)){let s=t,a=s.after===void 0?null:Wt(s.after),i=s.before===void 0?null:Wt(s.before);if(a!==null&&(e.lastActivity===null||e.lastActivity<a))return!1;if(i!==null&&(e.lastActivity===null||e.lastActivity>=i))return!1;return!0}let n=Wt(t);if(n===null)return!0;return e.lastActivity!==null&&e.lastActivity>=n}function Ce(e,t,n){for(let[s,a]of Object.entries(t)){if(s==="$any"){if(!Array.isArray(a)||a.length===0)throw Error("$any expects a non-empty array of filter sets");if(!a.some((p)=>{if(!p||typeof p!=="object"||Array.isArray(p))throw Error("$any expects an array of filter sets");return Ce(e,p,n)}))return!1;continue}let i=n.views.filters[s];if(!i)throw Error(`unknown filter: ${s}`);if(i.unavailable)throw Error(`filter ${s} is unavailable: ${i.reason??"no source"}`);switch(s){case"isRoot":if(e.isRoot!==Boolean(a))return!1;break;case"hasParent":if(e.hasParent!==Boolean(a))return!1;break;case"parentId":if(e.parentId!==String(a))return!1;break;case"rootId":if(e.rootId!==String(a))return!1;break;case"depth":if(!Cn(e.depth,a))return!1;break;case"inTree":if(e.inTree!==Boolean(a))return!1;break;case"isSubtreeOf":if(!e.chain.includes(String(a)))return!1;break;case"isLeaf":if(e.isLeaf!==Boolean(a))return!1;break;case"status":if(!Wo(a).includes(e.status))return!1;break;case"hasPendingForm":if(e.hasPendingForm!==Boolean(a))return!1;break;case"archived":if(e.archived!==Boolean(a))return!1;break;case"claimed":if(e.claimed!==Boolean(a))return!1;break;case"orphaned":if(e.orphaned!==Boolean(a))return!1;break;case"project":if(e.projectId!==String(a))return!1;break;case"lastActivity":if(!Mn(e,a))return!1;break;case"outcome":if(!Nn(e,a))return!1;break;case"fork":if(e.fork!==Boolean(a))return!1;break;case"scheduled":if(e.scheduled!==Boolean(a))return!1;break;default:throw Error(`filter ${s} is declared but not implemented`)}}return!0}function zo(e,t){let n=j.sort.tiebreak;return[...e].sort((s,a)=>{let i=t.direction==="asc"?1:-1,d=jo(s,t.field),p=jo(a,t.field);if(d!==p)return d<p?-i:i;let g=n.direction==="asc"?1:-1;return s.id<a.id?-g:s.id>a.id?g:0})}function zt(e){return[...e].sort((t,n)=>{if(t.depth!==n.depth)return t.depth-n.depth;let s=t.lastActivity??0,a=n.lastActivity??0;if(s!==a)return a-s;return t.id<n.id?-1:t.id>n.id?1:0})}function jo(e,t){switch(t){case"depth":return e.depth;case"id":return e.id;case"lastActivity":return e.lastActivity??Number.NEGATIVE_INFINITY;default:return e.lastActivity??Number.NEGATIVE_INFINITY}}var Jo=`
.ov-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  font-family: var(--oc-font, system-ui, sans-serif);
  font-size: 14px;
  color: var(--oc-fg);
  background: var(--oc-bg);
}
.ov-shell * { box-sizing: border-box; }

.ov-header {
  padding: 14px 16px 0;
  border-bottom: 1px solid var(--oc-border);
  background: var(--oc-bg);
}
.ov-titlebar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.ov-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.ov-subtitle {
  color: var(--oc-muted);
  font-size: 12px;
  margin-left: 8px;
  font-weight: 400;
}
.ov-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.ov-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--oc-border);
  background: var(--oc-muted-surface);
  color: var(--oc-muted);
  white-space: nowrap;
}
button.ov-chip { cursor: pointer; font-family: inherit; }
button.ov-chip:hover { background: var(--oc-hover); color: var(--oc-fg); }
.ov-chip[data-tone="warning"] {
  border-color: color-mix(in srgb, var(--oc-warning) 60%, transparent);
  color: var(--oc-warning-text);
  background: color-mix(in srgb, var(--oc-warning) 14%, transparent);
}
.ov-chip[data-tone="error"] {
  border-color: color-mix(in srgb, var(--oc-error) 60%, transparent);
  color: var(--oc-error-text);
  background: color-mix(in srgb, var(--oc-error) 14%, transparent);
}
.ov-chip[data-tone="success"] {
  border-color: color-mix(in srgb, var(--oc-success) 55%, transparent);
  color: var(--oc-success-text);
  background: color-mix(in srgb, var(--oc-success) 14%, transparent);
}
.ov-chip[data-tone="info"] {
  border-color: color-mix(in srgb, var(--oc-info) 55%, transparent);
  color: var(--oc-info-text);
  background: color-mix(in srgb, var(--oc-info) 14%, transparent);
}
.ov-chip[data-tone="neutral"] { color: var(--oc-muted); }

.ov-switcher {
  margin-top: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
.ov-viewline {
  display: flex;
  gap: 8px 10px;
  flex-wrap: wrap;
  align-items: center;
  padding: 9px 16px 0;
  font-size: 12px;
  color: var(--oc-muted);
}
.ov-filters {
  font-family: var(--oc-mono, ui-monospace, monospace);
  color: var(--oc-fg);
  font-size: 12px;
}

.ov-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 16px 8px;
  gap: 10px;
}

.ov-proxy {
  border: 1px dashed color-mix(in srgb, var(--oc-warning) 70%, transparent);
  background: color-mix(in srgb, var(--oc-warning) 10%, transparent);
  border-radius: var(--oc-radius, 8px);
  padding: 10px 12px;
}
.ov-proxy-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--oc-warning-text);
}
.ov-proxy-body {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--oc-fg);
}
.ov-proxy-body code {
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 12px;
  background: var(--oc-muted-surface);
  border: 1px solid var(--oc-border);
  border-radius: 4px;
  padding: 0 4px;
}

.ov-gaps {
  border: 1px solid var(--oc-border);
  background: var(--oc-elevated);
  border-radius: var(--oc-radius, 8px);
  padding: 9px 12px;
}
.ov-gaps-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--oc-fg);
}
.ov-gaps ul {
  margin: 7px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ov-gaps li {
  font-size: 12px;
  line-height: 1.45;
  color: var(--oc-muted);
}
.ov-gaps li strong { color: var(--oc-warning-text); font-weight: 600; }
.ov-gaps li[data-tone="muted"] strong { color: var(--oc-muted); }

.ov-note {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--oc-muted);
  border-left: 2px solid var(--oc-border);
  padding-left: 9px;
}
.ov-note strong { color: var(--oc-fg); font-weight: 600; }
.ov-note[data-tone="warning"] { border-left-color: var(--oc-warning); }
.ov-note[data-tone="warning"] strong { color: var(--oc-warning-text); }

.ov-anchor {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--oc-muted);
}
.ov-anchor > .oc-sdk { min-width: 240px; max-width: 340px; }

.ov-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ov-row {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border: 1px solid var(--oc-border);
  background: var(--oc-elevated);
  border-radius: calc(var(--oc-radius, 8px) - 2px);
  padding: 8px 10px;
}
.ov-row:hover { background: var(--oc-hover); border-color: var(--oc-primary); }
.ov-row:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
.ov-row[data-indent="true"] {
  padding-left: calc(10px + var(--d, 0) * 18px);
  position: relative;
}
.ov-row[data-indent="true"][style*="--d:0"] { padding-left: 10px; }
.ov-row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ov-id {
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--oc-info-text);
  white-space: nowrap;
}
.ov-row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--oc-fg);
  flex: 1 1 auto;
  min-width: 120px;
  overflow-wrap: anywhere;
}
.ov-badges { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.ov-badge {
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  border: 1px solid var(--oc-border);
  background: var(--oc-muted-surface);
  color: var(--oc-muted);
  white-space: nowrap;
}
.ov-badge[data-tone="success"] {
  color: var(--oc-success-text);
  border-color: color-mix(in srgb, var(--oc-success) 55%, transparent);
  background: color-mix(in srgb, var(--oc-success) 13%, transparent);
}
.ov-badge[data-tone="warning"] {
  color: var(--oc-warning-text);
  border-color: color-mix(in srgb, var(--oc-warning) 55%, transparent);
  background: color-mix(in srgb, var(--oc-warning) 13%, transparent);
}
.ov-badge[data-tone="error"] {
  color: var(--oc-error-text);
  border-color: color-mix(in srgb, var(--oc-error) 55%, transparent);
  background: color-mix(in srgb, var(--oc-error) 13%, transparent);
}
.ov-badge[data-tone="info"] {
  color: var(--oc-info-text);
  border-color: color-mix(in srgb, var(--oc-info) 55%, transparent);
  background: color-mix(in srgb, var(--oc-info) 13%, transparent);
}
.ov-row-sub {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--oc-muted);
}
.ov-row-sub .ov-mono {
  font-family: var(--oc-mono, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
.ov-time { white-space: nowrap; font-variant-numeric: tabular-nums; }

.ov-empty {
  border: 1px dashed var(--oc-border);
  border-radius: var(--oc-radius, 8px);
  padding: 22px 16px;
  text-align: center;
  color: var(--oc-muted);
  font-size: 13px;
  line-height: 1.55;
}
.ov-empty strong { display: block; color: var(--oc-fg); font-size: 13.5px; margin-bottom: 5px; }

.ov-vocab {
  border-top: 1px solid var(--oc-border);
  background: var(--oc-elevated);
  margin-top: auto;
}
.ov-vocab-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--oc-fg);
  background: transparent;
  border: 0;
  padding: 10px 16px;
  cursor: pointer;
}
.ov-vocab-toggle:hover { background: var(--oc-hover); }
.ov-vocab-toggle .ov-vocab-hint { color: var(--oc-muted); font-weight: 400; }
.ov-vocab-body { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 4px; }
.ov-vocab-row {
  display: grid;
  grid-template-columns: minmax(130px, 1.1fr) minmax(150px, 1.4fr) auto;
  gap: 4px 12px;
  align-items: baseline;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.ov-vocab-row:nth-child(odd) { background: color-mix(in srgb, var(--oc-muted-surface) 55%, transparent); }
.ov-vocab-name {
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--oc-fg);
  overflow-wrap: anywhere;
}
.ov-vocab-desc { font-size: 11.5px; line-height: 1.45; color: var(--oc-muted); overflow-wrap: anywhere; }
.ov-vocab-row[data-avail="unavailable"] .ov-vocab-name {
  text-decoration: line-through;
  text-decoration-color: var(--oc-error-text);
  color: var(--oc-error-text);
}
.ov-vocab-row[data-avail="unknown"] .ov-vocab-name { color: var(--oc-warning-text); }
.ov-vocab-type {
  grid-column: 1 / -1;
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 10.5px;
  color: var(--oc-subtle, var(--oc-muted));
}

@media (max-width: 560px) {
  .ov-header { padding: 12px 12px 0; }
  .ov-body { padding: 10px 12px 8px; }
  .ov-viewline { padding: 8px 12px 0; }
  .ov-vocab-toggle, .ov-vocab-body { padding-left: 12px; padding-right: 12px; }
  .ov-vocab-row { grid-template-columns: 1fr auto; }
  .ov-vocab-desc { grid-column: 1 / -1; }
  .ov-row-sub { flex-direction: column; gap: 3px; }
  .ov-anchor > .oc-sdk { min-width: 100%; max-width: none; }
}
`;var Qo=["default","running","needs-restart","question-paused"],Ln=[...Qo,"tree","subtree"],Pn={running:{text:"status = running means a turn is in flight or the session holds the execution claim. Question-paused sessions are a SUBSET — they still report running, which is exactly why question-paused needs hasPendingForm as a second filter."},"question-paused":{text:"Verification surface for pause/resume: pause reports `paused` only after a NEW pending form and the execution claim are both observed (the session matches this view); resume reports `resumed` only after the form has left the pending set (the session has left it)."},tree:{text:"Every session in one tree, ordered by DERIVED depth — the host exposes no depth, so the panel walks parentId itself."},subtree:{text:"One session and everything beneath it (self-inclusive), ordered by DERIVED depth — the host exposes no depth, so the panel walks parentId itself."}},l=(e,t,n)=>{let s=document.createElement(e);if(t)s.className=t;if(n!==void 0)s.textContent=n;return s},Jt=(e)=>e.length>18?`${e.slice(0,15)}…`:e;function Dn(e){if(!e)return"no activity";let t=Math.max(0,Date.now()-e),n=Math.floor(t/60000);if(n<1)return"just now";if(n<60)return`${n}m ago`;let s=Math.floor(n/60);if(s<24)return`${s}h ago`;return`${Math.floor(s/24)}d ago`}function Ne(e,t){return t.filter((n)=>n.chain.includes(e)&&n.id!==e).length}function Yo(e){let t=e.filter((n)=>n.isRoot);return t.sort((n,s)=>Ne(s.id,e)-Ne(n.id,e)||(s.lastActivity??0)-(n.lastActivity??0)),t[0]?.id??null}function qo(e){let t=e.filter((n)=>!n.isRoot&&Ne(n.id,e)>0);return t.sort((n,s)=>Ne(s.id,e)-Ne(n.id,e)||(s.lastActivity??0)-(n.lastActivity??0)),t[0]?.id??null}function Zo(e,t){let n=document.createElement("style");n.textContent=Jo,document.head.append(n);let s=l("div","ov-shell"),a=l("header","ov-header"),i=l("div","ov-titlebar"),d=l("h1","ov-title","Session views"),p=l("span","ov-subtitle","agent trees · src/lib/views.json");d.append(p);let g=l("div","ov-chips");i.append(d,g);let x=l("div","ov-switcher");a.append(i,x);let w=l("div","ov-viewline"),J=l("div","ov-body"),oe=l("section","ov-vocab");oe.setAttribute("aria-label","Filter vocabulary");let C=l("button","ov-vocab-toggle");C.type="button",C.setAttribute("aria-expanded","false");let N=l("div","ov-vocab-body");N.hidden=!0,oe.append(C,N),s.append(a,w,J,oe),e.append(s);let ce=l("div");ce.id="ov-notices";let re=l("div");re.id="ov-anchor";let Y=l("div");Y.id="ov-content",Y.className="ov-rows",J.append(ce,re,Y);let h={tab:"default",rootId:null,subtreeId:null},k={state:"loading",records:[],coverage:[],gaps:[],claimEvidence:!1,forkEvidence:!1,scheduledEvidence:!1,pendingFormEvidence:!1},W=[],ue=!1,z={unavailable:l("button","ov-chip","unavailable: userSpawned, waveIndex"),gaps:l("span","ov-chip","")};z.unavailable.type="button",z.unavailable.dataset.tone="error",z.unavailable.title="Show the filter vocabulary: these two filters have no source anywhere.",z.unavailable.addEventListener("click",()=>T(!0)),z.gaps.dataset.tone="warning",g.append(z.unavailable,z.gaps);let se=null,q=null,Q="",T=(c)=>{if(ue=c,N.hidden=!c,C.setAttribute("aria-expanded",String(c)),c)N.scrollIntoView({block:"nearest"});P()};C.addEventListener("click",()=>T(!ue));let f=(c)=>{if(c==="tree"){if(!h.rootId)return[];return zt(W.filter((u)=>Ce(u,{rootId:h.rootId},{views:j})))}if(c==="subtree"){if(!h.subtreeId)return[];return zt(W.filter((u)=>Ce(u,{isSubtreeOf:h.subtreeId},{views:j})))}let I=jt(c),A=W.filter((u)=>Ce(u,I.filters,{views:j}));return zo(A,I.sort)},b=()=>{if(h.tab==="tree")return h.rootId?`tree:${h.rootId}`:"tree";if(h.tab==="subtree")return h.subtreeId?`subtree:${h.subtreeId}`:"subtree";return h.tab},O=(c,I)=>{let A=l("span","ov-badge",c);if(I)A.dataset.tone=I;return A},me=(c,I)=>{let A=l("button","ov-row");A.type="button",A.dataset.indent=I?"true":"false",A.style.setProperty("--d",String(c.depth)),A.title=`${c.id} — click to open this session`;let u=l("span","ov-row-head");u.append(l("span","ov-id",Jt(c.id))),u.append(l("span","ov-row-title",c.title||"(untitled session)"));let _=l("span","ov-badges");if(c.status==="running")_.append(O("running","success"));else if(c.status==="idle")_.append(O("idle"));else _.append(O("unknown"));if(c.paused)_.append(O("question-paused","warning"));else if(c.activity==="waiting-permission")_.append(O("waiting permission","info"));else if(c.activity==="retrying")_.append(O("retrying","info"));if(c.hasPendingForm&&!c.paused&&!c.pendingFormKnown)_.append(O("pending form","warning"));else if(c.hasPendingForm&&!c.paused)_.append(O("stale form (turn ended)","warning"));if(c.outcome==="failed")_.append(O("failed outcome","error"));if(c.archived)_.append(O("archived"));if(c.orphaned===!0)_.append(O("orphaned claim","error"));if(h.tab==="needs-restart"&&c.orphaned===null)_.append(O("orphaned: unknown"));if(c.forkKnown&&c.fork)_.append(O("fork"));if(c.scheduledKnown&&c.scheduled)_.append(O("scheduled"));u.append(_);let M=l("span","ov-row-sub"),pe=l("span","ov-mono");pe.textContent=`depth ${c.depth} · root ${Jt(c.rootId)} · ${c.projectId}`;let D=l("span","ov-time",Dn(c.lastActivity));return M.append(pe,D),A.append(u,M),A.addEventListener("click",()=>{t.openSession(c.id).catch(()=>{return})}),A},Me=()=>{let c=l("div","ov-proxy"),I=l("div","ov-proxy-head");I.append(O("PROXY — best guess","warning")),I.append(l("span",void 0,"root ∧ ¬fork ∧ kind ≠ 'scheduled'"));let A=l("div","ov-proxy-body");A.append(l("span",void 0,"best guess — includes workflow/queue/API sessions. "));let u=l("code",void 0,"userSpawned");A.append(u,l("span",void 0," has no source anywhere, so “a conversation the user started” cannot be computed. This view is the documented approximation: "));let _=l("code",void 0,"isRoot ∧ ¬fork ∧ ¬scheduled");if(A.append(_,l("span",void 0,". A scheduled session that was never labelled is indistinguishable from a user one.")),c.append(I,A),!k.forkEvidence||!k.scheduledEvidence){let M=l("div","ov-proxy-body");M.append(l("span",void 0,"Host gap: this host sends no fork or scheduled flag, so neither arm can actually exclude a row here — the proxy widens silently rather than hiding sessions.")),c.append(M)}return c},Le=()=>{let c=l("div","ov-gaps"),I=l("div","ov-gaps-head");I.append(O("data gaps","warning"));for(let u of k.gaps){let _=u.id==="outcome"?"muted":"warning";I.append(O(u.label,_))}let A=l("ul");for(let u of k.gaps){let _=l("li");if(u.id==="outcome")_.dataset.tone="muted";_.append(l("strong",void 0,`${u.label}: `),l("span",void 0,u.text)),A.append(_)}return c.append(I,A),c},ne=(c,I)=>{if(c==="needs-restart"){let M=l("div","ov-note");M.dataset.tone="warning";let pe=I.filter((D)=>D.orphaned===!0).length;if(!k.claimEvidence)M.append(l("strong",void 0,"orphan arm: unknown. "),l("span",void 0,`${I.length} row(s) below come from recorded outcomes ONLY. Claimed-but-idle sessions are invisible to this view — this is not zero restart candidates.`));else M.append(l("strong",void 0,"orphan arm evaluated from host claim evidence. "),l("span",void 0,`${pe} orphaned claim(s) listed beside ${I.length-pe} failed/interrupted outcome(s).`));return M}let A=c.startsWith("tree:")?"tree":c.startsWith("subtree:")?"subtree":c,u=Pn[A];if(!u)return null;let _=l("div","ov-note");if(u.tone)_.dataset.tone=u.tone;return _.append(l("strong",void 0,`${c}: `),l("span",void 0,u.text)),_},Pe=(c)=>{if(j.filters[c]?.unavailable)return{key:"unavailable",label:"unavailable"};if(c==="claimed"||c==="orphaned")return k.claimEvidence?{key:"derived",label:"derived from claim evidence"}:{key:"unknown",label:"unknown on this host"};if(c==="fork")return k.forkEvidence?{key:"derived",label:"derived"}:{key:"unknown",label:"unknown on this host"};if(c==="scheduled")return k.scheduledEvidence?{key:"derived",label:"derived"}:{key:"unknown",label:"unknown (widened)"};if(c==="hasPendingForm")return{key:"derived",label:"derived from activity"};if(c==="outcome")return{key:"derived",label:"derived (no interrupted)"};return{key:"available",label:"available"}},P=()=>{let c=Object.keys(j.filters),I=c.filter((A)=>j.filters[A].unavailable).length;if(C.replaceChildren(l("span",void 0,`Filter vocabulary · ${c.length} filters`),l("span","ov-vocab-hint",`${I} unavailable: userSpawned, waveIndex`)),!ue)return;N.replaceChildren();for(let A of c){let u=j.filters[A],_=Pe(A),M=l("div","ov-vocab-row");M.dataset.avail=_.key,M.append(l("div","ov-vocab-name",A)),M.append(l("div","ov-vocab-desc",u.description??u.reason??"")),M.append(O(_.label,_.key==="unavailable"?"error":_.key==="unknown"?"warning":_.key==="available"?"success":"neutral")),M.append(l("div","ov-vocab-type",`type: ${u.type??"boolean"} · derived: ${u.derived??(u.unavailable?"no source":"—")}`)),N.append(M)}},he=()=>{if(W=Ko(k.records),!h.rootId)h.rootId=Yo(W);if(!h.subtreeId)h.subtreeId=qo(W);let c=new Map;for(let D of Qo)c.set(D,f(D).length);if(h.rootId)c.set("tree",f("tree").length);if(h.subtreeId)c.set("subtree",f("subtree").length);let I=Ln.map((D)=>{let Re=D==="default"?"default (proxy)":D==="tree"?"tree:root":D==="subtree"?"subtree:":D,ie=c.get(D);return{id:D,label:Re,...ie===void 0?{}:{count:ie}}});if(!se)se=Vt(x,{items:I,activeId:h.tab,trackBackground:!0,onChange:(D)=>F(D)});else se.update({items:I,activeId:h.tab});z.gaps.textContent=k.gaps.length===0?"no data gaps":`${k.gaps.length} data gap${k.gaps.length===1?"":"s"}`,z.gaps.dataset.tone=k.gaps.length===0?"success":"warning";let A=b(),u=jt(A,{rootId:h.rootId??void 0,subtreeOf:h.subtreeId??void 0});if(w.replaceChildren(),w.append(l("strong",void 0,A)),w.append(l("span","ov-filters",u.skipped?"waiting for an anchor":Kt(u.filters))),j.views.default?.isProxy&&h.tab==="default")w.append(O("isProxy: true","warning"));if(u.skipped)w.append(O("anchor required","warning"));ce.replaceChildren();let _=l("div");if(_.style.display="flex",_.style.flexDirection="column",_.style.gap="10px",h.tab==="default")_.append(Me());_.append(Le());let M=ne(A,f(h.tab));if(M)_.append(M);if(k.state==="error"){let D=l("div","ov-note");D.dataset.tone="warning",D.append(l("strong",void 0,"workspace unavailable: "),l("span",void 0,k.error??"unknown host error")),_.append(D)}ce.append(_),Z();let pe=f(h.tab);if(Y.replaceChildren(),k.state==="loading"&&k.records.length===0)Y.append(Te("Loading session inventory","Waiting for the host to answer listProjects / onSessions."));else if(u.skipped)Y.append(Te("Anchor required",u.skipped));else if(pe.length===0)Y.append(Gn(A,k));else{let D=h.tab==="tree"||h.tab==="subtree";for(let Re of pe)Y.append(me(Re,D))}P()},Z=()=>{if(h.tab!=="tree"&&h.tab!=="subtree"){re.replaceChildren(),q?.dispose(),q=null,Q="";return}let c=h.tab==="tree",I=(c?W.filter((u)=>u.isRoot):W.filter((u)=>!u.isRoot)).map((u)=>({id:u.id,label:`${u.title||"(untitled)"} · depth ${u.depth} · ${Jt(u.id)}`})).sort((u,_)=>u.label<_.label?-1:u.label>_.label?1:0),A=`${h.tab}|${I.map((u)=>u.id).join(",")}`;if(!q||Q!==A){re.replaceChildren(),q?.dispose(),q=null;let u=l("div","ov-anchor");u.append(l("span",void 0,c?"Root of the tree:":"Anchor session of the subtree:"));let _=l("div");u.append(_),re.append(u),q=Xt(_,{value:c?h.rootId:h.subtreeId,options:I,placeholder:c?"Choose a root session…":"Choose a session…",searchable:!0,searchPlaceholder:"Search sessions…",onChange:(M)=>{if(c)h.rootId=M;else h.subtreeId=M;he()}}),Q=A}else q.update({value:c?h.rootId:h.subtreeId,options:I})},F=(c)=>{if(h.tab=c,c==="tree"&&!h.rootId)h.rootId=Yo(W);if(c==="subtree"&&!h.subtreeId)h.subtreeId=qo(W);he()},X=Vo(t,(c)=>{k=c,he()});return t.onReady((c)=>{if(!se)he()}),he(),X}function Te(e,t){let n=l("div","ov-empty");return n.append(l("strong",void 0,e),l("span",void 0,t)),n}function Gn(e,t){if(e==="needs-restart"&&!t.claimEvidence)return Te("No recorded failures — and the orphan arm is unknown","outcome has no failed/interrupted row, but claimed-but-idle sessions cannot be read from this host. Treat this as “no evidence”, not “zero restart candidates”.");if(e.startsWith("tree:")||e.startsWith("subtree:"))return Te("No sessions match this anchor","The anchor may sit outside the host's listed inventory.");if(e==="question-paused")return Te("Nothing is paused","No session is both running and holding a pending form.");if(e==="running")return Te("Nothing is running","No session reports a turn in flight or an execution claim.");if(e==="default")return Te("No root sessions match the proxy","isRoot ∧ ¬fork ∧ ¬scheduled matched nothing.");return Te("No sessions match this view","Check the filter vocabulary below for what this view requires.")}var en=kt();en.onReady((e)=>{It(e,document.documentElement),document.body.dataset.ocSurface=e.surface});var tn=document.getElementById("root");if(!tn)throw Error("Session Views: #root is missing from panel/index.html");Zo(tn,en);})();
