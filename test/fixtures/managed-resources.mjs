/** Synthetic ECMA-335/WebCIL payloads exercise the actual resource audit without a compiler. */
function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
function wasm(section, id = 11) {
  return Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, id]), leb(section.length), section]);
}
export function resourceMetadata(entries, { wide = false, precedingRows = 0 } = {}) {
  const names = [Buffer.from([0])], payload = [], nameIndexes = [], offsets = [];
  let stringSize = 1, resourceSize = 0;
  for (const { name, data } of entries) {
    const text = Buffer.from(name+"\0");nameIndexes.push(stringSize);names.push(text);stringSize += text.length;
    const bytes = Buffer.alloc(Math.ceil((4+data.length)/8)*8);bytes.writeUInt32LE(data.length);data.copy(bytes,4);
    offsets.push(resourceSize);payload.push(bytes);resourceSize += bytes.length;
  }
  const s = wide ? 4 : 2, rowSize = 8+s+2;
  const tables = Buffer.alloc(28+(precedingRows?4+precedingRows*2:0)+entries.length*rowSize);
  tables[6] = wide ? 1 : 0;tables.writeBigUInt64LE((1n<<40n)|(precedingRows?1n<<3n:0n),8);
  let cursor=24;
  if(precedingRows) { tables.writeUInt32LE(precedingRows,cursor);cursor+=4; }
  tables.writeUInt32LE(entries.length,cursor);cursor+=4+precedingRows*2;
  for(let i=0;i<entries.length;i++) {
    tables.writeUInt32LE(offsets[i],cursor);tables.writeUInt32LE(1,cursor+4);
    if(wide) tables.writeUInt32LE(nameIndexes[i],cursor+8);else tables.writeUInt16LE(nameIndexes[i],cursor+8);
    tables.writeUInt16LE(entries[i].external??0,cursor+8+s);cursor+=rowSize;
  }
  return { streams:new Map([["#~",tables],["#Strings",Buffer.concat(names)]]), resources:Buffer.concat(payload) };
}
export function resourceAssembly({streams,resources}) {
  const streamEntries=[...streams], headers=streamEntries.map(([name])=>Math.ceil((8+name.length+1)/4)*4);
  const headerSize=24+headers.reduce((a,b)=>a+b,0);
  const metadata=Buffer.alloc(headerSize+streamEntries.reduce((n,[,bytes])=>n+bytes.length,0));
  metadata.write('BSJB');metadata.writeUInt32LE(4,12);metadata.writeUInt16LE(streamEntries.length,22);
  let cursor=24,start=headerSize;
  for(let i=0;i<streamEntries.length;i++) {
    const [name,bytes]=streamEntries[i];metadata.writeUInt32LE(start,cursor);metadata.writeUInt32LE(bytes.length,cursor+4);metadata.write(name,cursor+8);
    bytes.copy(metadata,start);start+=bytes.length;cursor+=headers[i];
  }
  const bytes=Buffer.alloc(44+72+metadata.length+resources.length);
  bytes.write('WbIL');bytes.writeUInt16LE(1,8);bytes.writeUInt32LE(0x1000,12);bytes.writeUInt32LE(72,16);
  bytes.writeUInt32LE(bytes.length-44,28);bytes.writeUInt32LE(0x1000,32);bytes.writeUInt32LE(bytes.length-44,36);bytes.writeUInt32LE(44,40);
  bytes.writeUInt32LE(72,44);bytes.writeUInt32LE(0x1048,52);bytes.writeUInt32LE(metadata.length,56);
  bytes.writeUInt32LE(0x1048+metadata.length,68);bytes.writeUInt32LE(resources.length,72);
  metadata.copy(bytes,116);resources.copy(bytes,116+metadata.length);return wasm(bytes);
}
