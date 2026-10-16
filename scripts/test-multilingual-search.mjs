import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const readJSON=path=>JSON.parse(readFileSync(path,'utf8'));
const taxonomy=readJSON('data/search-taxonomy.json');
const aventura=readJSON('public/catalog/malls/aventura/stores.json');
const shanghai=readJSON('public/catalog/malls/new-world-city-shanghai/stores.json');
const langScript=readFileSync('src/search-i18n.js','utf8');
const unitScript=readFileSync('src/units.js','utf8');

function setup(mallId,records,deviceLanguages=['es-AR','en-US']){
 const store=new Map();
 const selection={value:'auto',addEventListener(){},setAttribute(){},title:''};
 const field={placeholder:'',setAttribute(){},value:''};
 const elements={
  rnSearchTaxonomy:{textContent:JSON.stringify(taxonomy)},
  rnLanguageSelect:selection,
  search:field,
  rnSearchSuggestions:{setAttribute(){}},
  results:{setAttribute(){}}
 };
 const document={
  documentElement:{lang:'en'},
  getElementById:name=>elements[name]||null
 };
 const window=new EventTarget();
 window.RETAILNAV_ACTIVE_MALL={id:mallId,units:records};
 const context=vm.createContext({
  window,document,navigator:{languages:deviceLanguages,language:deviceLanguages[0]},
  localStorage:{
   getItem:k=>store.get(k)||null,
   setItem:(k,v)=>store.set(k,String(v)),
   removeItem:k=>store.delete(k)
  },
  CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}},
  console,Event,EventTarget
 });
 vm.runInContext(langScript,context,{filename:'src/search-i18n.js'});
 vm.runInContext(unitScript,context,{filename:'src/units.js'});
 return {i18n:window.RetailNavI18n,units:window.RetailNavUnits,document,store,selection,field};
}

test('Aventura tags belong ONLY to photograph-named anchor references',()=>{
 assert.equal(aventura.mallId,'aventura');
 assert.ok(aventura.records.length>=100);
 const linked=aventura.records.filter(u=>u.conceptIds?.length);
 assert.equal(linked.length,14);
 for(const unit of aventura.records){
  assert.ok(unit.storeId.startsWith('aventura:'));
  if(unit.conceptIds?.length){
   assert.ok(unit.name);
   assert.equal(unit.polygonId,unit.code);
   assert.equal(unit.conceptEvidence,'brand-category-inference-not-inventory');
   assert.equal(unit.conceptsVerified,false);
   assert.equal(unit.productsVerified,false);
  }else{
   assert.equal(unit.conceptIds.length,0);
  }
 }
});

test('Device locale, user override, reset, and fallback leave semantic IDs stable',()=>{
 const app=setup('aventura',aventura.records);
 assert.equal(app.i18n.locale(),'es-AR');
 assert.equal(app.document.documentElement.lang,'es-AR');
 assert.equal(app.i18n.label('product.luggage'),'valijas');
 assert.match(app.field.placeholder,/Buscar/);
 const current=app.units.find('valijas').map(u=>u.storeId).sort();
 assert.ok(current.length>0);
 for(const query of ['luggage','suitcases','malas','maletas','行李箱','valijas']){
  assert.deepEqual(app.units.find(query).map(u=>u.storeId).sort(),current,
   query+' must resolve the exact same store IDs');
 }
 assert.equal(app.i18n.setLocale('en'),true);
 assert.equal(app.i18n.locale(),'en');
 assert.equal(app.document.documentElement.lang,'en');
 assert.equal(app.i18n.label('product.luggage'),'luggage');
 assert.match(app.field.placeholder,/Search/);
 assert.deepEqual(app.units.find('valijas').map(u=>u.storeId).sort(),current);
 assert.equal(app.i18n.setLocale('auto'),true);
 assert.equal(app.i18n.locale(),'es-AR');
 assert.equal(app.store.size,0);
 const fr=setup('aventura',aventura.records,['xx-ZZ','fr-CA']);
 assert.equal(fr.i18n.locale(),'fr');
 assert.equal(fr.i18n.label('product.luggage'),'bagages');
 const fallback=setup('aventura',aventura.records,['xx-ZZ']);
 assert.equal(fallback.i18n.locale(),'en');
});

test('Names, brands, products, services, natural phrases and localized autocomplete',()=>{
 const app=setup('aventura',aventura.records,['en-US']);
 const apple=app.units.find('Apple');
 assert.equal(apple.length,1);
 assert.equal(apple[0].name,'Apple');
 assert.deepEqual(app.units.find('reparar celular').map(u=>u.storeId),apple.map(u=>u.storeId));
 assert.deepEqual(app.units.find('where can I buy an iPhone').map(u=>u.storeId),apple.map(u=>u.storeId));
 assert.deepEqual(app.units.find('smartphones').map(u=>u.storeId),apple.map(u=>u.storeId));
 assert.ok(app.units.find('sneakers').length>=4);
 assert.ok(app.units.find('quiero comprar valijas').length>=4);
 assert.ok(app.units.find('something utterly unrelated').length===0);
 assert.ok(app.units.find('LL-002').some(u=>u.name==='Apple'));
 let options=app.units.suggestions('lugg');
 assert.ok(options.some(o=>o.conceptId==='product.luggage'&&o.term==='luggage'));
 app.i18n.setLocale('es-AR');
 options=app.units.suggestions('lugg');
 assert.ok(options.some(o=>o.conceptId==='product.luggage'&&o.term==='valijas'));
 assert.equal(app.units.getState().language,'es-AR');
});

test('Photographed Shanghai product terms and legacy autocomplete remain supported',()=>{
 const app=setup('new-world-city-shanghai',shanghai.records);
 assert.ok(app.units.find('equipaje').some(u=>u.code==='5A10'));
 assert.ok(app.units.suggestions('equi').some(o=>o.term==='equipaje'));
 assert.ok(app.units.find('ropa').length>4);
 assert.equal(app.units.getState().withConcepts,0);
});
