# substore-scripts

个人自用的 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 脚本。

| 脚本 | 类型 | 作用 |
|---|---|---|
| [`singbox.js`](./singbox.js) | 文件脚本 | 把 [MyClash](https://github.com/changshengyu/MyClash) 的 mihomo 覆写脚本转换成 sing-box 1.14+ 完整配置 |
| [`rename.js`](./rename.js) | 节点脚本 | 节点重命名：`厂商 国家 类型`，CDN 节点加 `备用` 前缀 |
| [`sort.js`](./sort.js) | 节点脚本 | 节点排序：`备用` 节点排到最后 |

脚本链接：

```
https://raw.githubusercontent.com/changshengyu/substore-scripts/main/singbox.js
https://raw.githubusercontent.com/changshengyu/substore-scripts/main/rename.js
https://raw.githubusercontent.com/changshengyu/substore-scripts/main/sort.js
```

## singbox.js

### 自动跟随上游

脚本里没有写死任何策略组或规则。每次运行时，它会：

1. 从 Sub-Store 取出同一份订阅的 mihomo 格式和 sing-box 格式节点，只保留 sing-box 支持的节点；
2. 下载 MyClash 的 [`Script/Script.js`](https://github.com/changshengyu/MyClash/blob/main/Script/Script.js)（下载失败时使用上次的缓存）；
3. 用这些节点执行它的 `main()`，得到完整的 mihomo 配置；
4. 把策略组、规则、规则集、DNS、hosts、TUN 等逐项转换成 sing-box 配置。

MyClash 每天自动同步 AIsouler/MyClash 上游，所以上游的规则和分组变化会自动带到 sing-box 配置里。

### 转换对照

| mihomo | sing-box |
|---|---|
| `select` 策略组 | `selector`（保留 `default-selected`） |
| `url-test` / `fallback` / `load-balance` | `urltest` |
| 只包含 `REJECT` 的策略组（如 AdBlock） | 规则动作 `reject` |
| `DIRECT` 节点的 `ip-version` | `direct` 出站的 `domain_resolver.strategy` |
| `.mrs` 规则集 | 同一仓库 `sing` 分支的 `.srs` 规则集 |
| 不带 `no-resolve` 的 IP 规则 | 在第一条 IP 规则前插入 `resolve` 动作 |
| `AND` / `OR` / `NOT` | `logical` 规则 |
| `fake-ip` + `fake-ip-filter` + `nameserver-policy` | `fakeip` 服务器 + 等价的 DNS 规则 |
| hosts 中的 IP | `hosts` DNS 服务器 |
| hosts 中的 `0.0.0.0` | 规则动作 `reject` |
| hosts 中的域名 | 规则动作 `route-options` 改写目标地址 |
| `GLOBAL` 组 | 不生成（sing-box 的 Clash API 会自动提供），全局模式走 `GLOBAL` 的第一个成员 |

无法转换的规则会被跳过，并在 Sub-Store 日志里列出。

### 可调整项

都在脚本开头：

- `SUB_NAME` / `SUB_TYPE`：默认订阅；也可以通过 `$arguments` 的 `name`、`type` 传入。
- `SCRIPT_URLS`：上游脚本地址；也可以通过 `script` 参数传入。
- `RULE_OPTION_OVERRIDES`：覆盖上游 `ruleOptionsEnable` 里的开关，例如 `{ 屏蔽国外QUIC: true }`。
- `OVERRIDES`：混合端口（默认 20808，可用 `port` 参数覆盖）和监听地址（默认只监听本机）。

### 已知限制

- sing-box 不支持 xhttp 传输和 VLESS encryption，这类节点会被 Sub-Store 丢弃。
- `url-test` 以外的自动策略组在 sing-box 中都按延迟选择，没有 fallback 的顺序语义。
- mihomo 的一个 DNS 列表里如果有多个地址，只使用第一个。

### 测试

[`check.yml`](./.github/workflows/check.yml) 会在每次推送时运行，并在 MyClash 每天三次同步之后各运行一次：

1. 用 [`test/fixtures`](./test/fixtures) 中的脱敏节点和最新的上游脚本生成配置；
2. 用最新稳定版 sing-box 执行 `sing-box check`。

上游改动导致转换失败时，工作流会失败，GitHub 会发邮件提醒。

本地运行：

```sh
node test/run.mjs test/out/config.json            # 使用线上的上游脚本
node test/run.mjs test/out/config.json ./Script.js # 使用本地文件
sing-box check -c test/out/config.json
```

## archive/

旧的 mihomo 覆写脚本（v2–v10）和旧版 sing-box / Stash / Surfboard / Xray 生成脚本，仅作存档，不再维护。
