// 在 Sub-Store 之外运行 singbox.js：用脱敏节点样例模拟 produceArtifact，输出 sing-box 配置
// 用法：node test/run.mjs [输出文件] [上游脚本地址或本地路径]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'test/out/config.json');
const upstream = process.argv[3];

const fixtures = {
  'sing-box': JSON.parse(readFileSync(join(root, 'test/fixtures/nodes.singbox.json'), 'utf8')),
  mihomo: JSON.parse(readFileSync(join(root, 'test/fixtures/nodes.mihomo.json'), 'utf8')),
};

const produceArtifact = async ({ platform }) => structuredClone(fixtures[platform]);

const $substore = {
  http: {
    async get({ url }) {
      if (!/^https?:/.test(url)) return { statusCode: 200, body: readFileSync(url, 'utf8') };
      const res = await fetch(url);
      return { statusCode: res.status, body: await res.text() };
    },
  },
};

const cache = new Map();
const scriptResourceCache = { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) };

const args = upstream ? { script: upstream } : {};
const code = readFileSync(join(root, 'singbox.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction(
  '$arguments',
  'produceArtifact',
  '$substore',
  'scriptResourceCache',
  `let $content = '';\n${code}\nreturn $content;`,
);

const content = await run(args, produceArtifact, $substore, scriptResourceCache);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, content);
console.log(`已生成 ${out}`);
