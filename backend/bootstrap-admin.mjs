#!/usr/bin/env node
// Run ONLY from a trusted RetailNav server console, never from the public browser.
// Example: RETAILNAV_DATA_DIR=/home/iankmp/retailnav-host/state node backend/bootstrap-admin.mjs platform manager@example.com
import crypto from 'node:crypto';
import {provisionAdmin} from './mall-admin.mjs';

const [kind,username,mallId]=process.argv.slice(2);
if(!['platform','tenant'].includes(kind)||!username||(kind==='tenant'&&!mallId)){
 console.error('Uso: node backend/bootstrap-admin.mjs platform <usuario> | tenant <usuario> <id-shopping>');
 process.exitCode=2;
}else{
 const secret=crypto.randomBytes(30).toString('base64url');
 try{
  const created=provisionAdmin({username,password:secret,role:kind,mallId:kind==='tenant'?mallId:null});
  console.log('Cuenta administrativa creada:',JSON.stringify(created));
  console.log('CONTRASEÑA ÚNICA (guardar de manera segura; no registrar en tickets o Git):',secret);
  console.log('Ingresar en https://improvingyourreality.com/retailnav/admin/');
 }catch(e){
  console.error('Error:',e.message);
  process.exitCode=1;
 }
}
