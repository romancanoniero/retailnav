import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUT = "research-output/aventura";
await fs.mkdir(OUT, { recursive: true });
const events = [], network = [], errors = [], captures = [];
const url = "https://embed.roveiq.com/venues/107?hidesearch=1&hideamenities=1&hidecontrols=1&zoom=18&pitch=0&bearing=0";
const browser = await chromium.launch({headless:true,args:["--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--disable-dev-shm-usage","--disable-software-rasterizer=false"]});
const context = await browser.newContext({viewport:{width:2000,height:1200},deviceScaleFactor:1.5,colorScheme:"light",locale:"en-US",reducedMotion:"reduce"});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("console", msg => {if(msg.type() === "error") errors.push("console "+msg.text().slice(0,500));});
page.on("pageerror", e => errors.push("pageerror "+String(e).slice(0,500)));
page.on("requestfailed", req => errors.push("requestfailed "+req.url().slice(0,200)+" "+(req.failure()?.errorText||"")));
page.on("response", response => {
  const u=response.url();
  if(/roveiq|rovemaps|maptiler|mapbox|tiles|api/i.test(u) && network.length<500)
    network.push({status:response.status(),url:u.slice(0,280),type:response.headers()["content-type"]||""});
});
const html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1' /><style>*{box-sizing:border-box}html,body{margin:0;background:#fff;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100vw;height:100vh;border:0}</style></head><body><iframe id='mall' src='"+url+"' title='Aventura Mall Map' allow='geolocation'></iframe><script>window.mallEvents=[];window.addEventListener('message',function(e){if(e.data && e.data.source==='roveiq-embed'){window.mallEvents.push({time:Date.now(),type:e.data.type,payload:e.data.payload});}});window.mallSend=function(type,payload){document.getElementById('mall').contentWindow.postMessage({source:'roveiq-embed-host',type:type,payload:payload||{}},'*');}</script></body></html>";
const timer=(ms,reason)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(reason+" timed out "+ms+"ms")),ms));
let ready=null,dom={};
const persist=async(status="running")=>fs.writeFile(path.join(OUT,"diagnostics.json"),JSON.stringify({status,url,ready:ready?.payload||null,dom,events:events.concat(await page.evaluate(()=>window.mallEvents||[]).catch(()=>[])),network,errors,captures},null,2));
try {
 await page.setContent(html,{waitUntil:"domcontentloaded"});
 for(let i=0;i<20;i++){
    ready=(await page.evaluate(()=>window.mallEvents||[])).find(x=>x.type==="embed:ready");
    if(ready) break;
    await page.waitForTimeout(1250);
    if(i===10) await page.evaluate(()=>window.mallSend("embed:ping",{}));
 }
 const frame=page.frameLocator("#mall");
 try {
   dom=await frame.locator("body").evaluate(el=>({
     text:el.innerText?.slice(0,3000),title:document.title,
     buttons:[...document.querySelectorAll("button")].slice(0,60).map(x=>({text:x.innerText,title:x.title,aria:x.getAttribute("aria-label")})),
     canvases:[...document.querySelectorAll("canvas")].map(x=>({width:x.width,height:x.height,css:x.getBoundingClientRect().toJSON()})),
     ids:[...document.querySelectorAll("[id]")].slice(0,70).map(x=>x.id)
   }));
 }catch(e){errors.push("dom "+String(e));}
 await persist();
 const floors=ready?.payload?.floors||[];
 await fs.writeFile(path.join(OUT,"floor-list.json"),JSON.stringify({ready:ready?.payload||null,dom,network,errors},null,2));
 console.log("READY?",!!ready,"FLOORS",JSON.stringify(floors),"CANVAS",JSON.stringify(dom.canvases));
 const cdp=await context.newCDPSession(page);
 async function screenshot(filename){
   const target=path.join(OUT,filename);
   try{
     const data=await Promise.race([
        cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false,quality:100}),
        timer(22000,"CDP screenshot")
     ]);
     const buf=Buffer.from(data.data,"base64");
     await fs.writeFile(target,buf);
     console.log("Captured via CDP",filename,buf.length);
     return {method:"CDP",bytes:buf.length};
   }catch(e){errors.push("CDP "+filename+" "+String(e));console.log("CDP FAILED",filename,String(e));}
   try{
     const buf=await page.screenshot({animations:"allow",timeout:20000});
     await fs.writeFile(target,buf);
     console.log("Captured via Playwright",filename,buf.length);
     return {method:"Playwright",bytes:buf.length};
   }catch(e){errors.push("Playwright "+filename+" "+String(e));console.log("Playwright FAILED",filename,String(e));}
   try{
     const png=await Promise.race([frame.locator("canvas").first().evaluate(el=>el.toDataURL("image/png"),{timeout:10000}),timer(14000,"Canvas readback")]);
     const buf=Buffer.from(png.replace(/^data:image\/png;base64,/,""),"base64");
     await fs.writeFile(target,buf);
     console.log("Captured via canvas",filename,buf.length);
     return {method:"Canvas",bytes:buf.length};
   }catch(e){errors.push("Canvas "+filename+" "+String(e));}
   return null;
 }
 if(!ready) throw new Error("No embed ready for venue 107");
 // Let WebGL tiles and branded loading overlay finish; data readiness is not visual readiness.
 await page.waitForTimeout(16000);
 await screenshot("initial.png");
 for(let i=0;i<floors.length;i++){
   const floor=floors[i];
   const filename="planta-"+(i+1)+"-"+String(floor.name).toLowerCase().replace(/[^a-z0-9]+/g,"-")+".png";
   await page.evaluate(id=>window.mallSend("map:showFloor",{floorId:id}),floor.id);
   await page.waitForTimeout(6500);
   const shot=await screenshot(filename);
   captures.push({id:floor.id,name:floor.name,index:i,filename,confirmed:i===0||((await page.evaluate(()=>window.mallEvents||[])).some(x=>x.type==="map:floorChange"&&x.payload?.id===floor.id)),...(shot||{error:"Screenshot failed"})});
   console.log("FLOOR",JSON.stringify(captures.at(-1)));
   await persist();
 }
 await fs.writeFile(path.join(OUT,"README.md"),[
   "# Aventura Mall — extracción cartográfica de investigación",
   "Fuente: https://aventuramall.com/aventura-mall-map/ (RoveIQ venue 107).",
   "Capturas con 2000x1200 CSS, resolución física de 3000x1800 píxeles.",
   "El método usa cámara inicial uniforme (zoom 18, pitch 0, bearing 0) y conmutación de planta vía API oficial.",
   "Atención: datos de referencia, NO planos técnicos ni validación de puntos verticales.",
   "",
   JSON.stringify(captures,null,2)
 ].join("\n"));
 const successes=captures.filter(x=>x.bytes>100000);
 console.log("SUCCESSFUL_FLOORS",successes.length);
 if(successes.length<2) throw new Error("Fewer than 2 high-quality images captured");
 await persist("completed");
}catch(e){errors.push("fatal "+String(e));console.error("FATAL",String(e));await persist("failed").catch(()=>{});process.exitCode=2;}
finally{await browser.close().catch(()=>{});}
