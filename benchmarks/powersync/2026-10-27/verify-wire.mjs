import assert from 'node:assert/strict';
import {Frames} from './wire.mjs';
const counter={tcpConnections:0,websocketUpgrades:0,tcpReceivedBytes:0,tcpSentBytes:0,websocketPayloadBytes:0,rsocketPayloadDataBytes:0,websocketFrames:0,compressedFrames:0,nonWebsocketResponses:0,responseHeaders:[]};
const protocol=Buffer.alloc(6);protocol.writeUInt32BE(1,0);protocol.writeUInt16BE(10<<10,4);
const app=Buffer.from('{"checkpoint_complete":true}');const payload=Buffer.concat([protocol,app]);
const frame=Buffer.concat([Buffer.from([0x82,payload.length]),payload]);
const parser=new Frames(counter);const bytes=Buffer.concat([Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n'),frame]);
for(const b of bytes)parser.push(Buffer.from([b]));
assert.equal(counter.rsocketPayloadDataBytes,app.length);assert.equal(counter.websocketPayloadBytes,payload.length);assert.equal(counter.websocketFrames,1);
const http=new Frames(counter);http.push(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n'));http.push(Buffer.from('null'));assert.equal(counter.websocketFrames,1);assert.equal(counter.nonWebsocketResponses,1);
console.log('Fragmented network chunks and HTTP control responses counted correctly.');
const {decodeFrames}=await import('./wire.mjs');const {default:zlib}=await import('node:zlib');
const deflater=zlib.createDeflateRaw();let chunks=[];deflater.on('data',c=>chunks.push(c));
async function compress(b){chunks=[];deflater.write(b);await new Promise(r=>deflater.flush(zlib.constants.Z_SYNC_FLUSH,r));return Buffer.concat(chunks).subarray(0,-4);}
const payload2=Buffer.concat([protocol,Buffer.from('{"value":"checkpoint_complete checkpoint_complete"}')]);
const compressed1=await compress(payload);const compressed2=await compress(payload2);deflater.close();
const decoded=await decodeFrames([{index:1,connection:1,opcode:2,fin:true,compressed:true,payload:compressed1},{index:2,connection:1,opcode:2,fin:true,compressed:true,payload:compressed2}],1,2);
assert.equal(decoded.decodedWebsocketPayloadBytes,payload2.length);assert.equal(decoded.rsocketPayloadDataBytes,payload2.length-6);console.log('permessage-deflate context takeover and measurement-window boundaries verified.');
