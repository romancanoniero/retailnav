import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const readJSON=path=>JSON.parse(readFileSync(path,'utf8'));
const taxonomy=readJSON('data/search-taxonomy.json');
const aventura=readJSON('public/catalog/malls/aventura/stores.json');
const shanghai=readJSON('public/catalog/malls/new-world-city-shanghai/stores.json');
const aventuraMapAudit=readJSON('data/store-directory/aventura-map-audit.json');
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

test('Aventura historical photo references remain archived and official identities stay separate',()=>{
 assert.equal(aventura.mallId,'aventura');
 assert.ok(aventura.records.length>=100);
 const vectorRecords=aventura.records.filter(u=>u.codeKind==='map-vector-reference-not-lease-number');
 const linked=vectorRecords.filter(u=>u.conceptIds?.length);
 assert.equal(vectorRecords.length,131);
 assert.equal(linked.length,14);
 for(const unit of vectorRecords){
  assert.ok(unit.storeId.startsWith('aventura:'));
  if(unit.conceptIds?.length){
   assert.ok(unit.name);
   assert.equal(unit.photoReference.polygonId,unit.code);
   assert.equal(unit.polygonId,null);assert.equal(unit.activeMap,false);
   assert.equal(unit.conceptEvidence,'brand-category-inference-not-inventory');
   assert.equal(unit.conceptsVerified,false);
   assert.equal(unit.productsVerified,false);
  }else{
   assert.equal(unit.conceptIds.length,0);
  }
 }
 const directory=aventura.records.filter(u=>u.source==='aventura-official-directory');
 assert.equal(directory.length,338);
 assert.equal(directory.filter(u=>u.directorySection==='shops').length,270);
 assert.equal(directory.filter(u=>u.directorySection==='dining').length,68);
 assert.ok(directory.every(u=>u.polygonId===null));
 const auntie=directory.find(u=>u.name==='Auntie Anne’s');
 assert.equal(auntie.floor,'LL');
 assert.ok(auntie.sourceGeometry.polygons.some(p=>p.floor===auntie.floor));
 assert.deepEqual(auntie.documentedFloors,['LL','UL']);
 assert.match(auntie.locationLabel,/Upper Level.*Lower Level/);
 assert.ok(directory.every(u=>u.storeId.startsWith('aventura:directory:')));
 assert.equal(new Set(directory.map(u=>u.storeId)).size,directory.length);
 assert.equal(directory.filter(u=>u.officialDescription).length,316);
 assert.ok(!directory.some(u=>['Bubbice','Cha Cha Matcha'].includes(u.name)),
  'officially announced Coming Soon concepts must not be searchable as open dining venues');
 assert.ok(directory.every(u=>u.conceptsVerified===false&&u.productsVerified===false));
 assert.ok(directory.some(u=>u.sourceGeometry&&u.locationLabel==='Outdoor Courtyard')); // physical courtyard is represented on source LL
 const jcpenney=directory.find(u=>u.name==='JCPenney');
 assert.deepEqual(jcpenney.documentedFloors,['LL','UL']);
 assert.equal(jcpenney.floor,'LL');
 assert.ok(jcpenney.sourceGeometry.polygons.some(p=>p.floor===jcpenney.floor));
 assert.ok(jcpenney.conceptIds.includes('service.optical'));
 const apple=directory.find(u=>u.name==='Apple');
 assert.equal(apple.floor,'LL');
 assert.ok(apple.sourceGeometry.polygons.some(p=>p.floor===apple.floor));
 assert.equal(apple.polygonId,null);
 assert.equal(apple.locationLabel,'Outdoor Courtyard');
 assert.ok(apple.conceptIds.includes('product.smartphone'));
 assert.ok(directory.find(u=>u.name==='Nike')?.sourceGeometry);
 assert.deepEqual(aventuraMapAudit.vectorReferences.length,14);
 assert.ok(aventuraMapAudit.vectorReferences.every(r=>r.nameCrossCheck==='official-name-found'));
 assert.ok(aventuraMapAudit.vectorReferences.every(r=>r.geometryStatus==='provisional-photo-region-not-verified-as-this-storefront'));
 const appleAudit=aventuraMapAudit.vectorReferences.find(r=>r.vectorCode==='LL-002');
 assert.equal(appleAudit.floorCrossCheck,'official-location-does-not-name-map-floor');
 assert.deepEqual(appleAudit.officialDocumentedFloors,[]);
 assert.equal(appleAudit.officialMapLocationId,'20946');
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
 assert.ok(apple.some(u=>u.name==='Apple'&&u.source==='aventura-official-directory'));
 assert.ok(!apple.some(u=>u.code==='LL-002')); // historical photo aliases cannot claim current map ownership
 const detailedName=app.units.findDetailed('Apple').find(r=>r.unit.source==='aventura-official-directory');
 assert.ok(detailedName.matchTypes.includes('name'));
 assert.ok(app.units.findDetailed('smartphone').some(r=>r.matchTypes.includes('product')));
 assert.ok(app.units.findDetailed('optical').some(r=>r.matchTypes.includes('service')));
 assert.ok(app.units.findDetailed('restaurant').some(r=>r.matchTypes.includes('category')));
 const appleDirectory=apple.find(u=>u.source==='aventura-official-directory');
 assert.equal(appleDirectory.polygonId,null);
 assert.ok(app.units.find('where can I buy an iPhone').some(u=>u.storeId===appleDirectory.storeId));
 assert.ok(app.units.find('smartphones').some(u=>u.storeId===appleDirectory.storeId));
 assert.ok(app.units.find('智能手机').some(u=>u.storeId===appleDirectory.storeId));
 assert.ok(app.units.find('reparar celular').some(u=>u.storeId===appleDirectory.storeId));
 assert.ok(app.units.find('phone repair').some(u=>u.storeId===appleDirectory.storeId));
 assert.ok(app.units.find('手机维修').some(u=>u.storeId===appleDirectory.storeId));
 const optical=app.units.find('optical');
 assert.ok(optical.some(u=>u.name==='JCPenney'&&u.source==='aventura-official-directory'));
 assert.ok(app.units.find('óptica').some(u=>u.name==='JCPenney'&&u.source==='aventura-official-directory'));
 assert.ok(app.units.find('视力检查').some(u=>u.name==='JCPenney'&&u.source==='aventura-official-directory'));
 assert.ok(app.units.find('olive oil').some(u=>u.name==='Eataly'));
 assert.ok(app.units.find('groceries').some(u=>u.name==='Eataly'));
 assert.ok(app.units.find('食品').some(u=>u.name==='Eataly'));
 assert.ok(app.units.find('Italian cuisine').some(u=>u.name==='Eataly'));
 assert.ok(app.units.find('cocina italiana').some(u=>u.name==='Eataly'));
 const cooking=app.units.suggestions('Cocina');
 assert.ok(cooking.some(o=>o.conceptId==='cuisine.italian'&&o.term==='Italian cuisine'),
  'generic cuisine searches must show localized cuisine tags during incremental search');
 assert.ok(cooking.find(o=>o.conceptId==='cuisine.italian').stores.some(s=>s.name==='Eataly'));
 assert.ok(app.units.find('Cocina').some(u=>u.name==='Eataly'),
  'generic cuisine searches must find mall dining listings');
 assert.ok(app.units.find('日本料理').some(u=>u.name==='Toku'||u.name==='Norimoto'));
 assert.ok(app.units.find('steak').some(u=>u.name==='STK Steakhouse'));
 assert.ok(app.units.find('helado').some(u=>u.name==='Sakura'||u.name==='Venchi'));
 assert.ok(app.units.find('restaurantes').some(u=>u.name==='Jacinta'));
 assert.ok(app.units.find('clothing').some(u=>u.name==='JCPenney'&&u.source==='aventura-official-directory'));
 assert.ok(app.units.find('服装').some(u=>u.name==='JCPenney'&&u.source==='aventura-official-directory'));
 assert.ok(app.units.find('sneakers').length>=4);
 assert.ok(['Longchamp','Porsche Design'].every(name=>app.units.find('quiero comprar valijas').some(u=>u.name===name)));
 assert.ok(app.units.find('something utterly unrelated').length===0);
 assert.equal(app.units.find('LL-002').length,0);
 let options=app.units.suggestions('lugg');
 assert.ok(options.some(o=>o.conceptId==='product.luggage'&&o.term==='luggage'));
 options=app.units.suggestions('restaurant');
 const restaurants=options.find(o=>o.conceptId==='category.restaurant');
 assert.ok(restaurants);
 assert.ok(restaurants.count>=60);
 assert.ok(restaurants.stores.some(s=>s.name==='CVI.CHE 105'));
 assert.equal(new Set(restaurants.stores.map(s=>s.storeId)).size,restaurants.count);
 app.i18n.setLocale('es-AR');
 assert.ok(app.units.suggestions('Cocina').some(o=>o.conceptId==='cuisine.italian'&&o.term==='cocina italiana'));
 options=app.units.suggestions('lugg');
 assert.ok(options.some(o=>o.conceptId==='product.luggage'&&o.term==='valijas'));
 assert.equal(app.units.getState().language,'es-AR');
});

test('Canonical store IDs deduplicate cross-floor counts and result rows',()=>{
 const shared=[
  {mallId:'aventura',storeId:'aventura:directory:shared',floor:'LL',code:'S-1',name:'Shared Shop',conceptIds:['product.luggage'],productsVerified:false},
  {mallId:'aventura',storeId:'aventura:directory:shared',floor:'UL',code:'S-1',name:'Shared Shop',conceptIds:['product.luggage'],productsVerified:false}
 ];
 const app=setup('aventura',shared,['en-US']);
 const tag=app.units.suggestions('luggage').find(item=>item.conceptId==='product.luggage');
 assert.equal(tag.count,1);
 assert.equal(tag.stores.length,1);
 const rows=app.units.findDetailed('luggage');
 assert.equal(rows.length,1);
 assert.deepEqual(Array.from(rows[0].floors),['LL','UL']);
 assert.ok(rows[0].matchTypes.includes('product'));
});

test('Legacy tags and semantic concepts with the same label become one suggestion',()=>{
 const records=[{
  mallId:'alto-palermo',storeId:'alto-palermo:official:77',floor:'EP',code:'L04',
  name:'Starbucks',category:'Cafetería',tags:'cafetería,café,gastronomía',
  conceptIds:['category.restaurant','food.coffee'],productsVerified:false
 }];
 const app=setup('alto-palermo',records,['es-AR']);
 const options=app.units.suggestions('caf',15);
 const labels=options.map(option=>option.term.normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase());
 assert.equal(new Set(labels).size,labels.length,'visible suggestion labels must be unique');
 const coffee=options.find(option=>option.term==='café');
 assert.ok(coffee);
 assert.equal(coffee.conceptId,'food.coffee','canonical semantic identity wins over its legacy tag');
 assert.equal(coffee.count,1);
 assert.deepEqual(Array.from(coffee.stores,store=>store.storeId),['alto-palermo:official:77']);
});

test('Photographed Shanghai product terms and legacy autocomplete remain supported',()=>{
 const app=setup('new-world-city-shanghai',shanghai.records);
 assert.ok(app.units.find('equipaje').some(u=>u.code==='5A10'));
 assert.ok(app.units.suggestions('equi').some(o=>o.term==='equipaje'));
 assert.ok(app.units.find('ropa').length>4);
 assert.equal(app.units.getState().withConcepts,0);
 assert.deepEqual(app.units.find('Apple'),[],'Aventura directory concepts and brands must not cross mall boundaries');
 assert.deepEqual(app.units.find('optical'),[],'Aventura services must remain tenant-isolated');
});
