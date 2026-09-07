/**
 * A zip file, written by hand.
 *
 * Node has no zip writer and the console has no dependency that does. Adding
 * one for this would be a package, a lockfile change and a supply chain, to do
 * something that is about seventy lines when nothing is compressed.
 *
 * Nothing is compressed on purpose. These archives hold a handful of HTML
 * files; deflate would need zlib streaming for a saving nobody would notice on
 * a download that is already instant. Stored entries are the simplest thing
 * that produces a file every unzip tool on every platform will open.
 *
 * The format, briefly, because it is otherwise a wall of magic numbers: each
 * file gets a local header then its bytes; then a central directory repeats
 * those headers with the offset of each; then a record saying where the
 * directory starts and how many entries it holds. Readers work backwards from
 * that last record, which is why a zip can be appended to.
 */

/** CRC-32, which every entry carries and every reader checks. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** The path inside the archive. Forward slashes, no leading slash. */
  name: string;
  content: string;
}

/**
 * Every timestamp is the same fixed moment.
 *
 * Zip stores MS-DOS times, and using the clock would make two exports of an
 * unchanged site produce different bytes. A fixed date makes an export
 * reproducible, which is worth more than knowing when it was downloaded —
 * the file's own modified time already says that.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1 January 1980, the earliest the format allows.

export function zip(entries: ZipEntry[]): Buffer {
  const encoder = new TextEncoder();
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const sum = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: names are UTF-8
    local.writeUInt16LE(0, 8); // stored, not deflated
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // and the real one, being the same
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    Buffer.from(name).copy(local, 30);

    locals.push(local, Buffer.from(data));

    const entryHeader = Buffer.alloc(46 + name.length);
    entryHeader.writeUInt32LE(0x02014b50, 0); // central directory header
    entryHeader.writeUInt16LE(20, 4); // version made by
    entryHeader.writeUInt16LE(20, 6); // version needed
    entryHeader.writeUInt16LE(0x0800, 8);
    entryHeader.writeUInt16LE(0, 10);
    entryHeader.writeUInt16LE(DOS_TIME, 12);
    entryHeader.writeUInt16LE(DOS_DATE, 14);
    entryHeader.writeUInt32LE(sum, 16);
    entryHeader.writeUInt32LE(data.length, 20);
    entryHeader.writeUInt32LE(data.length, 24);
    entryHeader.writeUInt16LE(name.length, 28);
    entryHeader.writeUInt16LE(0, 30); // extra
    entryHeader.writeUInt16LE(0, 32); // comment
    entryHeader.writeUInt16LE(0, 34); // disk number
    entryHeader.writeUInt16LE(0, 36); // internal attributes
    entryHeader.writeUInt32LE(0, 38); // external attributes
    entryHeader.writeUInt32LE(offset, 42); // where its local header is
    Buffer.from(name).copy(entryHeader, 46);

    central.push(entryHeader);
    offset += local.length + data.length;
  }

  const directory = Buffer.concat(central);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // the disk the directory starts on
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no comment

  return Buffer.concat([...locals, directory, end]);
}
