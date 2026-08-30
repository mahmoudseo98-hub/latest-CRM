// zk-protocol.js — pure-Node implementation of the ZKTeco TCP "standalonecomm" protocol
// Reference: public protocol notes (github.com/adrobinoga/zk-protocol) and pyzk (readthedocs).
// Header: command(2) checksum(2) session(2) reply(4) dataLen(2) reserved(2) = 14 bytes, then data.
const net = require('net');

const CMD = {
  CONNECT: 1000,
  EXIT: 1001,
  ENABLEDEVICE: 1004,
  DISABLEDEVICE: 1006,
  ACK_OK: 2000,
  ACK_ERROR: 2001,
  ACK_UNAUTH: 2002,
  ATTLOG_RRQ: 13,      // read attendance records (one record per packet)
  READ_ATTLOG: 60,
  GET_TIME: 32,
  AUTH: 1102,
  GET_FREE_SIZES: 50,
  GET_SERIAL: 1,       // (informational)
};

const RECORD_SIZE = 31; // user_id(24) verify(1) ts(4) status(1) reserved(1)

function computeChecksum(buf) {
  let sum = 0;
  for (const b of buf) sum = (sum + b) & 0xffff;
  return sum;
}

function buildPacket(command, data, sessionId, replyId) {
  const body = Buffer.from(data || []);
  const header = Buffer.alloc(14);
  header.writeUInt16LE(command, 0);
  header.writeUInt16LE(0, 2);            // checksum placeholder
  header.writeUInt16LE(sessionId || 0, 4);
  header.writeUInt32LE(replyId === undefined ? 0xffffffff : replyId, 6);
  header.writeUInt16LE(body.length, 10);
  header.writeUInt16LE(0, 12);           // reserved
  const full = Buffer.concat([header, body]);
  const cks = computeChecksum(full);
  full.writeUInt16LE(cks, 2);
  return full;
}

function parsePacket(buf) {
  if (buf.length < 14) return null;
  return {
    command: buf.readUInt16LE(0),
    checksum: buf.readUInt16LE(2),
    sessionId: buf.readUInt16LE(4),
    replyId: buf.readUInt32LE(6),
    dataLength: buf.readUInt16LE(10),
    reserved: buf.readUInt16LE(12),
    data: buf.subarray(14),
  };
}

function verifyChecksum(packet) {
  const buf = Buffer.from(packet.data);
  const header = Buffer.alloc(14);
  header.writeUInt16LE(packet.command, 0);
  header.writeUInt16LE(0, 2);
  header.writeUInt16LE(packet.sessionId, 4);
  header.writeUInt32LE(packet.replyId, 6);
  header.writeUInt16LE(packet.dataLength, 10);
  header.writeUInt16LE(packet.reserved, 12);
  const expected = computeChecksum(Buffer.concat([header, buf]));
  return expected === packet.checksum;
}

function decodeAttendanceRecord(data) {
  if (!data || data.length < RECORD_SIZE) return null;
  const userId = data.subarray(0, 24).toString('ascii').replace(/\0+$/, '').trim();
  const verifyType = data.readUInt8(24);
  const ts = data.readUInt32LE(25);
  const status = data.readUInt8(29);
  return { userId, verifyType, ts, status, date: new Date(ts * 1000).toISOString() };
}

/**
 * ZKClient — connect, auth, pull attendance, get time.
 */
class ZKClient extends require('events').EventEmitter {
  constructor({ host, port = 4370, password = 0, timeoutMs = 4000 } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.sessionId = 0;
    this.replyId = 0;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;
      sock.setTimeout(this.timeoutMs);
      sock.once('connect', async () => {
        sock.setTimeout(0);
        try {
          await this.handshake();
          this.connected = true;
          resolve();
        } catch (e) { reject(e); }
      });
      sock.once('error', (e) => reject(e));
      sock.once('timeout', () => reject(new Error('connect timeout')));
      sock.connect(this.port, this.host);
    });
  }

  _send(command, data) {
    const pkt = buildPacket(command, data, this.sessionId, this.replyId);
    this.socket.write(pkt);
  }

  _readPacket(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('read timeout')), timeoutMs);
      const onData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const pkt = this._tryExtract();
        if (pkt) {
          clearTimeout(timer);
          this.socket.removeListener('data', onData);
          resolve(pkt);
        }
      };
      this.socket.on('data', onData);
      this.socket.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  _tryExtract() {
    if (this.buffer.length < 14) return null;
    const pkt = parsePacket(this.buffer);
    if (pkt.dataLength > 65535) return null;
    const total = 14 + pkt.dataLength;
    if (this.buffer.length < total) return null;
    const full = this.buffer.subarray(0, total);
    this.buffer = this.buffer.subarray(total);
    return parsePacket(full);
  }

  async handshake() {
    // 1. CMD_CONNECT
    this._send(CMD.CONNECT);
    const r1 = await this._readPacket();
    if (r1.command === CMD.ACK_OK) {
      this.sessionId = r1.sessionId;
      this.replyId = r1.replyId || 0;
    } else if (r1.command === CMD.CONNECT) {
      this.sessionId = r1.sessionId;
      this.replyId = r1.replyId || 0;
    } else {
      throw new Error('unexpected CONNECT reply command=' + r1.command);
    }
    // 2. CMD_AUTH with password
    const pw = Buffer.alloc(4);
    pw.writeUInt32LE(this.password >>> 0, 0);
    this._send(CMD.AUTH, pw);
    const r2 = await this._readPacket();
    if (r2.command === CMD.ACK_UNAUTH) throw new Error('device rejected password (UNAUTH)');
    if (r2.command !== CMD.ACK_OK && r2.command !== CMD.AUTH) {
      throw new Error('unexpected AUTH reply command=' + r2.command);
    }
  }

  async getTime() {
    this._send(CMD.GET_TIME);
    const r = await this._readPacket();
    if (r.command !== CMD.GET_TIME) throw new Error('unexpected GET_TIME reply');
    const ts = r.data.readUInt32LE(0);
    return { ts, iso: new Date(ts * 1000).toISOString() };
  }

  /** Pull all attendance records since (optional) unix seconds; returns decoded records. */
  async readAttendance() {
    const records = [];
    // some devices reply with a burst of packets; read until quiet period
    const deadline = Date.now() + 2500;
    this._send(CMD.ATTLOG_RRQ);
    while (Date.now() < deadline) {
      try {
        const r = await this._readPacket(600);
        if (r.command === CMD.ATTLOG_RRQ && r.data.length >= RECORD_SIZE) {
          const rec = decodeAttendanceRecord(r.data);
          if (rec) records.push(rec);
        } else if (r.command === CMD.ACK_OK && records.length === 0) {
          continue;
        }
      } catch (e) {
        if (/timeout/.test(e.message)) break;
        throw e;
      }
    }
    return records;
  }

  async disableDevice() { this._send(CMD.DISABLEDEVICE); await this._readPacket(1500).catch(() => null); }
  async enableDevice() { this._send(CMD.ENABLEDEVICE); await this._readPacket(1500).catch(() => null); }

  disconnect() {
    try { this._send(CMD.EXIT); } catch (_) {}
    try { this.socket && this.socket.destroy(); } catch (_) {}
    this.connected = false;
  }
}

module.exports = { CMD, buildPacket, parsePacket, verifyChecksum, computeChecksum, decodeAttendanceRecord, ZKClient, RECORD_SIZE };
