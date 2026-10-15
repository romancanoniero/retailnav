import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync('src/mall-theme.js','utf8');
const aventuraConfig=JSON.parse(readFileSync('data/mall-themes/aventura.json','utf8'));
function environment(sharedStorage=new Map()){
 const els=new Map();
 const css=new Map();
 let events=[];
 const root={style:{setProperty:(name,value)=>css.set(name,value)}};
 const classes=new Set();
 const body={classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,v){if(v)classes.add(c);else classes.delete(c);}},
  dataset:{},removeAttribute(k){delete this.dataset[k];}};
 const content={textContent:'',replaceChildren(...parts){this.textContent=parts.map(x=>x.textContent||'').join('');}};
 els.set('rnThemeName',content);
 const select={value:'default',addEventListener(){}};
 els.set('rnPalettePreset',select);
 const window={dispatchEvent:e=>events.push(e.type)};
 const document={body,documentElement:root,getElementById:id=>els.get(id)||null,
  createTextNode:t=>({textContent:t}),
  querySelector:sel=>sel==='meta[name="theme-color"]'?{setAttribute:(n,v)=>css.set('theme-color',v)}:null};
 const localStorage={
  getItem:key=>sharedStorage.has(key)?sharedStorage.get(key):null,
  setItem:(key,value)=>sharedStorage.set(key,String(value)),
  removeItem:key=>sharedStorage.delete(key)
 };
 const context={window,document,localStorage,Event:class Event{constructor(type){this.type=type;}},
  URL,Blob,console,setTimeout};
 runInNewContext(source,context,{filename:'mall-theme.js',timeout:2000});
 return {instance:window.RetailNavThemes,css,body,classes,sharedStorage,events,content};
}

test('Aventura palette originates from official website-backed source manifest',()=>{
 assert.equal(aventuraConfig.mallId,'aventura');
 assert.equal(aventuraConfig.logoUrl,'branding/aventura-logo.svg');
 assert.equal(aventuraConfig.preset,'aventura-editorial');
 assert.match(aventuraConfig.source.site,/aventuramall\.com/);
 const svg=readFileSync('public/branding/aventura-logo.svg','utf8');
 assert.match(svg,/<svg\b/);
 assert.match(svg,/fill="black"/);
 assert.match(readFileSync('public/branding/aventura-mark.svg','utf8'),/#100F0F/i);
 for(const [k,v] of Object.entries(aventuraConfig.theme)){
  if(k==='font'||k==='corners')continue;
  assert.match(v,/^#[a-fA-F0-9]{6}$/,'invalid color '+k);
 }
});

test('brand color is applied to every map layer and light presentation',()=>{
 const e=environment();
 const state=e.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme,
  themePreset:'aventura-editorial'});
 assert.equal(state.mallId,'aventura');
 assert.equal(state.enabled,true);
 assert.equal(state.origin,'published');
 assert.equal(e.css.get('--rn-theme-map-unit'),aventuraConfig.theme.mapUnit);
 assert.equal(e.css.get('--rn-theme-map-corridor'),aventuraConfig.theme.mapCorridor);
 assert.equal(e.css.get('--rn-theme-map-floor3'),aventuraConfig.theme.mapFloor3);
 assert.equal(e.css.get('--rn-theme-map-outline'),aventuraConfig.theme.mapOutline);
 assert.equal(e.css.get('theme-color'),aventuraConfig.theme.background);
 assert.equal(e.instance.color('mapUnit','#000000'),aventuraConfig.theme.mapUnit);
 assert.equal(e.instance.rgb('mapUnit',null).length,3);
 assert.equal(e.classes.has('rnThemeEnabled'),true);
 assert.ok(e.events.includes('retailnav:themechange'));
});

test('other malls retain classic renderer if their own palette is missing',()=>{
 const e=environment();
 e.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme});
 const state=e.instance.apply({id:'ap-plaza',name:'AP Plaza'});
 assert.equal(state.enabled,false);
 assert.equal(state.origin,'classic');
 assert.equal(e.classes.has('rnThemeEnabled'),false);
 assert.equal(e.instance.color('mapUnit','#314159'),'#314159');
 assert.equal(e.instance.rgb('mapUnit',[.2,.3,.4])[0],.2);
});

test('changing a single map color is instant, validates values and does not mutate source preset',()=>{
 const e=environment();
 e.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme});
 assert.equal(e.instance.edit('mapUnit','#112233'),true);
 assert.equal(e.instance.color('mapUnit','#000000'),'#112233');
 assert.equal(e.instance.edit('mapUnit','url(javascript:alert(1))'),false);
 assert.equal(e.instance.edit('unknown','#000000'),false);
 assert.equal(aventuraConfig.theme.mapUnit,'#CDB99E');
 assert.equal(e.instance.getState().temporary,true);
 assert.equal(e.instance.getState().mode,'custom');
});

test('palette changes persist only on this device and in this shopping',()=>{
 const storage=new Map();
 const one=environment(storage);
 one.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme});
 one.instance.edit('mapCorridor','#ABCDEF');
 assert.equal(one.instance.save(),true);
 assert.match([...storage.keys()][0],/aventura/);
 const two=environment(storage);
 const mall={id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme};
 two.instance.apply(mall);
 assert.equal(two.instance.color('mapCorridor'),'#ABCDEF');
 two.instance.apply({id:'new-world-city-shanghai',name:'New World City'});
 assert.equal(two.instance.getState().enabled,false);
 two.instance.apply(mall);
 assert.equal(two.instance.color('mapCorridor'),'#ABCDEF');
 two.instance.reset();
 assert.equal(two.instance.color('mapCorridor'),aventuraConfig.theme.mapCorridor);
 assert.equal(storage.size,0);
});

test('high-contrast palette allows accessible temporary view without changing base',()=>{
 const e=environment();
 e.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme});
 assert.equal(e.instance.preset('contrast'),true);
 assert.equal(e.instance.color('mapOutline'),'#111111');
 assert.equal(e.instance.getState().theme.corners,'square');
 e.instance.preset('default');
 assert.equal(e.instance.color('mapOutline'),aventuraConfig.theme.mapOutline);
 assert.equal(e.instance.getState().enabled,true);
});


test('each mall title uses a strong brand palette color with WCAG AA contrast',()=>{
 const env=environment();
 const aventura=env.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme});
 assert.equal(aventura.mallNameColor,'#100F0F');
 assert.ok(aventura.mallNameContrast>=4.5);
 assert.equal(env.css.get('--rn-mall-name-color'),'#100F0F');
 const classic=env.instance.apply({id:'ap-plaza',name:'AP Plaza'});
 assert.equal(classic.mallNameColor,'#65E6E0');
 assert.ok(classic.mallNameContrast>=4.5);
 assert.equal(env.css.get('--rn-mall-name-color'),'#65E6E0');
});

test('changing theme updates mall title color; weak accent falls back to readable text',()=>{
 const env=environment();
 env.instance.apply({id:'aventura',name:'Aventura Mall',theme:aventuraConfig.theme});
 assert.equal(env.instance.edit('accent','#FFFFFF'),true);
 let state=env.instance.getState();
 assert.equal(state.mallNameColor,'#17150F');
 assert.ok(state.mallNameContrast>=4.5);
 assert.equal(env.css.get('--rn-mall-name-color'),state.mallNameColor);
 assert.equal(env.instance.edit('text','#FFFFFF'),true);
 state=env.instance.getState();
 assert.equal(state.mallNameColor,'#111111');
 assert.ok(state.mallNameContrast>=4.5);
 env.instance.preset('contrast');
 state=env.instance.getState();
 assert.ok(state.mallNameContrast>=4.5);
 assert.equal(state.mallNameColor,'#111111');
 env.instance.reset();
 state=env.instance.getState();
 assert.equal(state.mallNameColor,'#100F0F');
});

test('mall title contrast remains legible in custom dark themes too',()=>{
 const env=environment();
 const theme={...aventuraConfig.theme,surface:'#151515',accent:'#202020',text:'#F5E9CE'};
 const result=env.instance.apply({id:'example-mall',name:'Test center',theme});
 assert.equal(result.mallNameColor,'#F5E9CE');
 assert.ok(result.mallNameContrast>=4.5);
 const intense={...theme,accent:'#101010',text:'#151515',accentText:'#151515'};
 const fallback=env.instance.apply({id:'example-mall',name:'Test center',theme:intense});
 assert.equal(fallback.mallNameColor,'#FFFFFF');
 assert.ok(fallback.mallNameContrast>=4.5);
});

test('cache version and mall geometry sources remain distinct from local-only previews',()=>{
 const src=readFileSync('scripts/build-web.py','utf8');
 const cache=readFileSync('src/map-cache.js','utf8');
 const viewer=readFileSync('src/viewer.js','utf8');
 assert.match(src,/mall\["theme"\] = theme/);
 assert.match(src,/mall\["themePreset"\] = config\["preset"\]/);
 assert.match(cache,/retailnav-mall-maps-v1/);
 assert.match(viewer,/window\.addEventListener\('retailnav:themechange',onThemeChange\)/);
 assert.match(viewer,/for\(const floor of floors\)geometry\(floor\)/);
 assert.match(viewer,/function legacyPalette/);
 assert.match(viewer,/uniform vec3 uSelectedColor/);
});
