/* Semantic search vocabulary and lightweight search UI localization.
 * Concept IDs, not translated labels, are the persistent database relation.
 * Brand-based suggestions are NEVER verified store inventory.
 */
(()=>{
'use strict';
const source=document.getElementById('rnSearchTaxonomy');
let taxonomy={schema:'retailnav.search.taxonomy.v1',concepts:{}};
try{if(source)taxonomy=JSON.parse(source.textContent);}catch(error){console.warn('RetailNav search taxonomy unavailable',error);}
const concepts=taxonomy.concepts||{};
const supported=['en','es','es-AR','pt','pt-BR','zh','zh-CN','fr'];
const key='retailnav:language-preference:v1';
const labels={
 en:{search:'Search stores, brands, products or services…',input:'Search stores, brands, products or services',language:'Search language',results:'matches',none:'No matches in this mall.',stores:'stores',provisional:'Unverified category suggestion',reviewed:'Some reviewed tags',category:'Store type (provisional)',unknown:'Category not identified',region:'Provisional map region',unplaced:'Location unverified',products:'Products and services (unverified)',mapWarning:'Photographed or inferred information; not verified inventory or live tenants.',reference:'Provisional reference',floors:'floors',matched:'matching stores',all:'All floors',myFloor:'My floor',shop:'stores',available:'Matching stores',tagLabel:'Suggestions',noSearch:'Named stores on photographed map',photo:'Based on photographed map or provisional directory'},
 es:{search:'Buscar locales, marcas, productos o servicios…',input:'Buscar locales, marcas, productos o servicios',language:'Idioma de búsqueda',results:'coincidencias',none:'Sin coincidencias en este shopping.',stores:'locales',provisional:'Categoría sugerida, sin verificar',reviewed:'Algunas etiquetas revisadas',category:'Tipo de comercio (provisional)',unknown:'Categoría no identificada',region:'Región provisional',unplaced:'Ubicación por verificar',products:'Productos y servicios (sin verificar)',mapWarning:'Datos de plano o inferidos; no garantizan inventario ni comercios vigentes.',reference:'Referencia provisional',floors:'plantas',matched:'locales coincidentes',all:'Todas las plantas',myFloor:'Mi planta',shop:'locales',available:'Locales coincidentes',tagLabel:'Sugerencias',noSearch:'Tiendas identificadas en el plano',photo:'Según plano o directorio provisional'},
 pt:{search:'Buscar lojas, marcas, produtos ou serviços…',input:'Buscar lojas, marcas, produtos ou serviços',language:'Idioma da pesquisa',results:'resultados',none:'Nenhum resultado neste shopping.',stores:'lojas',provisional:'Categoria sugerida, não verificada',reviewed:'Algumas etiquetas revisadas',category:'Tipo de loja (provisório)',unknown:'Categoria não identificada',region:'Região provisória',unplaced:'Localização não verificada',products:'Produtos e serviços (não verificados)',mapWarning:'Informações de plantas ou inferidas; não garantem estoque nem lojas ativas.',reference:'Referência provisória',floors:'andares',matched:'lojas encontradas',all:'Todos os andares',myFloor:'Meu andar',shop:'lojas',available:'Lojas encontradas',tagLabel:'Sugestões',noSearch:'Lojas identificadas na planta',photo:'Com base na planta ou no diretório provisório'},
 zh:{search:'搜索商店、品牌、商品或服务…',input:'搜索商店、品牌、商品或服务',language:'搜索语言',results:'条结果',none:'该商场没有匹配结果。',stores:'商店',provisional:'推测的类别，未经验证',reviewed:'部分标签已审核',category:'商店类型（暂定）',unknown:'类别未识别',region:'暂定区域',unplaced:'位置待核实',products:'商品及服务（未验证）',mapWarning:'依据平面图或类别推测；不保证库存或商家仍在营业。',reference:'暂定楼层',floors:'层',matched:'家匹配商店',all:'所有楼层',myFloor:'所在楼层',shop:'商店',available:'匹配商店',tagLabel:'搜索建议',noSearch:'平面图中已识别的店铺',photo:'根据平面图或暂定目录'},
 fr:{search:'Rechercher boutiques, marques, produits ou services…',input:'Rechercher boutiques, marques, produits ou services',language:'Langue de recherche',results:'résultats',none:'Aucun résultat dans ce centre.',stores:'boutiques',provisional:'Catégorie supposée, non vérifiée',reviewed:'Certaines étiquettes vérifiées',category:'Type de magasin (provisoire)',unknown:'Catégorie non identifiée',region:'Zone provisoire',unplaced:'Emplacement non vérifié',products:'Produits et services (non vérifiés)',mapWarning:'Données de plan ou déductions, sans garantie de stock ni de présence.',reference:'Référence provisoire',floors:'étages',matched:'boutiques trouvées',all:'Tous les étages',myFloor:'Mon étage',shop:'boutiques',available:'Boutiques trouvées',tagLabel:'Suggestions',noSearch:'Magasins identifiés sur le plan',photo:'Selon le plan ou le répertoire provisoire'}
};
const stopWords=new Set(('quiero quisiera busco buscar necesito comprar compra comprarme donde dónde hay tienen venden vende para por del desde los las una uno unos unas con cerca que de la el en un y mi me al puedo conseguir '+
 'i want need looking look for where can find buy sells sell shops store stores the of to a an with near me my do you have please '+
 'quero preciso procuro procurar comprar onde tem têm vende para por com de da do as os uma um '+
 'je cherche veux acheter ou trouver où pour des les une dans du de le la et ').split(/\s+/));
const normalize=value=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const words=value=>normalize(value).split(' ').filter(w=>w&&!stopWords.has(w));
function termsMatch(value,query,{prefix=false}={}){
 const term=normalize(value),q=normalize(query);
 if(!term||!q)return false;
 if(term.includes(q))return true;
 const wanted=words(query),candidate=term.split(' ');
 if(!wanted.length)return false;
 return wanted.every(part=>candidate.some(word=>word===part||
  (part.length>=3&&word.startsWith(part))||
  (prefix&&part.length>=2&&word.startsWith(part))));
}
function selectLocale(request){
 const raw=String(request||'').replace('_','-');
 const region=raw.toLowerCase();
 if(region==='es-ar')return'es-AR';
 if(region==='pt-br')return'pt-BR';
 if(region==='zh-cn'||region==='zh-sg'||region==='zh-hans')return'zh-CN';
 const main=region.split('-')[0];
 return supported.includes(main)?main:null;
}
function savedChoice(){try{return localStorage.getItem(key)||'auto';}catch{return'auto';}}
function deviceLocale(){
 const choices=[...(Array.isArray(navigator.languages)?navigator.languages:[]),navigator.language];
 for(const candidate of choices){const result=selectLocale(candidate);if(result)return result;}
 return'en';
}
let choice=savedChoice(),locale=selectLocale(choice)||deviceLocale();
function language(){return locale;}
function ui(id){return (labels[locale]||labels[locale.split('-')[0]]||labels.en)[id]||labels.en[id]||id;}
function getTerms(id){const item=concepts[id];if(!item)return[];return Object.values(item.labels||{}).flat().filter(t=>typeof t==='string');}
function label(id,loc=locale){
 const item=concepts[id];if(!item)return id;
 const list=item.labels?.[loc]||item.labels?.[loc.split('-')[0]]||item.labels?.en||[];
 return list[0]||id;
}
function matchConcept(id,query,{prefix=false}={}){
 if(!concepts[id])return false;
 const q=normalize(query);
 if(!q)return false;
 if(q===normalize(id)||q===normalize('concept:'+id))return true;
 return getTerms(id).some(term=>termsMatch(term,query,{prefix}));
}
function matchingIds(query,ids){
 return [...new Set(ids||[])].filter(id=>matchConcept(id,query));
}
function searchSuggestions(query,units,limit=10){
 const byId=new Map();
 for(const unit of units||[])for(const id of new Set(unit.conceptIds||[])){
  if(!concepts[id])continue;
  const stats=byId.get(id)||{count:0,verified:0};
  stats.count++;stats.verified+=Number(Boolean(unit.productsVerified));
  byId.set(id,stats);
 }
 const queryText=normalize(query);
 return [...byId.entries()].filter(([id])=>matchConcept(id,query,{prefix:true}))
  .sort((a,b)=>{
   const lead=id=>Number(getTerms(id).some(term=>normalize(term).startsWith(queryText)));
   return lead(b[0])-lead(a[0])||b[1].count-a[1].count||label(a[0]).localeCompare(label(b[0]));
  }).slice(0,Math.max(0,Math.min(20,limit)))
  .map(([id,stats])=>({key:'concept:'+id,conceptId:id,term:label(id),
   count:stats.count,verified:stats.verified,kind:concepts[id].kind,provisional:true}));
}
function summary(unit,limit=4){
 const names=[...new Set((unit.conceptIds||[]).filter(id=>concepts[id]).map(id=>label(id)))];
 return names.slice(0,limit).join(', ')+(names.length>limit?'…':'');
}
function renderLanguage(){
 document.documentElement.lang=locale;
 const picker=document.getElementById('rnLanguageSelect');
 if(picker){
  const selection=choice==='auto'?'auto':selectLocale(choice);
  picker.value=selection||'auto';
  picker.title=ui('language')+' · '+locale+(selection==='auto'?' (auto)':'');
  picker.setAttribute('aria-label',ui('language'));
 }
 const search=document.getElementById('search');
 if(search){search.placeholder=ui('search');search.setAttribute('aria-label',ui('input'));}
 const suggestions=document.getElementById('rnSearchSuggestions');
 if(suggestions)suggestions.setAttribute('aria-label',ui('tagLabel'));
 const panel=document.getElementById('results');
 if(panel)panel.setAttribute('aria-label',ui('available'));
}
function setLocale(value){
 const next=value==='auto'?'auto':selectLocale(value);
 if(!next)return false;
 choice=next;
 try{if(choice==='auto')localStorage.removeItem(key);else localStorage.setItem(key,choice);}catch{}
 locale=choice==='auto'?deviceLocale():choice;
 renderLanguage();
 window.dispatchEvent(new CustomEvent('retailnav:localechange',{detail:{locale,mode:choice}}));
 return true;
}
document.getElementById('rnLanguageSelect')?.addEventListener('change',event=>setLocale(event.target.value));
renderLanguage();
window.RetailNavI18n={locale:language,setLocale,ui,label,summary,normalize,matchConcept,matchingIds,
 termsMatch,searchSuggestions,getTerms,getState:()=>({locale,mode:choice,conceptCount:Object.keys(concepts).length}),
 concepts};
})();
