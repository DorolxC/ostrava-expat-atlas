import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

class Protobuf {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  get pending() {
    return this.pos < this.bytes.length;
  }
  uint() {
    let value = 0;
    let multiplier = 1;
    let byte;
    do {
      byte = this.bytes[this.pos++];
      if (byte === undefined || multiplier > 2 ** 63) throw new Error('Invalid protobuf varint');
      value += (byte & 127) * multiplier;
      multiplier *= 128;
    } while (byte >= 128);
    return value;
  }
  block() {
    const length = this.uint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.bytes.length) throw new Error('Truncated protobuf field');
    return this.bytes.subarray(start, this.pos);
  }
  *fields() {
    while (this.pending) {
      const tag = this.uint();
      const id = tag >>> 3;
      const wire = tag & 7;
      if (wire === 0) yield [id, this.uint()];
      else if (wire === 2) yield [id, this.block()];
      else if (wire === 1 || wire === 5) this.pos += wire === 1 ? 8 : 4;
      else throw new Error('Unsupported protobuf wire type ' + wire);
    }
  }
}

const fields = (bytes) => new Map(new Protobuf(bytes).fields());
const signed = (n) => n % 2 ? -(n + 1) / 2 : n / 2;
const vector = (bytes, deltas = false) => {
  if (!bytes) return [];
  const reader = new Protobuf(bytes);
  const items = [];
  let previous = 0;
  while (reader.pending) {
    const raw = reader.uint();
    if (deltas) previous += signed(raw);
    items.push(deltas ? previous : raw);
  }
  return items;
};

export function* readPbf(filename) {
  const file = readFileSync(filename);
  let cursor = 0;
  while (cursor < file.length) {
    const headerSize = file.readUInt32BE(cursor);
    cursor += 4;
    if (!headerSize || headerSize > 65536) throw new Error('Invalid OSM PBF blob header');
    const header = fields(file.subarray(cursor, cursor + headerSize));
    cursor += headerSize;
    const size = header.get(3);
    if (!size || cursor + size > file.length) throw new Error('Truncated OSM PBF blob');
    const blob = fields(file.subarray(cursor, cursor + size));
    cursor += size;
    const buffer = blob.get(1) ?? (blob.has(3) ? inflateSync(blob.get(3)) : null);
    if (!buffer) throw new Error('OSM PBF blob uses unsupported compression');
    const type = header.get(1).toString();
    if (type === 'OSMHeader') {
      const metadata = fields(buffer);
      const timestamp = metadata.get(32);
      yield { type: 'header', timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null };
      continue;
    }
    if (type !== 'OSMData') continue;
    let strings = [];
    const groups = [];
    let granularity = 100, latOffset = 0, lonOffset = 0;
    for (const [key, value] of new Protobuf(buffer).fields()) {
      if (key === 1) strings = [...new Protobuf(value).fields()].map(([, text]) => text.toString('utf8'));
      if (key === 2) groups.push(value);
      if (key === 17) granularity = value;
      if (key === 19) latOffset = value;
      if (key === 20) lonOffset = value;
    }
    const coords = (lon, lat) => [
      Math.round((lonOffset + granularity * lon) / 100) / 1e7,
      Math.round((latOffset + granularity * lat) / 100) / 1e7,
    ];
    const readTags = (map) => {
      const keys = vector(map.get(2));
      const values = vector(map.get(3));
      return keys.length ? Object.fromEntries(keys.map((key, i) => [strings[key], strings[values[i]]])) : null;
    };
    for (const group of groups) {
      for (const [kind, value] of new Protobuf(group).fields()) {
        if (kind === 1) {
          const node = fields(value);
          const id = signed(node.get(1));
          yield { type: 'node', id, point: coords(signed(node.get(9)), signed(node.get(8))), tags: readTags(node) };
        } else if (kind === 2) {
          const dense = fields(value);
          const ids = vector(dense.get(1), true);
          const lats = vector(dense.get(8), true);
          const lons = vector(dense.get(9), true);
          const keyValues = dense.has(10) ? new Protobuf(dense.get(10)) : null;
          for (let i = 0; i < ids.length; i++) {
            let tags = null;
            while (keyValues?.pending) {
              const key = keyValues.uint();
              if (!key) break;
              (tags ??= {})[strings[key]] = strings[keyValues.uint()];
            }
            yield { type: 'node', id: ids[i], point: coords(lons[i], lats[i]), tags };
          }
        } else if (kind === 3) {
          const way = fields(value);
          yield { type: 'way', id: way.get(1), refs: vector(way.get(8), true), tags: readTags(way) };
        } else if (kind === 4) {
          const relation = fields(value);
          const refs = vector(relation.get(9), true);
          const roles = vector(relation.get(8));
          const types = vector(relation.get(10));
          yield {
            type: 'relation', id: relation.get(1), tags: readTags(relation),
            members: refs.map((ref, i) => ({ ref, role: strings[roles[i]], type: ['node', 'way', 'relation'][types[i]] })),
          };
        }
      }
    }
  }
}
