// A small WebSocket server endpoint (RFC 6455) on Node's http upgrade event, so PongBench needs no dependencies:
// text frames, fragmentation, ping/pong, close, a size limit. Enough for one page talking to its own server.
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1 << 20;

/** Accept an upgrade request. Returns {send(text), close()}; calls onMessage(text) and onClose(). */
export function acceptWebSocket(req, socket, { onMessage, onClose } = {}) {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || !key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  let buf = Buffer.alloc(0), parts = [], open = true;
  const frame = (opcode, payload) => {
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | opcode, len])
      : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
        : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
    return Buffer.concat([head, payload]);
  };
  const close = (code = 1000) => {
    if (!open) return;
    open = false;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    try { socket.end(frame(8, p)); } catch { /* already gone */ }
    onClose?.();
  };

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (len > MAX_MESSAGE) return close(1009);
      if (!masked) return close(1002);                     // clients must mask
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (opcode === 8) return close();
      if (opcode === 9) { socket.write(frame(10, data)); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 0) {
        parts.push(data);
        if (parts.reduce((s, p) => s + p.length, 0) > MAX_MESSAGE) return close(1009);
        if (fin) { const text = Buffer.concat(parts).toString("utf8"); parts = []; onMessage?.(text); }
      }
    }
  });
  socket.on("close", () => { if (open) { open = false; onClose?.(); } });
  socket.on("error", () => { if (open) { open = false; onClose?.(); } });
  return {
    send(text) { if (open) socket.write(frame(1, Buffer.from(text, "utf8"))); },
    close,
    get open() { return open; },
  };
}
