/* RetailNav deterministic seed data. No fake GPS, fake sessions, or real users.
 * Photo fixtures retain their original frame. Source-map demos require
 * recorded anchors in the active map frame; photo pixels are never migrated
 * by relabeling their coordinates. All positions remain explicitly fictional.
 */
(()=>{
'use strict';
const seeds=[
  // Three demo people per floor; positions are centers of actual corridor features.
  {id:'mock-ll-01',name:'Elena Ruiz',floor:'LL',x:550.2,y:426.5,bodyColor:'#ea668f',shadowColor:'#864f91',rimColor:'#ffe1ef',skin:'#d59a72',hair:'#332633',shirt:'#568a9e',bg:'#526782',hairStyle:1},
  {id:'mock-ll-02',name:'Mateo Silva',floor:'LL',x:732.7,y:422.0,bodyColor:'#f5aa5f',shadowColor:'#996436',rimColor:'#fff0ce',skin:'#ba7e56',hair:'#21232e',shirt:'#345e91',bg:'#6b8096',hairStyle:0},
  {id:'mock-ll-03',name:'Valentina Cruz',floor:'LL',x:835.6,y:333.0,bodyColor:'#7bd7b5',shadowColor:'#427e72',rimColor:'#ddfff1',skin:'#edb68c',hair:'#7e442e',shirt:'#975377',bg:'#6a8a8d',hairStyle:2},
  {id:'mock-ul-01',name:'Sofía Morales',floor:'UL',x:470.8,y:447.5,bodyColor:'#f394b8',shadowColor:'#815e9b',rimColor:'#ffe4f1',skin:'#d89d7f',hair:'#30252a',shirt:'#804b8c',bg:'#556c85',hairStyle:1},
  {id:'mock-ul-02',name:'Marcos Vega',floor:'UL',x:699.4,y:403.5,bodyColor:'#f5c270',shadowColor:'#ab754b',rimColor:'#fff4d5',skin:'#a96d48',hair:'#181f2a',shirt:'#5a7194',bg:'#6b8593',hairStyle:0},
  {id:'mock-ul-03',name:'Lucía Fernández',floor:'UL',x:811.4,y:301.5,bodyColor:'#ad9fff',shadowColor:'#61549c',rimColor:'#eee9ff',skin:'#f1c09e',hair:'#6a382a',shirt:'#58897c',bg:'#768aa0',hairStyle:2},
  {id:'mock-l3-01',name:'Nico Herrera',floor:'L3',x:492.0,y:348.0,bodyColor:'#7be2d0',shadowColor:'#327b8d',rimColor:'#e0ffff',skin:'#bb825e',hair:'#2a302b',shirt:'#8877b5',bg:'#607c9d',hairStyle:0},
  {id:'mock-l3-02',name:'Camila Torres',floor:'L3',x:777.5,y:425.0,bodyColor:'#ee95a1',shadowColor:'#984c71',rimColor:'#ffebec',skin:'#c98a60',hair:'#372a24',shirt:'#507d99',bg:'#6b85a5',hairStyle:1},
  {id:'mock-l3-03',name:'Tomás Álvarez',floor:'L3',x:837.4,y:410.5,bodyColor:'#8fb8ff',shadowColor:'#466998',rimColor:'#e8f2ff',skin:'#edba91',hair:'#46352d',shirt:'#826d8d',bg:'#80919d',hairStyle:0}
];
// CC0 synthetic photographic portraits shipped locally, never private user photos.
const photoFiles=Object.freeze(['elena','mateo','valentina','sofia','marcos','lucia','nico','camila','tomas']);
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const sourceFrame=mall.id==='aventura'&&mall.coordinateSpace==='roveiq:107:local-decimeters-v1';
const sourceAnchors=mall.demoCorridorAnchors||[];
const activeSeeds=sourceFrame?seeds.flatMap((seed,index)=>{
  const p=sourceAnchors[index];
  return p&&p.floor===seed.floor&&Number.isFinite(p.x)&&Number.isFinite(p.y)
    ?[{...seed,x:p.x,y:p.y}]:[];
}):seeds;
const list=activeSeeds.map((seed,index)=>Object.freeze({
  id:seed.id,
  name:seed.name,
  demo:true,
  avatarUrl:'demo-avatars/'+photoFiles[index]+'.jpg',
  visual:Object.freeze({bodyColor:seed.bodyColor,shadowColor:seed.shadowColor,
    rimColor:seed.rimColor}),
  position:Object.freeze({
    mallId:sourceFrame?'aventura':'aventura-mall-reference',
    floor:seed.floor,
    x:seed.x,
    y:seed.y,
    source:'mock',
    coordinateSpace:sourceFrame?mall.coordinateSpace:'provisional-plan-pixels',
    // Display coordinates do not assert actual presence or surveyed accuracy.
    verified:false
  })
}));
// AP Plaza users exist only on its own B1 demo. Positions are intentionally
// illustrative empty-aisle points in image pixels, not GPS or sensor readings.
const apSeed=[
  ['ap-demo-b1-01','Lina Chen',336,350,'lucia'],
  ['ap-demo-b1-02','Daniel Wu',546,329,'marcos'],
  ['ap-demo-b1-03','Mei Wang',761,341,'sofia'],
  ['ap-demo-b1-04','Santiago López',989,357,'mateo'],
  ['ap-demo-b1-05','Xia Liu',1183,341,'valentina'],
  ['ap-demo-b1-06','Emma Zhao',852,447,'camila']
];
const apPeople=apSeed.map(([id,name,x,y,photo],i)=>Object.freeze({
  id,name,demo:true,avatarUrl:'demo-avatars/'+photo+'.jpg',
  visual:Object.freeze({bodyColor:['#74aceb','#88c9de','#80bee2','#92bff9','#76b5e6','#93c7ed'][i],
    shadowColor:'#284f70',rimColor:'#f6ffff'}),
  position:Object.freeze({
    mallId:'ap-plaza-reference',floor:'B1',x,y,source:'mock',
    coordinateSpace:'provisional-plan-pixels',verified:false
  })
}));
// New World City demo visitors are placed using the imported, checked
// photographic corridor candidates. They are NOT live users, GPS fixes,
// surveyed walkway centres or evidence of actual human presence.
const nwcAnchors=window.RETAILNAV_ACTIVE_MALL?.demoCorridorAnchors||[];
const nwcPeople=nwcAnchors.map((seed,i)=>Object.freeze({
  id:seed.id,
  name:seed.name,
  demo:true,
  avatarUrl:'demo-avatars/'+seed.avatar+'.jpg',
  visual:Object.freeze({
    bodyColor:['#7bd7b5','#f394b8','#f5aa5f','#8fb8ff'][i%4],
    shadowColor:'#365575',rimColor:'#efffff'
  }),
  position:Object.freeze({
    mallId:'new-world-city-shanghai',
    floor:seed.floor, x:seed.x,y:seed.y,
    source:'mock',verified:false,coordinateSpace:'provisional-plan-pixels',
    placementStatus:'photo-corridor-candidate-unverified',
    altitudeSource:'configurable-floor-height-model'
  })
}));
window.RETAILNAV_DEMO_CONTACTS_BY_MALL=Object.freeze({
  aventura:Object.freeze(list),
  'ap-plaza':Object.freeze(apPeople),
  'new-world-city-shanghai':Object.freeze(nwcPeople)
});
// Unknown/unmapped malls have no invented people or Aventura positions.
window.RETAILNAV_DEMO_CONTACTS=window.RETAILNAV_DEMO_CONTACTS_BY_MALL[window.RETAILNAV_ACTIVE_MALL_ID]||
  (!window.RETAILNAV_ACTIVE_MALL_ID
    ? window.RETAILNAV_DEMO_CONTACTS_BY_MALL.aventura
    : Object.freeze([]));
window.RETAILNAV_MARKER_PALETTE=window.RETAILNAV_MARKER_PALETTE||{
  defaultBodyColor:'#65e6e0',
  defaultShadowColor:'#25627c',
  defaultRimColor:'#e8ffff',
  byPerson:{}
};
})();