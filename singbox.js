/**
 * Sub-Store 文件脚本：MyClash 覆写脚本 → sing-box 1.14+ 完整配置
 *
 * 原理：每次运行时下载 MyClash 的 mihomo 覆写脚本（Script/Script.js），
 * 用订阅节点执行它的 main()，再把生成的 mihomo 配置逐项转换成 sing-box 配置。
 * 策略组、分流规则、规则集、DNS、hosts 全部来自上游脚本，上游更新后无需改动本脚本。
 *
 * 参数（$arguments，均可省略，省略时使用下方默认值）：
 *   name    订阅或组合订阅名称
 *   type    subscription | collection
 *   script  上游覆写脚本地址
 *   port    覆盖混合代理端口
 */

// ==================== 可调整的默认值 ====================

const ARGS = typeof $arguments === 'object' && $arguments ? $arguments : {};

const SUB_NAME = ARGS.name || '自建机场-搬瓦工-美国';
const SUB_TYPE = ARGS.type || 'subscription';

// 上游脚本地址：按顺序尝试，全部失败时使用上次成功下载的缓存
const SCRIPT_URLS = ARGS.script
  ? [ARGS.script]
  : [
      'https://raw.githubusercontent.com/changshengyu/MyClash/main/Script/Script.js',
      'https://cdn.jsdmirror.com/gh/changshengyu/MyClash@main/Script/Script.js',
    ];

// 覆盖上游 ruleOptionsEnable 中的开关（例如 { 屏蔽国外QUIC: true }），留空则完全沿用上游
const RULE_OPTION_OVERRIDES = {};

// 覆盖生成结果中的部分设置
const OVERRIDES = {
  mixedPort: Number(ARGS.port) || 20808, // 与 v2rayN 相同，系统代理无需修改；设为 0 则沿用上游
  mixedListen: '127.0.0.1', // 上游 allow-lan 会监听所有网卡，这里只监听本机；设为 '' 则沿用上游
};

// mihomo 规则集（.mrs）对应的 sing-box 规则集（.srs）地址
function toSrsUrl(url) {
  return url
    .replace(/@meta\//, '@sing/')
    .replace(/\/meta\//, '/sing/')
    .replace(/\.mrs(\?.*)?$/, '.srs$1');
}

// ==================== 工具函数 ====================

const log = (...a) => console.log('[mihomo→sing-box]', ...a);
const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const isIP = (s) => isIPv4(s) || /^[0-9a-f:]+$/i.test(s) && s.includes(':');
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const uniq = (a) => [...new Set(a)];

function normalizePrefix(cidr) {
  const [ip, lenStr] = String(cidr).split('/');
  const len = Number(lenStr);
  if (isIPv4(ip)) {
    const n = ip.split('.').reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
    const masked = len === 0 ? 0n : (n >> BigInt(32 - len)) << BigInt(32 - len);
    const parts = [24n, 16n, 8n, 0n].map((s) => Number((masked >> s) & 255n));
    return `${parts.join('.')}/${len}`;
  }
  // IPv6
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].map((g) => BigInt(parseInt(g || '0', 16)));
  let n = groups.reduce((acc, g) => (acc << 16n) | g, 0n);
  n = len === 0 ? 0n : (n >> BigInt(128 - len)) << BigInt(128 - len);
  const out = [];
  for (let i = 7; i >= 0; i--) out.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16));
  return `${out.join(':').replace(/(^|:)0(:0)+(:|$)/, '::')}/${len}`;
}

async function httpGet(url) {
  const res = await $substore.http.get({ url, timeout: 15000 });
  const code = res.statusCode ?? res.status;
  if (code && code >= 400) throw new Error(`HTTP ${code}`);
  return res.body;
}

async function loadUpstreamScript() {
  const cacheKey = 'mihomo2singbox:upstream-script';
  const errors = [];
  for (const url of SCRIPT_URLS) {
    try {
      const body = await httpGet(url);
      if (typeof body === 'string' && /function\s+main\s*\(/.test(body)) {
        try {
          scriptResourceCache.set(cacheKey, body);
        } catch (e) {}
        return body;
      }
      errors.push(`${url}: 内容不是有效的覆写脚本`);
    } catch (e) {
      errors.push(`${url}: ${e.message ?? e}`);
    }
  }
  try {
    const cached = scriptResourceCache.get(cacheKey, 30 * 24 * 3600 * 1000);
    if (cached) {
      log('上游脚本下载失败，使用缓存：', errors.join('; '));
      return cached;
    }
  } catch (e) {}
  throw new Error(`无法下载上游覆写脚本：${errors.join('; ')}`);
}

function applyRuleOptionOverrides(code) {
  for (const [key, value] of Object.entries(RULE_OPTION_OVERRIDES)) {
    const re = new RegExp(`(\\b${key}\\s*:\\s*)(true|false)`);
    if (re.test(code)) code = code.replace(re, `$1${value}`);
    else log(`上游脚本中没有开关「${key}」，已忽略`);
  }
  return code;
}

// ==================== 1. 获取节点并执行上游脚本 ====================

const sbNodes = (
  (await produceArtifact({ type: SUB_TYPE, name: SUB_NAME, platform: 'sing-box', produceType: 'internal' })) || []
).filter((o) => o && o.tag);
const sbByTag = new Map(sbNodes.map((o) => [o.tag, o]));

const mihomoNodes = (
  (await produceArtifact({ type: SUB_TYPE, name: SUB_NAME, platform: 'mihomo', produceType: 'internal' })) || []
)
  .filter((p) => p && sbByTag.has(p.name)) // 只保留 sing-box 支持的节点
  .map((p) => ({ ...p, _sbTag: p.name }));

if (!mihomoNodes.length) {
  throw new Error(`订阅「${SUB_NAME}」中没有 sing-box 支持的节点（xhttp、VLESS encryption 等会被 Sub-Store 丢弃）`);
}

const upstreamCode = applyRuleOptionOverrides(await loadUpstreamScript());
const upstreamMain = new Function(`${upstreamCode}\n;return typeof main === 'function' ? main : undefined;`)();
if (typeof upstreamMain !== 'function') throw new Error('上游脚本中没有 main 函数');

const mc = await upstreamMain({ proxies: mihomoNodes, dns: {}, hosts: {} });

// ==================== 2. 出站：节点 / 直连 / 策略组 ====================

const REJECT_NAMES = new Set(['REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
const outbounds = [];
const nodeTags = [];
const directTags = new Set();
let needPlainDirect = false;

const IP_VERSION_STRATEGY = {
  'ipv4-prefer': 'prefer_ipv4',
  'ipv6-prefer': 'prefer_ipv6',
  ipv4: 'ipv4_only',
  ipv6: 'ipv6_only',
};

// 稍后填入 DNS 中直连用的服务器 tag
const directResolverRefs = [];

for (const p of mc.proxies || []) {
  if (p._sbTag) {
    const o = sbByTag.get(p._sbTag);
    if (!o) continue;
    o.tag = p.name;
    if (p['dialer-proxy']) o.detour = p['dialer-proxy'];
    nodeTags.push(o.tag);
    outbounds.push(o);
  } else if (String(p.type).toLowerCase() === 'direct') {
    const o = { type: 'direct', tag: p.name };
    directResolverRefs.push({ o, strategy: IP_VERSION_STRATEGY[p['ip-version']] });
    directTags.add(p.name);
    outbounds.push(o);
  }
}
// 链式代理等附带的辅助出站（如 shadowtls）
const usedNodeObjs = new Set(outbounds);
for (const o of sbNodes) if (!usedNodeObjs.has(o) && sbNodes.some((x) => x.detour === o.tag)) outbounds.push(o);

const allGroups = (mc['proxy-groups'] || []).filter((g) => g && g.name);
const globalGroup = allGroups.find((g) => g.name === 'GLOBAL');
const groups = allGroups.filter((g) => g.name !== 'GLOBAL');
const groupNames = new Set(groups.map((g) => g.name));
const rejectGroups = new Set();

function resolveMembers(g) {
  let members = [...toArray(g.proxies)];
  if (g['include-all'] || g['include-all-proxies']) members.push(...nodeTags);
  if (g.filter) {
    const re = new RegExp(g.filter, 'i');
    const extra = nodeTags.filter((t) => re.test(t));
    members = g['include-all'] || g['include-all-proxies'] ? [...toArray(g.proxies), ...extra] : [...members, ...extra];
  }
  if (g['exclude-filter']) {
    const re = new RegExp(g['exclude-filter'], 'i');
    members = members.filter((m) => groupNames.has(m) || !re.test(m));
  }
  return uniq(members);
}

// 先找出“只能拒绝”的组（如 AdBlock），规则里改为 reject 动作
for (const g of groups) {
  const members = resolveMembers(g);
  if (members.length && members.every((m) => REJECT_NAMES.has(m))) rejectGroups.add(g.name);
}
// 反复剔除空组，直到稳定
let changed = true;
const groupMembers = new Map(groups.map((g) => [g.name, resolveMembers(g)]));
while (changed) {
  changed = false;
  for (const g of groups) {
    if (rejectGroups.has(g.name)) continue;
    const members = groupMembers
      .get(g.name)
      .filter((m) => !REJECT_NAMES.has(m) && !rejectGroups.has(m) && (m === 'DIRECT' || groupNames.has(m) || nodeTags.includes(m) || directTags.has(m)));
    if (!members.length) {
      rejectGroups.add(g.name);
      log(`策略组「${g.name}」没有可用成员，按 empty-fallback 视为拒绝`);
      changed = true;
    }
    groupMembers.set(g.name, members);
  }
}

const groupOutbounds = [];
for (const g of groups) {
  if (rejectGroups.has(g.name)) continue;
  const members = groupMembers.get(g.name);
  if (members.includes('DIRECT')) needPlainDirect = true;
  const type = String(g.type).toLowerCase();
  if (type === 'select') {
    const o = { type: 'selector', tag: g.name, outbounds: members };
    if (g['default-selected'] && members.includes(g['default-selected'])) o.default = g['default-selected'];
    groupOutbounds.push(o);
  } else {
    // url-test / fallback / load-balance 在 sing-box 中都用 urltest 实现
    groupOutbounds.push({
      type: 'urltest',
      tag: g.name,
      outbounds: members,
      url: g.url || 'https://www.gstatic.com/generate_204',
      interval: `${g.interval || 300}s`,
      tolerance: Number(g.tolerance) || (type === 'url-test' ? 50 : 0),
      idle_timeout: '30m',
    });
  }
}

// 默认出口：GLOBAL 组的第一个成员（通常是“默认代理”）
const defaultTag =
  toArray(globalGroup?.proxies).find((n) => groupOutbounds.some((o) => o.tag === n)) || groupOutbounds[0]?.tag;
groupOutbounds.sort((a, b) => (a.tag === defaultTag ? -1 : b.tag === defaultTag ? 1 : 0));

// 规则或策略组中引用的 DIRECT
const plainDirect = { type: 'direct', tag: 'DIRECT' };
outbounds.push(plainDirect);
directResolverRefs.push({ o: plainDirect });

// ==================== 3. 规则集 ====================

const ruleSets = new Map();
const providerInfo = new Map(); // name -> { ip: boolean }
const providers = mc['rule-providers'] || {};

function inlinePayloadToRules(payload, behavior) {
  const rule = {};
  const push = (k, v) => (rule[k] = rule[k] || []).push(v);
  for (let line of toArray(payload)) {
    line = String(line).trim();
    if (!line || line.startsWith('#')) continue;
    if (behavior === 'ipcidr') push('ip_cidr', line);
    else if (line.startsWith('+.')) push('domain_suffix', line.slice(2));
    else if (line.startsWith('.')) push('domain_suffix', line);
    else if (line.includes('*')) push('domain_regex', `^${line.replace(/\./g, '\\.').replace(/\*/g, '[^.]+')}$`);
    else push('domain', line);
  }
  return Object.keys(rule).length ? [rule] : [];
}

function useRuleSet(name) {
  if (ruleSets.has(name)) return true;
  const p = providers[name];
  if (!p) {
    log(`规则集「${name}」不存在，已跳过`);
    return false;
  }
  const ip = p.behavior === 'ipcidr';
  if (p.type === 'inline') {
    const rules = inlinePayloadToRules(p.payload, p.behavior);
    if (!rules.length || p.behavior === 'classical') return log(`内联规则集「${name}」无法转换，已跳过`), false;
    ruleSets.set(name, { type: 'inline', tag: name, rules });
  } else if (p.url && (p.format === 'mrs' || /\.mrs(\?|$)/.test(p.url))) {
    ruleSets.set(name, {
      type: 'remote',
      tag: name,
      format: 'binary',
      url: toSrsUrl(p.url),
      update_interval: `${Number(p.interval) || 86400}s`,
    });
  } else {
    log(`规则集「${name}」格式（${p.format || p.behavior}）不支持转换，已跳过`);
    return false;
  }
  providerInfo.set(name, { ip });
  return true;
}

// ==================== 4. 路由规则 ====================

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((x) => x.trim());
}

// 把一条 mihomo 规则的匹配部分转换为 sing-box 规则字段；返回 { match, ip, noResolve } 或 null
function convertMatcher(type, value, options = []) {
  const T = type.toUpperCase();
  const noResolve = options.some((o) => o.toLowerCase() === 'no-resolve');
  switch (T) {
    case 'DOMAIN':
      return { match: { domain: [value] } };
    case 'DOMAIN-SUFFIX':
      return { match: { domain_suffix: [value] } };
    case 'DOMAIN-KEYWORD':
      return { match: { domain_keyword: [value] } };
    case 'DOMAIN-REGEX':
      return { match: { domain_regex: [value] } };
    case 'DOMAIN-WILDCARD':
      return { match: { domain_regex: [`^${value.replace(/\./g, '\\.').replace(/\*/g, '[^.]+').replace(/\?/g, '.')}$`] } };
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return { match: { ip_cidr: [value] }, ip: true, noResolve };
    case 'SRC-IP-CIDR':
      return { match: { source_ip_cidr: [value] } };
    case 'DST-PORT':
    case 'SRC-PORT': {
      const key = T === 'DST-PORT' ? 'port' : 'source_port';
      const m = {};
      for (const part of value.split(/[\/,]/)) {
        if (part.includes('-')) (m[`${key}_range`] = m[`${key}_range`] || []).push(part.replace('-', ':'));
        else (m[key] = m[key] || []).push(Number(part));
      }
      return { match: m };
    }
    case 'NETWORK':
      return { match: { network: [value.toLowerCase()] } };
    case 'PROCESS-NAME':
      return { match: { process_name: [value] } };
    case 'PROCESS-PATH':
      return { match: { process_path: [value] } };
    case 'PROCESS-PATH-REGEX':
      return { match: { process_path_regex: [value] } };
    case 'RULE-SET':
      if (!useRuleSet(value)) return null;
      return { match: { rule_set: [value] }, ip: providerInfo.get(value)?.ip, noResolve };
    case 'AND':
    case 'OR':
    case 'NOT': {
      const inner = value.replace(/^\(/, '').replace(/\)$/, '');
      const subs = splitTopLevel(inner).map((part) => {
        const fields = splitTopLevel(part.replace(/^\(/, '').replace(/\)$/, ''));
        return convertMatcher(fields[0], fields[1], fields.slice(2));
      });
      if (subs.some((s) => !s)) return null;
      if (T === 'NOT') {
        const m = subs[0].match;
        return { match: { ...m, invert: !m.invert } };
      }
      return { match: { type: 'logical', mode: T.toLowerCase(), rules: subs.map((s) => s.match) } };
    }
    default:
      return null;
  }
}

function targetToAction(target) {
  if (target === 'REJECT' || rejectGroups.has(target)) return { action: 'reject' };
  if (target === 'REJECT-DROP') return { action: 'reject', method: 'drop' };
  if (target === 'PASS') return null;
  if (target === 'DIRECT') return { outbound: 'DIRECT' };
  return { outbound: target };
}

const routeRules = [
  { action: 'sniff' },
  { protocol: 'dns', action: 'hijack-dns' },
  { clash_mode: 'direct', outbound: groupNames.has('直连') && !rejectGroups.has('直连') ? '直连' : 'DIRECT' },
  ...(defaultTag ? [{ clash_mode: 'global', outbound: defaultTag }] : []),
];
const routeHeaderLength = routeRules.length;
const hostsRouteRules = []; // 由 hosts 转换而来
let finalOutbound = defaultTag;
let resolveInserted = false;
const skipped = [];

for (const raw of mc.rules || []) {
  const line = String(raw).trim();
  if (!line || line.startsWith('#')) continue;
  const head = line.split(',')[0].toUpperCase();
  if (head === 'MATCH' || head === 'FINAL') {
    const t = line.split(',')[1].trim();
    finalOutbound = t === 'DIRECT' ? 'DIRECT' : rejectGroups.has(t) ? 'DIRECT' : t;
    continue;
  }
  let type, value, target, options;
  if (['AND', 'OR', 'NOT'].includes(head)) {
    const parts = splitTopLevel(line);
    [type, value, target, ...options] = parts;
  } else {
    [type, value, target, ...options] = line.split(',').map((x) => x.trim());
  }
  const conv = convertMatcher(type, value, options);
  const act = target !== undefined ? targetToAction(target) : null;
  if (!conv || !act) {
    if (!conv) skipped.push(line);
    continue;
  }
  if (conv.ip && !conv.noResolve && !resolveInserted) {
    routeRules.push({ action: 'resolve', server: '__DNS_FINAL__' });
    resolveInserted = true;
  }
  routeRules.push({ ...conv.match, ...act });
}
if (skipped.length) log(`以下规则无法转换，已跳过：\n  ${skipped.join('\n  ')}`);

// ==================== 5. DNS 与 hosts ====================

const mdns = mc.dns || {};
const dnsServers = [];
const dnsServerByKey = new Map();
const hostsPredefined = {};
const hostsRoute = { reject: [], override: [] };

// hosts：IP → hosts DNS 服务器；0.0.0.0 → 拒绝；域名 → 改写目标地址
for (const [pattern, value] of Object.entries(mc.hosts || {})) {
  const values = toArray(value).map(String);
  const matcher = pattern.startsWith('+.')
    ? { domain_suffix: [pattern.slice(2)] }
    : pattern.startsWith('.')
      ? { domain_suffix: [pattern] }
      : pattern.includes('*')
        ? null
        : { domain: [pattern] };
  if (!matcher) continue;
  if (values.every((v) => v === '0.0.0.0' || v === '::' || v === '127.0.0.1')) {
    hostsRoute.reject.push(matcher);
  } else if (values.every(isIP)) {
    if (matcher.domain) hostsPredefined[pattern] = values;
  } else if (values.length === 1 && matcher.domain) {
    hostsRoute.override.push({ ...matcher, action: 'route-options', override_address: values[0] });
  }
}
const hasHosts = Object.keys(hostsPredefined).length > 0;
if (hasHosts) dnsServers.push({ type: 'hosts', tag: 'hosts', predefined: hostsPredefined });

// 用于解析 DNS 服务器域名的引导服务器
function parseDnsSpec(raw) {
  let s = String(raw).trim();
  let detour = null;
  const hash = s.indexOf('#');
  if (hash >= 0) {
    const suffix = s.slice(hash + 1).split('&')[0].trim();
    s = s.slice(0, hash).trim();
    if (suffix && !/^direct$|直连/i.test(suffix) && !/=/.test(suffix)) detour = suffix;
  }
  if (/^system(:\/\/)?$/i.test(s)) return { type: 'local' };
  if (/^dhcp:\/\//i.test(s)) return { type: 'local' };
  let type = 'udp';
  let rest = s;
  const m = s.match(/^([a-z0-9]+):\/\/(.*)$/i);
  if (m) {
    type = { https: 'https', tls: 'tls', quic: 'quic', tcp: 'tcp', udp: 'udp', h3: 'h3' }[m[1].toLowerCase()] || 'udp';
    rest = m[2];
  }
  let path;
  const slash = rest.indexOf('/');
  if (slash >= 0) {
    path = rest.slice(slash);
    rest = rest.slice(0, slash);
  }
  let host = rest;
  let port;
  const v6 = rest.match(/^\[(.+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    port = v6[2];
  } else if (!isIP(rest) && rest.includes(':')) {
    [host, port] = rest.split(':');
  } else if (isIPv4(rest.split(':')[0]) && rest.includes(':')) {
    [host, port] = rest.split(':');
  }
  const spec = { type, server: host };
  if (port) spec.server_port = Number(port);
  if (path && (type === 'https' || type === 'h3') && path !== '/dns-query') spec.path = path;
  if (detour && groupNames.has(detour) && !rejectGroups.has(detour)) spec.detour = detour;
  return spec;
}

const bootstrapSpec = toArray(mdns['default-nameserver'])
  .map(parseDnsSpec)
  .find((s) => s.server && isIP(s.server) && !s.detour);
let bootstrapTag = null;

function dnsTag(spec) {
  if (spec.type === 'local') return 'dns-local';
  return `dns-${spec.type}-${spec.server}${spec.detour ? `@${spec.detour}` : ''}`;
}

function addDnsServer(raw) {
  const spec = typeof raw === 'string' ? parseDnsSpec(raw) : raw;
  const tag = dnsTag(spec);
  if (dnsServerByKey.has(tag)) return tag;
  const server = { ...spec, tag };
  if (spec.server && !isIP(spec.server)) {
    if (hasHosts && hostsPredefined[spec.server]) server.domain_resolver = 'hosts';
    else if (bootstrapSpec) {
      if (!bootstrapTag) bootstrapTag = addDnsServer({ ...bootstrapSpec });
      server.domain_resolver = bootstrapTag;
    }
  }
  dnsServerByKey.set(tag, server);
  dnsServers.push(server);
  return tag;
}

// 一个 mihomo DNS 列表只取第一个可用地址（sing-box 每条规则对应一个服务器）
function firstServer(list) {
  const arr = toArray(list).filter(Boolean);
  return arr.length ? addDnsServer(arr[0]) : null;
}

function dnsMatcher(key) {
  const k = String(key).trim();
  if (/^rule-set:/i.test(k)) {
    const names = k.slice(9).split(',').map((x) => x.trim()).filter((n) => useRuleSet(n) && !providerInfo.get(n)?.ip);
    return names.length ? { rule_set: names } : null;
  }
  if (/^geosite:/i.test(k)) return null;
  if (k.startsWith('+.')) return { domain_suffix: [k.slice(2)] };
  if (k.startsWith('.')) return { domain_suffix: [k] };
  if (k.includes('*')) return { domain_regex: [`^${k.replace(/\./g, '\\.').replace(/\*/g, '[^.]+')}$`] };
  return { domain: [k] };
}

const finalDns = firstServer(mdns.nameserver) || addDnsServer('223.5.5.5');
const proxyServerDns = firstServer(mdns['proxy-server-nameserver']) || firstServer(mdns['default-nameserver']) || finalDns;
const directDns = firstServer(mdns['direct-nameserver']) || proxyServerDns;

const fakeip = String(mdns['enhanced-mode']).toLowerCase() === 'fake-ip';
const dnsRules = [];
if (hasHosts) dnsRules.push({ domain: Object.keys(hostsPredefined), server: 'hosts' });
dnsRules.push({ clash_mode: 'direct', server: directDns });

const filterMatchers = fakeip ? toArray(mdns['fake-ip-filter']).map(dnsMatcher).filter(Boolean) : [];
const policyEntries = Object.entries(mdns['nameserver-policy'] || {})
  .map(([k, v]) => [dnsMatcher(k), firstServer(v)])
  .filter(([m, s]) => m && s);

for (const [m, server] of policyEntries) {
  if (fakeip) {
    // 与 mihomo 一致：被 fake-ip-filter 排除的域名，或非 A/AAAA 查询，才使用 nameserver-policy
    dnsRules.push({
      type: 'logical',
      mode: 'and',
      rules: [m, { type: 'logical', mode: 'or', rules: [...filterMatchers, { query_type: ['A', 'AAAA'], invert: true }] }],
      server,
    });
  } else {
    dnsRules.push({ ...m, server });
  }
}
if (fakeip) {
  if (filterMatchers.length) dnsRules.push({ type: 'logical', mode: 'or', rules: filterMatchers, server: finalDns });
  const fake = { type: 'fakeip', tag: 'dns-fakeip' };
  if (mdns['fake-ip-range']) fake.inet4_range = normalizePrefix(mdns['fake-ip-range']);
  else fake.inet4_range = '198.18.0.0/15';
  if (mdns.ipv6 !== false && mdns['fake-ip-range6']) fake.inet6_range = normalizePrefix(mdns['fake-ip-range6']);
  dnsServers.push(fake);
  dnsRules.push({ query_type: ['A', 'AAAA'], server: 'dns-fakeip' });
}

for (const r of directResolverRefs) {
  r.o.domain_resolver = r.strategy ? { server: directDns, strategy: r.strategy } : directDns;
}
for (const r of routeRules) if (r.server === '__DNS_FINAL__') r.server = finalDns;

// hosts 转换出的规则插在 sniff / hijack-dns / clash_mode 之后、上游规则之前
hostsRouteRules.push(...hostsRoute.reject.map((m) => ({ ...m, action: 'reject' })), ...hostsRoute.override);
routeRules.splice(routeHeaderLength, 0, ...hostsRouteRules);

// ==================== 6. 入站与其他 ====================

const inbounds = [];
const tun = mc.tun || {};
if (tun.enable) {
  inbounds.push({
    type: 'tun',
    tag: 'tun-in',
    address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
    auto_route: tun['auto-route'] !== false,
    strict_route: !!tun['strict-route'],
    stack: ['system', 'gvisor', 'mixed'].includes(String(tun.stack).toLowerCase()) ? String(tun.stack).toLowerCase() : 'mixed',
  });
}
const mixedPort = OVERRIDES.mixedPort || mc['mixed-port'] || mc.port;
if (mixedPort) {
  inbounds.push({
    type: 'mixed',
    tag: 'mixed-in',
    listen: OVERRIDES.mixedListen || (mc['allow-lan'] ? '::' : '127.0.0.1'),
    listen_port: Number(mixedPort),
  });
}

const experimental = {};
if (mc.profile?.['store-selected'] || mc.profile?.['store-fake-ip']) {
  experimental.cache_file = { enabled: true, store_fakeip: !!mc.profile?.['store-fake-ip'] };
}
if (mc['external-controller']) {
  experimental.clash_api = {
    external_controller: mc['external-controller'],
    default_mode: (mc.mode || 'rule').toLowerCase(),
  };
  if (mc['external-ui']) experimental.clash_api.external_ui = mc['external-ui'];
  if (mc['external-ui-url']) {
    experimental.clash_api.external_ui_download_url = mc['external-ui-url'];
    if (defaultTag) experimental.clash_api.external_ui_download_detour = defaultTag;
  }
  if (mc.secret) experimental.clash_api.secret = mc.secret;
}

const level = String(mc['log-level'] || 'info').toLowerCase();

const config = {
  log: level === 'silent' ? { disabled: true } : { level: level === 'warning' ? 'warn' : level, timestamp: true },
  dns: { servers: dnsServers, rules: dnsRules, final: finalDns },
  ...(mc.ntp?.enable && {
    ntp: {
      enabled: true,
      server: mc.ntp.server || 'time.apple.com',
      server_port: Number(mc.ntp.port) || 123,
      interval: `${Number(mc.ntp.interval) || 30}m`,
    },
  }),
  http_clients: [{ tag: 'direct-client' }],
  inbounds,
  outbounds: [...groupOutbounds, ...outbounds],
  route: {
    rules: routeRules,
    rule_set: [...ruleSets.values()],
    final: finalOutbound,
    auto_detect_interface: true,
    default_domain_resolver: proxyServerDns,
    default_http_client: 'direct-client',
    ...(mc['find-process-mode'] && mc['find-process-mode'] !== 'off' && { find_process: true }),
  },
  ...(Object.keys(experimental).length && { experimental }),
};

log(
  `完成：${nodeTags.length} 个节点，${groupOutbounds.length} 个策略组，${routeRules.length} 条路由规则，${ruleSets.size} 个规则集`,
);

$content = JSON.stringify(config, null, 2);
