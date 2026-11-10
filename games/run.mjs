/**
 * Запуск и сборка мини-игр.
 *
 *   node games/run.mjs dev tea          — локальный сервер одной игры
 *   node games/run.mjs build            — собрать все игры в dist-games/<игра>/ и dist-games/<игра>.zip
 *   node games/run.mjs build tea half   — собрать только указанные
 *
 * Zip пишется без внешних утилит (метод «без сжатия»), поэтому сборка работает и на Windows.
 * В архиве index.html лежит в корне, все пути относительные — так требует Яндекс Игры.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
export const GAMES = ['tea', 'half', 'bubble', 'drain'];

function config(id) {
  return {
    root: join(here, id),
    base: './',
    configFile: false,
    logLevel: 'warn',
    server: { host: true, port: 5180, fs: { allow: [here] } },
    build: { outDir: resolve(here, '..', 'dist-games', id), emptyOutDir: true, target: 'es2020', assetsInlineLimit: 0 },
  };
}

// ——— zip без сжатия ———
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Дата и время в формате DOS для заголовков zip. */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function zipDir(dir, out) {
  const { time, date } = dosDateTime();
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of walk(dir).sort()) {
    const name = Buffer.from(relative(dir, file).split('\\').join('/'));
    const data = readFileSync(file);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // имена в UTF-8
    head.writeUInt16LE(0, 8); // без сжатия
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += head.length + name.length + data.length;
  }
  const cenSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cenSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(out, Buffer.concat([...local, ...central, end]));
}

async function main() {
  const [cmd, ...ids] = process.argv.slice(2);
  const list = ids.length ? ids : GAMES;
  for (const id of list) if (!GAMES.includes(id)) throw new Error(`Неизвестная игра: ${id}. Есть: ${GAMES.join(', ')}`);

  if (cmd === 'dev') {
    const server = await createServer(config(list[0]));
    await server.listen();
    server.printUrls();
    return;
  }
  if (cmd === 'build') {
    const outRoot = resolve(here, '..', 'dist-games');
    mkdirSync(outRoot, { recursive: true });
    for (const id of list) {
      await build(config(id));
      const zip = join(outRoot, `${id}.zip`);
      rmSync(zip, { force: true });
      zipDir(join(outRoot, id), zip);
      console.log(`${id}: ${relative(process.cwd(), zip)} (${statSync(zip).size} байт)`);
    }
    return;
  }
  console.log('Использование: node games/run.mjs dev <игра> | build [игры...]');
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
