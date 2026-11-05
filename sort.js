/**
 * Sub-Store 节点排序脚本
 * 名称以“备用”开头的节点排到最后，其余节点在前；同组内保持原顺序
 * 请放在重命名脚本之后
 */
const BACKUP_PREFIX = '备用';

function operator(proxies) {
  return proxies
    .map((p, i) => ({ p, i, backup: (p.name || '').trim().startsWith(BACKUP_PREFIX) ? 1 : 0 }))
    .sort((a, b) => a.backup - b.backup || a.i - b.i)
    .map(x => x.p);
}
