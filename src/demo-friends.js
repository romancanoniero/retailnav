/* RetailNav deterministic seed data. No fake GPS, fake sessions, or real users.
 * Coordinates are in the EXACT provisional Aventura vector-map plan space.
 * Replacing source:'mock' with server-reported positions does not change
 * floor projection, renderer geometry, contact list, or navigation behavior.
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
function photo(seed){
  // Deliberately synthetic SVG portraits: no dependency on another person's
  // photograph, no CDN and no misleading real-world photo of a visitor.
  const h=seed.hairStyle;
  const hair=h===0
    ? '<path d="M27 52Q19 26 37 17Q56 6 74 20Q85 31 76 53L72 40Q58 30 36 41Z"/>'
    : h===1
      ? '<path d="M20 86Q13 63 20 35Q27 10 53 12Q87 10 84 41L79 84L66 81L72 48Q58 27 34 40L30 82Z"/>'
      : '<path d="M20 84Q9 40 25 24Q41 6 63 16Q87 19 85 55L82 91L68 89L72 44Q45 20 31 44L32 91Z"/>';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+
    '<defs><radialGradient id="sky"><stop stop-color="#d2e3e7"/><stop offset="1" stop-color="'+seed.bg+'"/></radialGradient>'+
    '<radialGradient id="face" cx=".39" cy=".34" r=".74"><stop stop-color="#ffe0b9"/><stop offset=".55" stop-color="'+seed.skin+'"/><stop offset="1" stop-color="#935e48"/></radialGradient>'+
    '<linearGradient id="coat" x2="1" y2=".7"><stop stop-color="'+seed.shirt+'"/><stop offset="1" stop-color="#283b57"/></linearGradient></defs>'+
    '<rect width="100" height="100" fill="url(#sky)"/>'+
    '<circle cx="81" cy="19" r="24" fill="#fff" opacity=".12"/>'+
    '<path d="M5 105Q6 79 31 77L43 72L57 72L69 77Q93 80 95 105Z" fill="url(#coat)"/>'+
    '<path d="M41 67L59 67L60 79Q50 92 40 79Z" fill="'+seed.skin+'"/>'+
    '<path d="'+hair.slice(9,-3)+'" fill="'+seed.hair+'" opacity=".92"/>'+
    '<ellipse cx="50" cy="48" rx="25" ry="30" fill="url(#face)"/>'+
    '<path d="M25 45Q23 20 41 17Q63 12 75 29L72 41Q62 31 50 34Q37 30 28 47Z" fill="'+seed.hair+'"/>'+
    '<path d="M35 47q6-3 12 0m7 0q6-3 12 0" stroke="'+seed.hair+'" stroke-width="2.1" stroke-linecap="round" fill="none"/>'+
    '<ellipse cx="41" cy="50" rx="2.1" ry="2.7" fill="#24313b"/><ellipse cx="59" cy="50" rx="2.1" ry="2.7" fill="#24313b"/>'+
    '<path d="M50 52l-2 8q3 2 6-1" fill="none" stroke="#985f4a" stroke-width="1.5" opacity=".6"/>'+
    '<path d="M41 64Q50 69 59 64" fill="none" stroke="#984c4f" stroke-width="2.2" stroke-linecap="round"/>'+
    '<path d="M28 55Q25 53 25 50M73 55Q76 53 75 50" fill="none" stroke="'+seed.skin+'" stroke-width="3"/>'+
    '<path d="M8 100Q23 87 37 85m26 0q14 3 29 15" fill="none" stroke="#f3fbff" stroke-opacity=".15" stroke-width="3"/>'+
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
const list=seeds.map(seed=>Object.freeze({
  id:seed.id,
  name:seed.name,
  demo:true,
  avatarUrl:photo(seed),
  visual:Object.freeze({bodyColor:seed.bodyColor,shadowColor:seed.shadowColor,
    rimColor:seed.rimColor}),
  position:Object.freeze({
    mallId:'aventura-mall-reference',
    floor:seed.floor,
    x:seed.x,
    y:seed.y,
    source:'mock',
    coordinateSpace:'provisional-plan-pixels',
    // Later a calibrated indoor reference frame will map plan pixels to meters
    // and world geodetic coordinates without changing identity or renderer.
    verified:false
  })
}));
window.RETAILNAV_DEMO_CONTACTS=Object.freeze(list);
window.RETAILNAV_MARKER_PALETTE=window.RETAILNAV_MARKER_PALETTE||{
  defaultBodyColor:'#65e6e0',
  defaultShadowColor:'#25627c',
  defaultRimColor:'#e8ffff',
  byPerson:{}
};
})();