// Transparent TCP relay; compressed frames are decoded outside all timed windows.
import net from 'node:net';
import zlib from 'node:zlib';
function dataBytes(payload){if(payload.length<6)return 0;const tf=payload.readUInt16BE(4);if((tf>>10)!==10)return 0;let offset=6;if(tf&0x100){if(payload.length<9)throw Error('Short RSocket metadata');offset=9+payload.readUIntBE(6,3);}return Math.max(0,payload.length-offset);}
export class Frames {
 constructor(counter,collect=()=>{}){this.counter=counter;this.collect=collect;this.buf=Buffer.alloc(0);this.headers=true;this.ignored=false;this.noContext=false;}
 push(chunk){if(this.ignored)return;this.buf=Buffer.concat([this.buf,chunk]);
  if(this.headers){const i=this.buf.indexOf('\r\n\r\n');if(i<0)return;const h=this.buf.subarray(0,i+4).toString();this.counter.responseHeaders.push(h);this.buf=this.buf.subarray(i+4);this.headers=false;this.noContext=h.includes('server_no_context_takeover');
   if(h.startsWith('HTTP/1.1 101'))this.counter.websocketUpgrades++;
   else {this.counter.nonWebsocketResponses++;this.ignored=true;this.buf=Buffer.alloc(0);return;}}
  while(this.buf.length>=2){const b=this.buf;let n=b[1]&127,pos=2;if(n===126){if(b.length<4)return;n=b.readUInt16BE(2);pos=4;}else if(n===127){if(b.length<10)return;n=Number(b.readBigUInt64BE(2));pos=10;}if(b[1]&128)pos+=4;if(b.length<pos+n)return;
   const payload=Buffer.from(b.subarray(pos,pos+n));this.counter.websocketPayloadBytes+=n;this.counter.websocketFrames++;
   const compressed=!!(b[0]&64);if(compressed)this.counter.compressedFrames++;
   if(!compressed&&(b[0]&15)===2)this.counter.rsocketPayloadDataBytes+=dataBytes(payload);
   this.collect({index:this.counter.websocketFrames,opcode:b[0]&15,fin:!!(b[0]&128),compressed,payload,noContext:this.noContext});this.buf=b.subarray(pos+n);
  }
 }
}
export async function decodeFrames(frames,start,end){
 // One continuous inflater per WebSocket preserves negotiated server context takeover.
 const streams=new Map();let protocolBytes=0,appBytes=0,messages=0;
 try{
  for(const frame of frames){if(frame.index>end)break;if(frame.opcode>=8)continue;
   let state=streams.get(frame.connection);if(!state){state={parts:[],compressed:false,inflater:null,chunks:[]};streams.set(frame.connection,state);}
   if(frame.opcode!==0){state.parts=[];state.compressed=frame.compressed;}
   state.parts.push(frame.payload);if(!frame.fin)continue;const encoded=Buffer.concat(state.parts);let decoded;
   if(state.compressed){if(!state.inflater){state.inflater=zlib.createInflateRaw();state.inflater.on('data',c=>state.chunks.push(c));}state.chunks=[];
    await new Promise((resolve,reject)=>{const bad=e=>reject(e);state.inflater.once('error',bad);state.inflater.write(encoded);state.inflater.write(Buffer.from([0,0,255,255]));state.inflater.flush(zlib.constants.Z_SYNC_FLUSH,()=>{state.inflater.removeListener('error',bad);resolve();});});
    decoded=Buffer.concat(state.chunks);if(frame.noContext){state.inflater.close();state.inflater=null;}
   }else decoded=encoded;
   if(frame.index>start){protocolBytes+=decoded.length;appBytes+=dataBytes(decoded);messages++;}
  }
 }finally{for(const s of streams.values())s.inflater?.close();}
 return {decodedWebsocketPayloadBytes:protocolBytes,rsocketPayloadDataBytes:appBytes,decodedMessages:messages};
}
export async function wireProxy(targetPort){
 const counter={tcpConnections:0,websocketUpgrades:0,tcpReceivedBytes:0,tcpSentBytes:0,websocketPayloadBytes:0,rsocketPayloadDataBytes:0,websocketFrames:0,compressedFrames:0,nonWebsocketResponses:0,responseHeaders:[]};const sockets=new Set();const frames=[];let connection=0;
 const server=net.createServer(client=>{counter.tcpConnections++;const id=++connection;const upstream=net.connect({host:'127.0.0.1',port:targetPort});const parser=new Frames(counter,f=>frames.push({...f,connection:id}));sockets.add(client);sockets.add(upstream);client.on('data',b=>counter.tcpSentBytes+=b.length);upstream.on('data',b=>{counter.tcpReceivedBytes+=b.length;parser.push(b);});client.pipe(upstream);upstream.pipe(client);client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>{sockets.delete(client);upstream.destroy();});upstream.on('close',()=>{sockets.delete(upstream);client.destroy();});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {port:server.address().port,counter,snapshot:()=>({...counter,responseHeaders:counter.responseHeaders.slice()}),decodeWindow:(a,b)=>decodeFrames(frames,a.websocketFrames,b.websocketFrames),close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
export function diffWire(a,b){return Object.fromEntries(Object.keys(b).filter(k=>typeof b[k]==='number').map(k=>[k,b[k]-a[k]]));}
