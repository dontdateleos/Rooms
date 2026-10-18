const SHELL="rooms-shell-v2", ASSETS=["./","./index.html","./manifest.webmanifest","./vendor/type.css","./vendor/supabase.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
/* network first, cache as the fallback for when there is no network. Opening the app asks
   the server to confirm the page is current rather than trusting the browser's own copy
   for another ten minutes — that copy is why a phone kept showing an old version. Only
   GETs go in the cache; anything else can't be stored and was failing quietly. */
/* On a slow connection, though, waiting for the network made every open feel broken. So
   the page itself gets three seconds: if the server hasn't answered by then, the copy from
   last time opens, the fresh one still lands in the cache, and the update banner says so. */
const WAIT=3000;
self.addEventListener("fetch",e=>{const u=new URL(e.request.url); if(u.origin!==location.origin||e.request.method!=="GET") return;
  const nav=e.request.mode==="navigate";
  const req=nav?new Request(e.request.url,{cache:"no-cache",credentials:"same-origin"}):e.request;
  const net=fetch(req).then(r=>{const c=r.clone(); if(r.ok) e.waitUntil(caches.open(SHELL).then(x=>x.put(e.request,c))); return r;});
  const old=()=>caches.match(e.request,{ignoreSearch:true});
  if(!nav){e.respondWith(net.catch(old)); return;}
  e.respondWith(new Promise(done=>{let settled=false; const give=r=>{if(!settled&&r){settled=true; done(r);}};
    const t=setTimeout(()=>old().then(give),WAIT);
    net.then(r=>{clearTimeout(t); give(r);}).catch(()=>{clearTimeout(t); old().then(r=>give(r||Response.error()));});}));});
/* a notification from a friend: show it, and a tap opens Rooms where it happened. The tag
   means a second "vote on Saturday" replaces the first rather than stacking up. */
self.addEventListener("push",e=>{let n={}; try{n=e.data?e.data.json():{};}catch{n={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(n.title||"Rooms",{body:n.body||"",tag:n.tag||undefined,renotify:!!n.tag,
    icon:"./icons/rooms-192.png",badge:"./icons/rooms-mask-192.png",data:{url:n.url||"./"}}));});
self.addEventListener("notificationclick",e=>{e.notification.close(); const url=e.notification.data&&e.notification.data.url||"./";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{
    const open=cs.find(c=>c.url.startsWith(self.registration.scope));
    if(open) return open.navigate(url).then(c=>(c||open).focus()).catch(()=>open.focus());
    return self.clients.openWindow(url);}));});
