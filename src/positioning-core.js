/* RetailNav Positioning Core v1.
 * Deterministic uncertainty/height policy; never infer a floor from GPS when
 * vertical accuracy, datum or surveyed floor elevations are unavailable.
 * Does not use mall infrastructure or transmit sensor observations.
 */
(()=>{
'use strict';
const now=()=>Date.now();
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function gpsObservation(position){
 if(!position||!position.coords)return null;
 const c=position.coords;
 if(!finite(c.latitude)||!finite(c.longitude)||!finite(c.accuracy)||c.accuracy<0)return null;
 return {
  latitude:c.latitude,longitude:c.longitude,
  horizontalAccuracyM:c.accuracy,
  altitudeM:finite(c.altitude)?c.altitude:null,
  verticalAccuracyM:finite(c.altitudeAccuracy)&&c.altitudeAccuracy>=0?c.altitudeAccuracy:null,
  timestampMs:finite(position.timestamp)?position.timestamp:now(),
  source:'browser-geolocation'
 };
}
function floorFromAltitude(gps,calibration){
 const rejection=reason=>({floor:null,reason,candidates:[],verified:false});
 if(!gps)return rejection('gps-unavailable');
 if(!calibration||calibration.verified!==true||
   calibration.verticalDatum!=='WGS84-ellipsoid'||
   !calibration.floorAltitudesM||typeof calibration.floorAltitudesM!=='object')
  return rejection('floor-heights-not-survey-calibrated');
 if(!finite(gps.altitudeM)||!finite(gps.verticalAccuracyM))
  return rejection('vertical-accuracy-unavailable');
 if(gps.verticalAccuracyM>2)return rejection('vertical-accuracy-insufficient');
 const entries=Object.entries(calibration.floorAltitudesM).filter(([,v])=>finite(v));
 if(entries.length<2)return rejection('floor-heights-unavailable');
 const sigma=Math.max(gps.verticalAccuracyM,0.7);
 const p=entries.map(([floor,altitude])=>({
  floor,differenceM:Math.abs(gps.altitudeM-altitude),
  weight:Math.exp(-.5*((gps.altitudeM-altitude)/sigma)**2)
 })).sort((a,b)=>a.differenceM-b.differenceM);
 const mass=p.reduce((a,x)=>a+x.weight,0)||1;
 const candidates=p.map(x=>({floor:x.floor,differenceM:x.differenceM,
  probability:x.weight/mass}));
 const best=candidates[0];
 if(best.differenceM>2.5*sigma||best.probability<.93)
  return {floor:null,reason:'floors-ambiguous',candidates,verified:false};
 return {floor:best.floor,reason:'vertical-gps-survey-calibrated',
  candidates,verified:true};
}
// Convert GNSS latitude/longitude into a specific indoor floor polygon ONLY
// after both geo registration and absolute-height datum have been surveyed.
// Otherwise GPS is useful for mall proximity, never for an invented map point.
function registeredGpsToPhoto(gps,calibration){
 const reject=reason=>({anchor:null,reason});
 const registration=calibration?.geoReference;
 if(!gps||!finite(gps.latitude)||!finite(gps.longitude))
  return reject('gps-latitude-longitude-unavailable');
 if(!calibration||calibration.verified!==true||
   !registration||registration.approved!==true||
   registration.datum!=='WGS84'||
   !Number.isFinite(registration.originLatitude)||
   !Number.isFinite(registration.originLongitude)||
   !Array.isArray(registration.xPx)||!Array.isArray(registration.yPx)||
   registration.xPx.length!==3||registration.yPx.length!==3||
   ![...registration.xPx,...registration.yPx].every(finite)||
   !finite(registration.rootMeanSquareErrorM)||
   registration.rootMeanSquareErrorM>5)
  return reject('plan-to-geographic-registration-unverified');
 if(!finite(gps.horizontalAccuracyM)||gps.horizontalAccuracyM>15)
  return reject('horizontal-gps-accuracy-insufficient');
 const floor=floorFromAltitude(gps,calibration);
 if(!floor.floor)return reject('vertical-floor-unverified-'+floor.reason);
 const rad=registration.originLatitude*Math.PI/180;
 const east=(gps.longitude-registration.originLongitude)*111320*Math.cos(rad);
 const north=(gps.latitude-registration.originLatitude)*111132;
 // Two independently calibrated affine rows, in photo PIXELS.
 const [x0,xe,xn]=registration.xPx,[y0,ye,yn]=registration.yPx;
 const x=x0+xe*east+xn*north,y=y0+ye*east+yn*north;
 const width=registration.imageWidth,height=registration.imageHeight;
 if(![x,y,width,height].every(finite)||width<1||height<1||
   x<0||y<0||x>width||y>height)return reject('gps-fix-outside-surveyed-plan');
 const uncertaintyM=Math.hypot(gps.horizontalAccuracyM,registration.rootMeanSquareErrorM);
 return {anchor:{floor:floor.floor,x,y,source:'gps-survey-registered',
   timestampMs:gps.timestampMs,uncertaintyM},
   reason:'gnss-3d-survey-registered',floorConfidence:floor.candidates[0].probability};
}
function evaluate({gps=null,anchor=null,nearMall=false,calibration=null,
 clockMs=now(),floorIds=[]}={}){
 const g=gps&&finite(gps.timestampMs)&&clockMs-gps.timestampMs>=0&&
   clockMs-gps.timestampMs<30000?gps:null;
 const floor=floorFromAltitude(g,calibration);
 const manual=anchor&&floorIds.includes(anchor.floor)&&finite(anchor.x)&&
   finite(anchor.y)&&finite(anchor.timestampMs)&&
   clockMs-anchor.timestampMs>=0&&clockMs-anchor.timestampMs<
     (anchor.source==='peer-qr-colocation-asserted'?120000:
      anchor.source==='gps-survey-registered'?30000:30*60000)
   ?anchor:null;
 const geo=registeredGpsToPhoto(g,calibration);
 const candidate=geo.anchor&&floorIds.includes(geo.anchor.floor)?geo.anchor:null;
 const a=manual||candidate;
 let status='unlocated',reason='no-indoor-reference';
 if(a){
  status=a.source==='peer-qr-colocation-asserted'?'cooperative-provisional':'manual-reference';
  reason=a.source==='peer-qr-colocation-asserted'?
   'peer-proximity-not-measured':a.source==='gps-survey-registered'?
   'gnss-3d-survey-registered':'manually-selected-on-map';
  if(a.source==='gps-survey-registered')status='gps-survey-registered';
 }else if(g&&nearMall){status='gps-near-mall';reason='gps-is-not-map-registered';}
 else if(g){status='gps-only';reason='not-near-calibrated-indoor-reference';}
 let uncertaintyM=a&&finite(a.uncertaintyM)&&a.uncertaintyM>=0?
   a.uncertaintyM:null;
 if(a&&a.source==='peer-qr-colocation-asserted'&&uncertaintyM!==null)
  uncertaintyM=Math.max(uncertaintyM,12);
 // No valid metric calibration -> do not manufacture a metre radius.
 const helpNeeded=!a||(uncertaintyM!==null&&uncertaintyM>18);
 return {status,reason,gpsAvailable:Boolean(g),
  gpsHorizontalAccuracyM:g?.horizontalAccuracyM??null,
  gpsVerticalAccuracyM:g?.verticalAccuracyM??null,
  gpsAltitudeM:g?.altitudeM??null,
  floorFromGps:floor.floor,floorGpsReason:floor.reason,
  floorCandidates:floor.candidates,
  anchor:a?{floor:a.floor,x:a.x,y:a.y,source:a.source}:null,
  horizontalUncertaintyM:uncertaintyM,
  helpNeeded,consumer:'positioning-ui',
  noMallInfrastructureRequired:true,
  peerPhysicalRangeVerified:false,
  canAutoPositionOnPhoto:false};
}
function chooseTransport({nativeUwb=false,nativeRtt=false,nativeBle=false,
 acousticPermission=false,browser=true}={}){
 if(nativeUwb)return {method:'uwb',ranging:true,reason:'native-compatible-ranging'};
 if(nativeRtt)return {method:'wifi-rtt',ranging:true,reason:'native-compatible-ranging'};
 // BLE RSSI must never be treated as a verified distance measurement.
 if(nativeBle)return {method:'ble-proximity',ranging:false,reason:'native-coarse'};
 if(acousticPermission)return {method:'acoustic-experimental',ranging:false,
  reason:'requires-calibrated-bidirectional-protocol'};
 return {method:'qr-explicit-colocation',ranging:false,
  reason:browser?'web-physical-ranging-unavailable':'no-compatible-hardware'};
}
window.RetailNavPositioningCore=Object.freeze({
 gpsObservation,floorFromAltitude,registeredGpsToPhoto,evaluate,chooseTransport
});
})();