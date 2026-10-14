import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const sandbox={window:{},Date,Math};
vm.runInNewContext(readFileSync('src/positioning-core.js','utf8'),sandbox,{filename:'src/positioning-core.js'});
const core=sandbox.window.RetailNavPositioningCore;
test('GPS reports altitude and precision without inventing a floor',()=>{
 const timestamp=Date.now();
 const gps=core.gpsObservation({timestamp,coords:{
  latitude:25.95,longitude:-80.14,accuracy:22,
  altitude:29.8,altitudeAccuracy:17
 }});
 assert.equal(gps.altitudeM,29.8);
 assert.equal(gps.verticalAccuracyM,17);
 assert.equal(core.floorFromAltitude(gps,null).floor,null);
 const e=core.evaluate({gps,clockMs:timestamp,nearMall:true,floorIds:['L1','L2']});
 assert.equal(e.status,'gps-near-mall');
 assert.equal(e.floorFromGps,null);
 assert.equal(e.helpNeeded,true);
 assert.equal(e.canAutoPositionOnPhoto,false);
});
test('no GPS altitude or missing accuracy never claims floor',()=>{
 const gps=core.gpsObservation({timestamp:Date.now(),coords:{
  latitude:1,longitude:2,accuracy:5,altitude:null,altitudeAccuracy:null}});
 assert.equal(gps.altitudeM,null);
 assert.equal(gps.verticalAccuracyM,null);
 const calibration={verified:true,verticalDatum:'WGS84-ellipsoid',
  floorAltitudesM:{L1:10,L2:14,L3:18}};
 assert.equal(core.floorFromAltitude(gps,calibration).floor,null);
 assert.equal(core.floorFromAltitude({altitudeM:14,verticalAccuracyM:10},calibration).floor,null);
 assert.equal(core.floorFromAltitude({altitudeM:14,verticalAccuracyM:1},{
  ...calibration,verified:false}).floor,null);
 assert.equal(core.floorFromAltitude({altitudeM:14,verticalAccuracyM:1},{
  ...calibration,verticalDatum:'mean-sea-level'}).floor,null);
});
test('only surveyed matching altitude datum + high confidence yields floor',()=>{
 const cal={verified:true,verticalDatum:'WGS84-ellipsoid',
  floorAltitudesM:{L1:10,L2:14,L3:18}};
 const r=core.floorFromAltitude({altitudeM:14.1,verticalAccuracyM:0.6},cal);
 assert.equal(r.floor,'L2');
 assert.equal(r.verified,true);
 assert.equal(core.floorFromAltitude({altitudeM:16,verticalAccuracyM:1.5},cal).floor,null);
 assert.equal(core.floorFromAltitude({altitudeM:50,verticalAccuracyM:0.5},cal).floor,null);
});
test('QR source is provisional; stale anchors and GPS never become a precise position',()=>{
 const t=Date.now(),floors=['L1','L2'];
 const peer=core.evaluate({floorIds:floors,clockMs:t,
  anchor:{floor:'L1',x:440,y:250,source:'peer-qr-colocation-asserted',
    uncertaintyM:2,timestampMs:t-500}});
 assert.equal(peer.status,'cooperative-provisional');
 assert.equal(peer.horizontalUncertaintyM,12);
 assert.equal(peer.peerPhysicalRangeVerified,false);
 const stale=core.evaluate({floorIds:floors,clockMs:t,
  anchor:{floor:'L1',x:440,y:250,source:'peer-qr-colocation-asserted',
    timestampMs:t-150000}});
 assert.equal(stale.anchor,null);
 assert.equal(stale.helpNeeded,true);
 const noScale=core.evaluate({floorIds:floors,clockMs:t,
  anchor:{floor:'L1',x:440,y:250,source:'peer-qr-colocation-asserted',
    timestampMs:t-10}});
 assert.equal(noScale.horizontalUncertaintyM,null);
 const wrongMall=core.evaluate({floorIds:floors,clockMs:t,
  anchor:{floor:'UL',x:440,y:250,source:'manual',timestampMs:t}});
 assert.equal(wrongMall.anchor,null);
});
test('transport is honest: web WebRTC/QR do not measure physical distances',()=>{
 assert.equal(core.chooseTransport({browser:true}).method,'qr-explicit-colocation');
 assert.equal(core.chooseTransport({browser:true}).ranging,false);
 assert.equal(core.chooseTransport({nativeBle:true}).ranging,false);
 assert.equal(core.chooseTransport({nativeUwb:true}).ranging,true);
 assert.equal(core.chooseTransport({nativeRtt:true}).ranging,true);
 assert.equal(core.chooseTransport({acousticPermission:true}).ranging,false);
});
