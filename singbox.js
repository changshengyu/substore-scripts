// Sub-Store 普通文件 → 文件操作 → 脚本操作；不是节点操作脚本。
// 参数：name=组合订阅名称&type=collection；单订阅使用 type=subscription。
// tun=false 可关闭 TUN；lan=true 开放 LAN mixed；adblock=off/drop/reject。
if (typeof $content !== 'undefined') throw new Error('完整配置生成失败，请查看前面的 operator 错误，不能将原始文件作为配置使用');
async function operator(input) {
  if (!input || typeof input.$content !== 'string') throw new Error('请在普通文件的文件操作中运行');
  const args = typeof $arguments === 'object' ? $arguments : {};
  const enabled = (v, fallback) => v === undefined ? fallback : String(v) === 'true';
  const uniq = a => [...new Set(a)];
  let raw = args.name
    ? await produceArtifact({ type: args.type || 'collection', name: args.name, platform: 'JSON', produceType: 'internal' })
    : ProxyUtils.parse(input.$content);
  if (!Array.isArray(raw)) throw new Error('订阅未返回节点数组');
  const exclude = /(群|返利|循环|官网|客服|网站|网址|获取|订阅|流量|到期|机场|下次|版本|官址|过期|已用|联系|邮箱|工单|贩卖|通知|倒卖|防止|国内|地址|电报|频道|无法|说明|提示|访问|支持|教程|关注|更新|作者|加入|超时|收藏|优惠|福利|邀请|好友|失联|选择|剩余|公益|发布|DIZTNA|通路|登录|定时|渠道|牢记|永久|余额|阁下|本站|刷新|导航|建议|重置|以下|过滤|⚠️|@|t\.me\/\+|\bexpire\b|\bhttps?:\/\/|\.com|\btraffic\b)/i;
  const filters = [
    ['香港', /🇭🇰|香港|(?<![A-Za-z])HKG?(?![A-Za-z])|hong\s*kong/i],
    ['日本', /🇯🇵|日本|东京|大阪|京都|(?<![A-Za-z])JPN?(?![A-Za-z])|japan/i],
    ['美国', /🇺🇸|美国|纽约|洛杉矶|旧金山|芝加哥|休斯顿|迈阿密|西雅图|波士顿|华盛顿|拉斯维加斯|圣何塞|(?<![A-Za-z])USA?(?![A-Za-z])|america|united\s*states/i],
    ['新加坡', /🇸🇬|新加坡|狮城|(?<![A-Za-z])SGP?(?![A-Za-z])|singapore/i],
    ['台湾', /🇹🇼|台湾|台北|高雄|(?<![A-Za-z])TWN?(?![A-Za-z])|taiwan/i],
    ['低倍率节点', /^(?!.*(?:剩|期)).*(?:(?<![\d.])0(\.[0-5]|[*×✕✖⨯⨉x倍]))|(?:[*×✕✖⨯⨉x]0)|^(?!.*(?:客户端|软件)).*下载|低倍|免费|(?<![A-Za-z])free(?![A-Za-z])/i],
    ['高倍率节点', /(?:[*×✕✖⨯⨉x](?:[2-9]\d*|[1-9]\d+)(?:\.\d+)?)|(?:(?<![\d.])(?:[2-9]\d*|[1-9]\d+)(?:\.\d+)?(?:倍|[*×✕✖⨯⨉x]))/i],
    ['家宽节点', /家宽|住宅|原生\s*IP|家庭宽带|\bISP\b|\bRES\b|residential/i]
  ];
  const reserved = new Set(['默认代理','手动选择','自动选择','Google','AI','Telegram','Steam','漏网之鱼','直连','GLOBAL', ...filters.flatMap(([n]) => [n, `${n}-自动选择`]),'其他节点','其他节点-自动选择']);
  raw = JSON.parse(JSON.stringify(raw)).filter(p => p && p.name && !exclude.test(p.name) && !['direct','reject','block','selector','urltest'].includes(String(p.type).toLowerCase()));
  if (raw.some(p => p['dialer-proxy'] || p['underlying-proxy'] || p.detour)) throw new Error('不支持自动改名的链式节点，请在来源中先处理节点链');
  for (const p of raw) {
    const base = String(p.name).trim();
    let tag = base, i = 2;
    while (reserved.has(tag)) tag = `${base} (${i++})`;
    reserved.add(tag); p.name = tag;
  }
  if (!raw.length) throw new Error('过滤后没有有效节点');
  const produced = ProxyUtils.produce(raw, 'sing-box');
  const converted = typeof produced === 'string' ? JSON.parse(produced) : produced;
  const nodes = Array.isArray(converted) ? converted : converted.outbounds;
  if (!Array.isArray(nodes) || !nodes.length) throw new Error('没有可转换为 sing-box 的节点');
  if (nodes.length !== raw.length) console.log(`[singbox-lite] 来源 ${raw.length} 个节点，转换后 ${nodes.length} 个，请检查不支持的协议`);
  for (const p of nodes) {
    if (p.domain_strategy) throw new Error(`节点 ${p.tag} 含已移除的 domain_strategy，请更新 Sub-Store 或修正来源`);
    if (['block','dns'].includes(p.type)) throw new Error('转换器返回旧式出站，请更新 Sub-Store');
  }
  const names = nodes.map(p => p.tag);
  const select = (tag, outbounds, def) => ({type:'selector', tag, outbounds:uniq(outbounds), default:def || outbounds[0]});
  const auto = (tag, outbounds) => ({type:'urltest',tag,outbounds,url:'https://www.apple.com/library/test/success.html',interval:'10m',tolerance:50});
  const regions = filters.slice(0,5).map(([,r]) => r);
  const groups = filters.map(([tag,re]) => ({tag,members:names.filter(n => re.test(n))}));
  groups.push({tag:'其他节点',members:names.filter(n => !regions.some(r => r.test(n)))});
  const active = groups.filter(g => g.members.length);
  const available = active.map(g => g.tag);
  const choices = ['默认代理','手动选择','自动选择',...available];
  const outbounds = [
    select('默认代理',[...available.filter(n => n !== '其他节点'),'手动选择','自动选择',...available.filter(n => n === '其他节点')]),
    select('手动选择',names),auto('自动选择',names),
    ...['Google','AI','Telegram','Steam','漏网之鱼'].map(tag => select(tag, ['Steam','漏网之鱼'].includes(tag) ? [...choices,'直连'] : choices, tag === 'AI' && available.includes('美国') ? '美国' : '默认代理')),
    {type:'direct',tag:'直连',domain_resolver:'dns-direct'},
    ...active.flatMap(g => [select(g.tag,[`${g.tag}-自动选择`,...g.members]),auto(`${g.tag}-自动选择`,g.members)]),
    ...nodes
  ];
  const specs = [
    ['private','geosite','private'],['private_ip','geoip','private'],['games_cn','geosite','category-games@cn'],
    ['synology','geosite','synology'],['apple_cn','geosite','apple@cn'],['microsoft_cn','geosite','microsoft@cn'],
    ['geolocation-cn','geosite','geolocation-cn'],['cn_ip','geoip','cn'],['google','geosite','google'],['google_ip','geoip','google'],
    ['ai','geosite','category-ai-!cn'],['telegram','geosite','telegram'],['telegram_ip','geoip','telegram'],
    ['steam','geosite','steam'],['steam_ip','geoip','steam'],['geolocation-!cn','geosite','geolocation-!cn'],
    ['category-ads','geosite','category-ads'],['fakeip_filter','geosite','fakeip-filter'],['cn','geosite','cn'],['douyin','geosite','douyin']
  ];
  const base = 'https://cdn.jsdmirror.com/gh/appshubcc/bett-rules@sing/geo';
  const rule_set = specs.map(([tag,kind,name]) => ({type:'remote',tag,format:'binary',url:`${['ai','steam_ip'].includes(tag) ? 'https://raw.githubusercontent.com/appshubcc/bett-rules/sing/geo' : base}/${kind}/${encodeURIComponent(name)}.srs`,download_detour:'直连',update_interval:'1d'}));
  const routeTo = (rule_set,outbound) => ({rule_set,action:'route',outbound});
  const pcdn = ['mcdn.bilivideo.com','mcdn.bilivideo.cn','edge.mountaintoys.cn','h2.smtcdns.net'];
  const ads = args.adblock || 'reject';
  if (!['reject','drop','off'].includes(ads)) throw new Error('adblock 必须为 reject、drop 或 off');
  const config = {
    log:{level:'info',timestamp:true},
    dns:{
      servers:[
        {type:'udp',tag:'dns-direct',server:'223.5.5.5'},
        {type:'udp',tag:'dns-douyin',server:'180.184.1.1'},
        {type:'local',tag:'dns-local'},
        {type:'https',tag:'dns-remote',server:'1.1.1.1',server_port:443,path:'/dns-query',tls:{enabled:true,server_name:'cloudflare-dns.com'},detour:'默认代理'},
        {type:'hosts',tag:'dns-hosts',predefined:{'doh.pub':['1.12.12.12','120.53.53.53'],'cloudflare-dns.com':['1.1.1.1','1.0.0.1'],'dns.google':['8.8.8.8','8.8.4.4']}},
        {type:'fakeip',tag:'dns-fakeip',inet4_range:'198.18.0.0/15',inet6_range:'2001:2::/48'}
      ],
      rules:[
        {domain_suffix:pcdn,action:'predefined',rcode:'NOERROR'},
        {preferred_by:'dns-hosts',action:'route',server:'dns-hosts'},
        {rule_set:'private',action:'route',server:'dns-local'},
        {rule_set:'douyin',action:'route',server:'dns-douyin'},
        {rule_set:'cn',action:'route',server:'dns-direct'},
        {rule_set:'fakeip_filter',action:'route',server:'dns-remote'},
        {query_type:['A','AAAA'],action:'route',server:'dns-fakeip'}
      ],final:'dns-remote'
    },
    inbounds:[{type:'mixed',tag:'mixed-in',listen:enabled(args.lan,false)?'0.0.0.0':'127.0.0.1',listen_port:7890}],
    outbounds,
    route:{auto_detect_interface:true,default_domain_resolver:'dns-direct',rules:[
      {action:'sniff'},
      {type:'logical',mode:'or',rules:[{protocol:'dns'},{port:53}],action:'hijack-dns'},
      {domain_suffix:pcdn,action:'reject'},
      {domain:'services.googleapis.cn',action:'route-options',override_address:'services.googleapis.com'},
      {domain:'cdn.jsdmirror.com',action:'route',outbound:'直连'},
      routeTo('private','直连'),
      routeTo(['geolocation-cn','games_cn','synology','apple_cn','microsoft_cn'],'直连'),
      {domain:['fsend.cn','international-gfe.download.nvidia.com'],action:'route',outbound:'直连'},
      {domain_suffix:'ctaiot.com',action:'route',outbound:'直连'},
      ...(ads === 'off' ? [] : [{rule_set:'category-ads',action:'reject',method:ads === 'drop'?'drop':'default'}]),
      routeTo('google','Google'),routeTo('ai','AI'),
      {domain:'cdn.usefathom.com',action:'route',outbound:'AI'},
      {domain_suffix:['intercom.io','intercomcdn.com'],action:'route',outbound:'AI'},
      routeTo('telegram','Telegram'),routeTo('steam','Steam'),routeTo('geolocation-!cn','默认代理'),
      routeTo('google_ip','Google'),routeTo('telegram_ip','Telegram'),routeTo('steam_ip','Steam'),
      routeTo(['cn_ip','private_ip'],'直连')
    ],rule_set,final:'漏网之鱼'},
    ntp:{enabled:true,server:'ntp.aliyun.com',server_port:123,interval:'1m',domain_resolver:'dns-direct'},
    experimental:{cache_file:{enabled:true,store_fakeip:true},clash_api:{external_controller:'127.0.0.1:9090',secret:args.secret || '',default_mode:'rule'}}
  };
  if (enabled(args.tun,true)) config.inbounds.unshift({type:'tun',tag:'tun-in',address:['172.19.0.1/30','fdfe:dcba:9876::1/126'],stack:'mixed',auto_route:true,strict_route:true,...(enabled(args.redirect,false)?{auto_redirect:true}:{})});
  input.$content = JSON.stringify(config,null,2);
  return input;
}
