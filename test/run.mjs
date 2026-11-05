// 在 Sub-Store 之外运行 singbox.js：用脱敏节点样例模拟 Sub-Store 的 ProxyUtils，输出 sing-box 配置
// 用法：node test/run.mjs [输出文件] [上游脚本地址或本地路径]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'test/out/config.json');
const upstream = process.argv[3];

// 两份样例由 Sub-Store 的 sing-box / mihomo 生成器从同一组节点生成
const fixtures = {
  'sing-box': JSON.parse(readFileSync(join(root, 'test/fixtures/nodes.singbox.json'), 'utf8')),
  mihomo: JSON.parse(readFileSync(join(root, 'test/fixtures/nodes.mihomo.json'), 'utf8')),
};

const ProxyUtils = {
  parse: () => structuredClone(fixtures.mihomo),
  produce: (_proxies, platform) => structuredClone(fixtures[platform]),
};

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
  'ProxyUtils',
  '$substore',
  'scriptResourceCache',
  `let $content = 'proxies: [] # 由 ProxyUtils.parse 模拟';\n${code}\nreturn $content;`,
);

const content = await run(args, ProxyUtils, $substore, scriptResourceCache);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, content);
console.log(`已生成 ${out}`);
