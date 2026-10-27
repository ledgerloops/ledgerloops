import net from 'node:net';

// A transparent loopback TCP proxy. It does not change engine protocol frames.
// Counts WebSocket frame payloads separately from TCP-stream bytes (WS headers included).
export async function wireProxy(upstreamPort) {
  let counts, enabled = true;
  const sockets = new Set();
  const fresh = () => ({ received_tcp_stream_bytes: 0, sent_tcp_stream_bytes: 0,
    received_ws_payload_bytes: 0, sent_ws_payload_bytes: 0, received_ws_frames: 0,
    compressed_ws_frames: 0, http_bytes: 0, received_engine_decoded_channel_bytes:0,
    received_engine_compressed_channel_bytes:0, received_engine_channel_frames:0,
    engine_codecs:{}, engine_frame_parse_errors:0 });
  counts = fresh();
  // Read the pinned wire-v3 postcard envelope without decoding/replaying messages.
  // Channel extents declare both decoded_len and compressed payload length.
  function engineBatch(bytes) {
    const read = buffer => {
      let pos=0;
      const u=()=>{let n=0,scale=1,b;do{if(pos>=buffer.length)throw Error('truncated varint');b=buffer[pos++];n+=(b&127)*scale;scale*=128;}while(b&128);return n;};
      const take=n=>{if(pos+n>buffer.length)throw Error('truncated bytes');const b=buffer.subarray(pos,pos+n);pos+=n;return b;};
      const vector=()=>take(u());
      return {u,take,vector,end:()=>pos===buffer.length};
    };
    try {
      const batch=read(bytes),n=batch.u();if(n>4096)throw Error('frame count');
      for(let i=0;i<n;i++) {
        const frame=batch.vector(),r=read(frame),tag=r.u();
        if(tag!==4)continue;
        const version=r.u(),features=r.u();if(version!==3)throw Error('wire version');
        const hasSession=r.u();if(hasSession) { r.vector();r.u();if(r.u())r.vector(); }
        r.u();r.u();r.u();r.u();r.u();r.u();r.u();
        const decoded=r.u(),payload=r.vector();if(!r.end())throw Error('channel remainder');
        counts.received_engine_channel_frames++;
        counts.received_engine_decoded_channel_bytes+=decoded;
        counts.received_engine_compressed_channel_bytes+=payload.length;
        const codec=features&8?'lz4':features&16?'zstd':'none';counts.engine_codecs[codec]=(counts.engine_codecs[codec]??0)+1;
      }
      if(!batch.end())throw Error('batch remainder');
    } catch { counts.engine_frame_parse_errors++; }
  }
  function parser(direction) {
    let pending = Buffer.alloc(0), upgraded = false;
    return chunk => {
      counts[direction === 'in' ? 'received_tcp_stream_bytes' : 'sent_tcp_stream_bytes'] += chunk.length;
      pending = Buffer.concat([pending, chunk]);
      if (!upgraded) {
        const end = pending.indexOf('\r\n\r\n');
        if (end < 0) return;
        const header = pending.subarray(0, end + 4).toString();
        counts.http_bytes += end + 4;
        if (!/upgrade:\s*websocket/i.test(header)) { pending = Buffer.alloc(0); return; }
        upgraded = true; pending = pending.subarray(end + 4);
      }
      while (pending.length >= 2) {
        const a = pending[0], b = pending[1];
        let length = b & 127, off = 2;
        if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); off = 4; }
        if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); off = 10; }
        if (b & 128) off += 4;
        if (pending.length < off + length) return;
        counts[direction === 'in' ? 'received_ws_payload_bytes' : 'sent_ws_payload_bytes'] += length;
        if (direction === 'in') counts.received_ws_frames++;
        if (a & 64) counts.compressed_ws_frames++;
        if(direction==='in' && (a&15)===2 && !(a&64) && !(b&128))engineBatch(pending.subarray(off,off+length));
        pending = pending.subarray(off + length);
      }
    };
  }
  const server = net.createServer(downstream => {
    if (!enabled) { downstream.destroy(); return; }
    const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort });
    sockets.add(downstream); sockets.add(upstream);
    downstream.on('data', parser('out')); upstream.on('data', parser('in'));
    downstream.pipe(upstream); upstream.pipe(downstream);
    downstream.on('error', () => upstream.destroy()); upstream.on('error', () => downstream.destroy());
    downstream.on('close', () => { sockets.delete(downstream); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); downstream.destroy(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    reset() { counts = fresh(); },
    counts() { return structuredClone(counts); },
    offline(value=true) { enabled=!value; if(value) for(const sock of sockets) sock.destroy(); },
    async close() { for (const sock of sockets) sock.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}
