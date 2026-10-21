'use strict';
// Минимальный парсер kiwi: схема + декодер сообщений.
function Reader(buf) { this.b = buf; this.i = 0; }
Reader.prototype.byte = function () { return this.b[this.i++]; };
Reader.prototype.bool = function () { return !!this.b[this.i++]; };
Reader.prototype.varint = function () {
  var v = 0, s = 0, c;
  do { c = this.b[this.i++]; v |= (c & 127) << s; s += 7; } while (c & 128);
  return v >>> 0;
};
Reader.prototype.svarint = function () { var v = this.varint(); return (v & 1) ? ~(v >>> 1) : (v >>> 1); };
Reader.prototype.float = function () {
  if (this.b[this.i] === 0) { this.i++; return 0; }
  var bits = this.b.readUInt32LE(this.i);
  this.i += 4;
  bits = ((bits << 23) | (bits >>> 9)) >>> 0;
  var t = Buffer.alloc(4); t.writeUInt32LE(bits, 0);
  return t.readFloatLE(0);
};
Reader.prototype.string = function () {
  var start = this.i;
  while (this.b[this.i] !== 0) { this.i++; }
  var s = this.b.toString('utf8', start, this.i);
  this.i++;
  return s;
};
Reader.prototype.eof = function () { return this.i >= this.b.length; };

var KINDS = ['ENUM', 'STRUCT', 'MESSAGE'];
var PRIM = { '-1': 'bool', '-2': 'byte', '-3': 'int', '-4': 'uint', '-5': 'float', '-6': 'string' };

function parseSchema(buf) {
  var r = new Reader(buf);
  var n = r.varint(), defs = [];
  for (var i = 0; i < n; i++) {
    var name = r.string();
    var kind = KINDS[r.byte()];
    var fc = r.varint(), fields = [];
    for (var j = 0; j < fc; j++) {
      var fname = r.string();
      var type = r.svarint();
      var isArray = r.bool();
      var value = r.varint();
      fields.push({ name: fname, type: type, isArray: isArray, value: value });
    }
    defs.push({ name: name, kind: kind, fields: fields });
  }
  return defs;
}

function makeDecoder(defs) {
  var byIndex = defs;
  function readValue(r, type) {
    if (type < 0) {
      switch (type) {
        case -1: return r.bool();
        case -2: return r.byte();
        case -3: return r.svarint();
        case -4: return r.varint();
        case -5: return r.float();
        case -6: return r.string();
      }
      throw new Error('bad prim ' + type);
    }
    var def = byIndex[type];
    if (!def) throw new Error('no def ' + type);
    if (def.kind === 'ENUM') {
      var v = r.varint();
      for (var i = 0; i < def.fields.length; i++) { if (def.fields[i].value === v) return def.fields[i].name; }
      return v;
    }
    return decode(r, def);
  }
  function decode(r, def) {
    var out = {};
    if (def.kind === 'STRUCT') {
      for (var i = 0; i < def.fields.length; i++) { out[def.fields[i].name] = readField(r, def.fields[i]); }
      return out;
    }
    while (true) {
      var id = r.varint();
      if (id === 0) return out;
      var f = null;
      for (var k = 0; k < def.fields.length; k++) { if (def.fields[k].value === id) { f = def.fields[k]; break; } }
      if (!f) throw new Error('unknown field ' + id + ' in ' + def.name);
      out[f.name] = readField(r, f);
    }
  }
  function readField(r, f) {
    if (f.isArray) {
      var len = r.varint(), arr = [];
      for (var i = 0; i < len; i++) { arr.push(readValue(r, f.type)); }
      return arr;
    }
    return readValue(r, f.type);
  }
  return { decode: decode, readValue: readValue };
}

module.exports = { Reader: Reader, parseSchema: parseSchema, makeDecoder: makeDecoder };
