import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUT = "research-output/aventura";
await fs.mkdir(OUT, { recursive: true });
const events = [];
const network = [];
const errors = [];
const url = "https://embed.roveiq.com/venues/107?hidesearch=1&hideamenities=1&hidecontrols=1&zoom=18&pitch=0&bearing=0";
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 2000, height: 1200 }, deviceScaleFactor: 2, colorScheme: "light", locale: "en-US", reducedMotion: "reduce" });
const page = await context.newPage();
page.on("console", msg => { if(msg.type() === "error") errors.push("console "+msg.text().slice(0,500)); });
page.on("pageerror", e => errors.push("pageerror "+String(e).slice(0,500)));
page.on("requestfailed", req => errors.push("requestfailed "+req.url().slice(0,200)+" "+(req.failure()?.errorText||"")));
page.on("response", response => {
  const u = response.url();
  if (/roveiq|rovemaps|maptiler|mapbox|api|tiles/i.test(u)) network.push({status:response.status(),url:u.slice(0,260),type:response.headers()["content-type"]||""});
});
const html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1' /><style>*{box-sizing:border-box}html,body{margin:0;background:#fff;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100vw;height:100vh;border:0}</style></head><body><iframe id='mall' src='"+url+"' title='Aventura Mall Map' allow='geolocation'></iframe><script>window.mallEvents=[];window.addEventListener('message',function(e){if(e.data && e.data.source==='roveiq-embed'){window.mallEvents.push({time:Date.now(),type:e.data.type,payload:e.data.payload});}});window.mallSend=function(type,payload){document.getElementById('mall').contentWindow.postMessage({source:'roveiq-embed-host',type:type,payload:payload||{}},'*');}</script></body></html>";
await page.setContent(html, {waitUntil:"domcontentloaded"});
const getEvents = () => page.evaluate(() => window.mallEvents || []);
const findReady = async () => (await getEvents()).find(x=>x.type==="embed:ready");
let ready = null;
for(let i=0;i<18;i++){
  ready=await findReady();
  if(ready) break;
  await page.waitForTimeout(2000);
  if(i===7) await page.evaluate(()=>window.mallSend("embed:ping",{}));
}
const frame = page.frameLocator("#mall");
let dom = {};
try{
  dom = await frame.locator("body").evaluate(el=>({
     text:el.innerText.slice(0,14000),
     title:document.title,
     anchors:[...document.querySelectorAll("a")].slice(0,50).map(x=>({text:x.innerText,url:x.href})),
     buttons:[...document.querySelectorAll("button")].slice(0,80).map(x=>({text:x.innerText,title:x.title,aria:x.getAttribute("aria-label")})),
     canvases:[...document.querySelectorAll("canvas")].map(x=>({w:x.width,h:x.height,rect:x.getBoundingClientRect().toJSON()})),
     roots:[...document.querySelectorAll("[id]")].slice(0,60).map(x=>x.id)
  }));
}catch(e){errors.push("dom "+String(e));}
const floorInfo = ready?.payload?.floors || [];
await fs.writeFile(path.join(OUT,"floor-list.json"),JSON.stringify({url,ready:ready?.payload||null,dom,errors,network:network.slice(-250)},null,2));
console.log("READY?",!!ready,"FLOORS",JSON.stringify(floorInfo),"DOM",JSON.stringify({text:dom.text?.slice(0,250),canvases:dom.canvases}));
try {await page.screenshot({path:path.join(OUT,"initial.png"),animations:"disabled",timeout:30000});}catch(e){errors.push("initial screenshot "+String(e));}
let captures = [];
if(floorInfo.length){
 for(let index=0;index<floorInfo.length;index++){
   const f=floorInfo[index];
   const id=f.id;
   const safe=String(f.name||"floor-"+id).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
   await page.evaluate(id=>window.mallSend("map:showFloor",{floorId:id}),id);
   let changed = false;
   for(let i=0;i<16;i++){
     await page.waitForTimeout(500);
     const current=await getEvents();
     if(current.some(e=>e.type==="map:floorChange" && (e.payload?.id===id || e.payload?.floorId===id))){changed=true;break;}
   }
   await page.waitForTimeout(2600);
   const filename="planta-"+(index+1)+"-"+safe+".png";
   await page.screenshot({path:path.join(OUT,filename),animations:"disabled",timeout:30000});
   captures.push({id,name:f.name,index,filename,confirmed:changed});
   console.log("CAPTURED",filename,"switch confirmed",changed);
 }
}else{
  errors.push("No embed:ready floor list; cannot reliably identify floors.");
}
events.push(...(await getEvents()));
await fs.writeFile(path.join(OUT,"diagnostics.json"),JSON.stringify({url,ready:ready?.payload||null,dom,events,network:network.slice(-450),errors,captures},null,2));
await fs.writeFile(path.join(OUT,"README.md"),[
 "# Aventura Mall — extracción cartográfica de investigación",
 "Fuente: https://aventuramall.com/aventura-mall-map/ (visor embed.roveiq.com/venues/107)",
 "Capturas realizadas a la misma resolución de pantalla, zoom 18, pitch 0 y bearing 0.",
 "Son capturas de referencia, NO planos técnicos ni geometría validada.",
 "La orientación visual se configura a 0 grados; la alineación real depende de que el visor no recentre el mapa al cambiar de planta.",
 "Los huecos de ascensor deben verificarse antes de usarse como anclajes.",
 "",
 JSON.stringify(captures,null,2)
].join("\n"));
await browser.close();
if (!ready) { console.error("Could not receive embed:ready; see diagnostics"); process.exitCode=2; }
