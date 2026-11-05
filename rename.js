/**
 * Sub-Store 节点重命名脚本
 * 规则：  主力节点 = 厂商 + 国家 + 节点类型（Reality 节点、Hysteria2）
 *         备用节点 = 备用 + 厂商 + 国家 + 节点类型（其余全部）
 * 同名节点自动追加 01 / 02 … 序号
 */

// ===== 可调整的配置 =====
const SEP = ' ';                 // 各部分之间的分隔符；想紧挨着就改成 ''
const CDN_PREFIX = '备用';
const DEFAULT_VENDOR = '搬瓦工';  // 读不到订阅名时使用
const DEFAULT_COUNTRY = '美国';

const COUNTRIES = ['美国', '日本', '香港', '台湾', '新加坡', '韩国', '英国', '德国', '法国', '荷兰', '加拿大', '澳大利亚'];

function isIP(host = '') {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

// 从订阅名“自建机场-搬瓦工-美国”中解析厂商和国家
function parseSub(p) {
  const parts = (p._subName || '').split('-').map(s => s.trim()).filter(Boolean);
  let vendor = parts.length >= 2 ? parts[parts.length - 2] : DEFAULT_VENDOR;
  let country = parts.length >= 1 ? parts[parts.length - 1] : '';
  if (!COUNTRIES.includes(country)) {
    country = COUNTRIES.find(c => (p.name || '').includes(c)) || DEFAULT_COUNTRY;
  }
  return { vendor, country };
}

// 主力节点：Reality 节点 + Hysteria2；其余全部作为备用
const MAIN_TYPES = ['hysteria2'];
function isCDN(p) {
  const isMain = !!p['reality-opts'] || MAIN_TYPES.includes(p.type);
  return !isMain;
}

function nodeType(p) {
  switch (p.type) {
    case 'hysteria2': return 'Hy2';
    case 'hysteria': return 'Hy';
    case 'tuic': return 'TUIC';
    case 'ss': return 'SS';
  }
  const netMap = { xhttp: 'XHTTP', splithttp: 'XHTTP', grpc: 'gRPC', ws: 'WS', httpupgrade: 'HTTPUpgrade', h2: 'H2' };
  const reality = !!p['reality-opts'];
  const net = p.network || 'tcp';
  if (net === 'tcp') return reality ? 'Reality' : (p.type || '').toUpperCase();
  const base = netMap[net] || net.toUpperCase();
  return reality ? `${base}-Reality` : base;
}

function operator(proxies) {
  proxies.forEach(p => {
    const { vendor, country } = parseSub(p);
    let name = [vendor, country, nodeType(p)].join(SEP);
    if (isCDN(p)) name = CDN_PREFIX + SEP + name;
    p.name = name;
  });

  // 排序：普通节点在前，备用节点在后（同组内保持原顺序）
  proxies = proxies
    .map((p, i) => ({ p, i, backup: p.name.startsWith(CDN_PREFIX) ? 1 : 0 }))
    .sort((a, b) => a.backup - b.backup || a.i - b.i)
    .map(x => x.p);

  // 同名去重
  const total = {};
  proxies.forEach(p => { total[p.name] = (total[p.name] || 0) + 1; });
  const seen = {};
  proxies.forEach(p => {
    const base = p.name;
    if (total[base] > 1) {
      seen[base] = (seen[base] || 0) + 1;
      p.name = base + SEP + String(seen[base]).padStart(2, '0');
    }
  });
  return proxies;
}
