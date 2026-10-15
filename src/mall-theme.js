/* RetailNav — safe, scoped per-mall presentation and 3D map palettes.
 *
 * Public branding is part of the published catalog. Operators will publish
 * via tenant admin; the user-facing color picker is clearly a LOCAL PREVIEW,
 * never a way to edit another tenant or the official published theme.
 * The theme never modifies polygon vertices, doors, floor IDs or routing.
 */
(()=>{
'use strict';
const HEX=/^#[0-9a-fA-F]{6}$/;
const FONT=['editorial','modern','rounded'];
const FONT_STACKS=Object.freeze({
 editorial:'"Helvetica Neue","Avenir Next",Arial,"PingFang SC","Noto Sans CJK SC",sans-serif',
 modern:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Noto Sans CJK SC",sans-serif',
 rounded:'"Trebuchet MS","Avenir Next Rounded","Arial Rounded MT Bold",Arial,"PingFang SC","Noto Sans CJK SC",sans-serif'
});
const CORNERS=['soft','square'];
const COLOR_KEYS={
 background:'Fondo de la aplicación',surface:'Paneles y tarjetas',
 text:'Texto principal',muted:'Texto secundario',
 accent:'Botones y énfasis',accentText:'Texto sobre botones',
 border:'Líneas y separadores',mapUnit:'Locales comerciales',
 mapAnchor:'Tiendas ancla',mapCorridor:'Pasillos',
 mapZone:'Zonas y áreas comunes',mapSlab:'Suelo y losas',
 mapOutline:'Contornos y divisiones',mapVoid:'Aberturas y vacíos',
 mapAmenity:'Servicios e información',mapSelected:'Local seleccionado',
 mapRoute:'Recorrido',mapGrid:'Cuadrícula 3D',
 mapText:'Numeración sobre locales',mapNameText:'Nombres sobre locales',
 mapFloor1:'Tono de planta inferior',mapFloor2:'Tono de planta superior',
 mapFloor3:'Tono de tercera planta'
};
const CLASSIC=Object.freeze({
 background:'#080F1C',surface:'#111F30',text:'#EEF5FB',muted:'#9DB1C4',
 accent:'#65E6E0',accentText:'#071A23',border:'#2A3D52',
 mapUnit:'#355565',mapAnchor:'#355D82',mapCorridor:'#18747B',
 mapZone:'#34516A',mapSlab:'#183044',mapOutline:'#70B8C6',
 mapVoid:'#1E283C',mapAmenity:'#09BED3',mapSelected:'#FFAE4A',
 mapRoute:'#FFCE70',mapGrid:'#102131',
 mapText:'#F0FAFF',mapNameText:'#FFE08F',
 mapFloor1:'#365B71',mapFloor2:'#4A6A80',mapFloor3:'#55748A',
 font:'modern',corners:'soft'
});
const CONTRAST=Object.freeze({
 background:'#FFFFFF',surface:'#FFFFFF',text:'#101010',muted:'#303030',
 accent:'#111111',accentText:'#FFFFFF',border:'#333333',
 mapUnit:'#DADADA',mapAnchor:'#B5B5B5',mapCorridor:'#FFFFFF',
 mapZone:'#E5E5E5',mapSlab:'#F1F1F1',mapOutline:'#111111',
 mapVoid:'#BDBDBD',mapAmenity:'#0E4C73',mapSelected:'#955100',
 mapRoute:'#845000',mapGrid:'#D0D0D0',
 mapText:'#111111',mapNameText:'#222222',
 mapFloor1:'#CCCCCC',mapFloor2:'#EEEEEE',mapFloor3:'#F3F3F3',
 font:'modern',corners:'square'
});
const allKeys=Object.keys(COLOR_KEYS);
const uiVars={
 background:'bg',surface:'surface',text:'text',muted:'muted',
 accent:'accent',accentText:'accent-text',border:'border',
 mapUnit:'map-unit',mapAnchor:'map-anchor',mapCorridor:'map-corridor',
 mapZone:'map-zone',mapSlab:'map-slab',mapOutline:'map-outline',
 mapVoid:'map-void',mapAmenity:'map-amenity',mapSelected:'map-selected',
 mapRoute:'map-route',mapGrid:'map-grid',mapText:'map-text',mapNameText:'map-name-text',mapFloor1:'map-floor1',
 mapFloor2:'map-floor2',mapFloor3:'map-floor3'
};
const $=id=>document.getElementById(id);
let mallId='',mall=null,base={...CLASSIC},value={...CLASSIC};
let enabled=false,origin='classic',mode='default',temporary=false;
let mallNameColor=CLASSIC.accent;
const storageKey=id=>'retailnav:theme-preview:v1:'+id;
function safePatch(input){
 const cleaned={};
 if(!input||typeof input!=='object'||Array.isArray(input))return cleaned;
 for(const key of allKeys){
  if(HEX.test(input[key]||''))cleaned[key]=input[key].toUpperCase();
 }
 if(FONT.includes(input.font))cleaned.font=input.font;
 if(CORNERS.includes(input.corners))cleaned.corners=input.corners;
 return cleaned;
}
function hexToRgb(hex){
 return HEX.test(hex||'')?[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)/255):null;
}
// Prefer a strong brand accent when it is readable against the ACTUAL header
// surface; otherwise use the palette's text color. Enforce WCAG AA (4.5:1)
// for every center, including custom, on-device palette previews.
function relativeLuminance(hex){
 const components=hexToRgb(hex);
 if(!components)return 0;
 const linear=components.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
}
function contrastRatio(a,b){
 const aL=relativeLuminance(a),bL=relativeLuminance(b);
 return (Math.max(aL,bL)+.05)/(Math.min(aL,bL)+.05);
}
function chooseMallNameColor(){
 // The unbranded, legacy topbar background is #0b1523 in style.css.
 const surface=enabled?value.surface:'#0B1523';
 for(const candidate of [value.accent,value.text,value.accentText]){
  if(HEX.test(candidate||'')&&contrastRatio(candidate,surface)>=4.5)
   return candidate;
 }
 // Extreme user-edited combinations may have no legible palette swatch;
 // preserve visibility, never render invisible title text.
 return contrastRatio('#FFFFFF',surface)>=4.5?'#FFFFFF':'#111111';
}
function color(key,fallback){return enabled&&HEX.test(value[key]||'')?value[key]:fallback;}
function rgb(key,fallback){
 const hex=enabled&&HEX.test(value[key]||'')?value[key]:null;
 return hexToRgb(hex)||fallback;
}
function drawCSS(){
 const body=document.body;
 const currentFont=FONT.includes(value.font)?value.font:'modern';
 document.documentElement.style.setProperty('--rn-font-family',FONT_STACKS[currentFont]);
 mallNameColor=chooseMallNameColor();
 document.documentElement.style.setProperty('--rn-mall-name-color',mallNameColor);
 body.classList.toggle('rnThemeEnabled',enabled);
 if(!enabled){
  body.removeAttribute('data-rn-font');
  body.removeAttribute('data-rn-corners');
 }else{
  for(const [key,name] of Object.entries(uiVars)){
   document.documentElement.style.setProperty('--rn-theme-'+name,value[key]);
  }
  body.dataset.rnFont=currentFont;
  body.dataset.rnCorners=value.corners;
 }
 $('rnThemeName')?.replaceChildren(document.createTextNode(
  origin==='published'?'Paleta oficial · '+mall.name:
  origin==='preview'?'Vista previa local · '+mall.name:
  'Estilo clásico · '+mall.name));
 const themeMeta=document.querySelector('meta[name="theme-color"]');
 if(themeMeta)themeMeta.setAttribute('content',enabled?value.background:'#080f1c');
 updateEditor();
 window.dispatchEvent(new Event('retailnav:themechange'));
}
function updateEditor(){
 const select=$('rnPalettePreset');
 if(select)select.value=mode;
 for(const key of allKeys){
  const input=$('rnPaletteColor-'+key);
  if(input)input.value=value[key];
 }
 if($('rnPaletteStatus'))$('rnPaletteStatus').textContent=
  temporary?'Cambios en vista previa. Guardalos sólo en este dispositivo o restablecé la paleta oficial.':
  origin==='preview'?'Vista previa guardada en este dispositivo; otras personas ven los colores oficiales.':
  'Colores predeterminados del shopping. No se altera el plano ni sus datos.';
}
function apply(selected){
 mall=selected||{};
 mallId=typeof mall.id==='string'?mall.id:'aventura';
 const official=safePatch(mall.theme);
 enabled=Object.keys(official).length>0;
 base={...CLASSIC,...official};
 value={...base};mode='default';
 origin=enabled?'published':'classic';
 temporary=false;
 try{
  const saved=JSON.parse(localStorage.getItem(storageKey(mallId))||'null');
  if(saved?.schema==='retailnav.theme-preview.v1'&&saved.mallId===mallId){
   const safe=safePatch(saved.colors);
   if(Object.keys(safe).length){
    value={...base,...safe};
    enabled=true;origin='preview';mode='custom';
   }
  }
 }catch{}
 drawCSS();
 return getState();
}
function preset(name){
 if(!mall)return false;
 if(name==='default'){
  value={...base};
  enabled=Object.keys(safePatch(mall.theme)).length>0;
  origin=enabled?'published':'classic';
 }else if(name==='classic'){
  value={...CLASSIC};enabled=true;origin='preview';
 }else if(name==='contrast'){
  value={...CONTRAST};enabled=true;origin='preview';
 }else return false;
 mode=name;temporary=true;drawCSS();return true;
}
function edit(key,newColor){
 if(!allKeys.includes(key)||!HEX.test(newColor))return false;
 value[key]=newColor.toUpperCase();
 enabled=true;origin='preview';mode='custom';temporary=true;
 drawCSS();return true;
}
function editFont(fontPreset){
 if(!FONT.includes(fontPreset))return false;
 value.font=fontPreset;
 enabled=true;origin='preview';mode='custom';temporary=true;
 drawCSS();return true;
}
function fontFamily(){
 const currentFont=FONT.includes(value.font)?value.font:'modern';
 return FONT_STACKS[currentFont];
}
function canvasFont(weight=700,size=14){
 const w=Number.isFinite(Number(weight))?Math.max(100,Math.min(900,Number(weight))):700;
 const px=Number.isFinite(Number(size))?Math.max(8,Math.min(128,Number(size))):14;
 return w+' '+px+'px '+fontFamily();
}
function save(){
 if(!mallId)return false;
 try{
  localStorage.setItem(storageKey(mallId),JSON.stringify({
   schema:'retailnav.theme-preview.v1',mallId,colors:value,mode
  }));
  enabled=true;origin='preview';temporary=false;drawCSS();return true;
 }catch(e){if($('rnPaletteStatus'))$('rnPaletteStatus').textContent='El navegador no pudo guardar esta vista previa.';return false;}
}
function reset(){
 if(!mallId)return;
 try{localStorage.removeItem(storageKey(mallId));}catch{}
 value={...base};enabled=Object.keys(safePatch(mall.theme)).length>0;
 origin=enabled?'published':'classic';mode='default';temporary=false;drawCSS();
}
function getState(){return {
 mallId,preset:mall?.themePreset||'retailnav-classic',
 enabled,origin,mode,temporary,
 mallNameColor,mallNameContrast:+contrastRatio(mallNameColor,enabled?value.surface:'#0B1523').toFixed(2),
 theme:{...value}
};}
function setupEditor(){
 const host=$('rnPaletteColors');
 if(!host)return;
 host.replaceChildren();
 for(const [key,label] of Object.entries(COLOR_KEYS)){
  const wrapper=document.createElement('label');
  wrapper.className='rnPaletteColorRow';
  wrapper.setAttribute('for','rnPaletteColor-'+key);
  const text=document.createElement('span');text.textContent=label;
  const control=document.createElement('input');
  control.type='color';control.id='rnPaletteColor-'+key;
  control.value=value[key]||CLASSIC[key];
  control.addEventListener('input',()=>edit(key,control.value));
  wrapper.append(text,control);
  host.append(wrapper);
 }
 const typography=$('rnTypographyPreset');
 if(typography)typography.value=FONT.includes(value.font)?value.font:'modern';
 const fontStatus=$('rnTypographyStatus');
 if(fontStatus)fontStatus.textContent='Tipografía '+(value.font||'modern')+
  (origin==='preview'?' · vista previa local':' · preset del shopping');
 const chooser=$('rnPalettePreset');
 chooser?.addEventListener('change',()=>preset(chooser.value));
 $('rnTypographyPreset')?.addEventListener('change',event=>editFont(event.target.value));
 $('rnPaletteSave')?.addEventListener('click',save);
 $('rnPaletteReset')?.addEventListener('click',reset);
 $('rnPaletteExport')?.addEventListener('click',()=>{
  const payload={schema:'retailnav.mall.theme.v1',mallId,
    theme:{...value},source:'Local preview; needs tenant administrator review'};
  const bytes=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(bytes);
  const link=document.createElement('a');link.href=url;
  link.download='retailnav-'+mallId+'-paleta-propuesta.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
 });
 updateEditor();
}
window.RetailNavThemes={
 apply,edit,editFont,preset,save,reset,color,rgb,getState,fontFamily,canvasFont,
 setupEditor,hexToRgb,keys:Object.freeze([...allKeys]),
 presets:Object.freeze({classic:{...CLASSIC},contrast:{...CONTRAST}})
};
})();
