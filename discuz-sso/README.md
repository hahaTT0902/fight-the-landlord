# Discuz 3.5 与 Doudizhu 在线游戏（JWT SSO）集成说明

本目录提供一个最小可用的 Discuz 3.5 SSO 接入示例：在用户登录后生成 JWT（JSON Web Token），并设置浏览器 cookie `discuz_token`。

前提
- 你已有一套运行中的 Discuz 3.5；本站点与游戏前端在同一域或可共享 cookie（否则需额外处理跨域）。
- Node 游戏服务器（doudizhu-online）已经部署并配置为从握手 `auth.token` 中验证 JWT（本仓库已修改 `server.js`）。

安装步骤（在 Discuz 站点服务器上）

1. 进入 Discuz 站点根目录并安装 JWT 依赖：

```bash
cd /path/to/discuz
composer require firebase/php-jwt
```

2. 将本目录 `discuz-sso` 上传到 Discuz 根目录（保持 `sso.php` 路径，例如：`/path/to/discuz/discuz-sso/sso.php`）。

3. 在 Discuz 登录成功后调用 SSO 设定函数。

   编辑 `member.php`（登录相关逻辑，可能路径为 `member.php?mod=logging&action=login`），找到登录成功分支（通常是 `if ($_G['uid'])` 或相关块），加入：

```php
require_once DISCUZ_ROOT . './discuz-sso/sso.php';
doudizhu_set_jwt_cookie($_G['uid'], $_G['member']['username']);
```

4. 在登出逻辑处清除 cookie（可在 `member.php?mod=logging&action=logout` 或模板退出逻辑处）加入：

```php
require_once DISCUZ_ROOT . './discuz-sso/sso.php';
doudizhu_clear_jwt_cookie();
```

5. 配置 JWT secret

- 强烈建议通过环境变量 `JWT_SECRET` 为 Discuz 与 Node 服务器分别设置相同的强随机字符串，或者在 Discuz 配置文件中定义常量 `DISCUZ_SSO_SECRET`：

```php
// 在 Discuz 配置或入口文件中加入：
define('DISCUZ_SSO_SECRET', '请替换为一个强随机字符串');
```

6. 确保 cookie domain 与 secure 设置

- 默认 `sso.php` 中 cookie `domain` 留空，请替换为你的站点主域（如 `.example.com`）以便子域共享。
- 如果使用 HTTPS，请确保 `secure` 为 true（脚本会基于 `$_SERVER['HTTPS']` 自动设置）。

7. 前端与服务器

- 前端（`static/index.html`）已经实现读取 `discuz_token` 并在连接时通过 socket.io `auth.token` 发送到 Node 服务器。
- Node 服务器需要使用与 Discuz 相同的 `JWT_SECRET` 来校验 token（本仓库 `server.js` 已使用 `process.env.JWT_SECRET || 'change_this_in_production'`）。

调试建议
- 如果自动登录失败，可在浏览器控制台检查 cookie `discuz_token` 是否存在、是否过期。
- 在 Discuz 端临时将 `doudizhu_set_jwt_cookie()` 的返回值打印或记录到日志以检查生成的 token。
- 使用 jwt.io 工具可以解码 token 检查 payload（请不要把 secret 放到公共场合）。

常见问题
- 如果你的网站和游戏不在同一域名下，浏览器默认不会发送 cookie，需使用跨域登录（例如：Discuz 登录后通过 AJAX 将 token 传给游戏域的登录接口，或配置顶级域名共享 cookie）。

联系方式
- 如果需要，我可以把 `sso.php` 改写为更符合你 Discuz 环境的插件格式（完整插件包），或把集成步骤写成补丁脚本。

---

## 数据库配置（积分持久化）

游戏服务器启动后，会把每名 **已通过 Discuz JWT 登录** 的玩家的对局结果写入 MySQL；游客 / AI 不计分。推荐 **直接使用 Discuz 自身的数据库**，无需再开一个库。

### 1. 安装依赖

```bash
cd /path/to/fight-the-landlord
npm install         # 会安装新增的 mysql2
```

### 2. 建表（自动）

服务器启动时会执行 `CREATE TABLE IF NOT EXISTS`，自动创建一张：

```text
<前缀>doudizhu_score      # 默认前缀 pre_，即 pre_doudizhu_score
```

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| uid | INT UNSIGNED PK | Discuz 用户 uid |
| username | VARCHAR(64) | 显示名（每次对局后刷新） |
| score | INT | 累计积分（可正可负） |
| games | INT UNSIGNED | 总局数 |
| wins / losses | INT UNSIGNED | 胜 / 负局数 |
| landlord_games | INT UNSIGNED | 当地主局数 |
| landlord_wins | INT UNSIGNED | 当地主胜局数 |
| updated_at | INT UNSIGNED | 最近更新时间戳 |

如果你想手动建表（例如生产环境只给只读权限的用户）：

```sql
CREATE TABLE IF NOT EXISTS `pre_doudizhu_score` (
  `uid` INT UNSIGNED NOT NULL PRIMARY KEY,
  `username` VARCHAR(64) NOT NULL DEFAULT '',
  `score` INT NOT NULL DEFAULT 0,
  `games` INT UNSIGNED NOT NULL DEFAULT 0,
  `wins` INT UNSIGNED NOT NULL DEFAULT 0,
  `losses` INT UNSIGNED NOT NULL DEFAULT 0,
  `landlord_games` INT UNSIGNED NOT NULL DEFAULT 0,
  `landlord_wins` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` INT UNSIGNED NOT NULL DEFAULT 0,
  KEY `idx_score` (`score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3. 环境变量

启动 Node 游戏服务器时配置（建议写到 systemd / pm2 ecosystem / `.env` 中，**不要硬编码到代码里**）：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `JWT_SECRET` | 与 Discuz 端 `DISCUZ_SSO_SECRET` **完全一致** | `a-very-long-random-string` |
| `DB_HOST` | MySQL 主机 | `127.0.0.1` |
| `DB_PORT` | 端口 | `3306` |
| `DB_USER` | 数据库账号 | `discuz` |
| `DB_PASSWORD` | 密码 | `xxxx` |
| `DB_NAME` | 库名（建议直接复用 Discuz 的库） | `ultrax` |
| `DB_TABLE_PREFIX` | Discuz 表前缀 | `pre_` |
| `SCORE_BASE` | 每分对应多少积分（默认 1） | `1` |
| `DB_DISABLE` | 设为 `1` 完全关闭持久化（仅内存） | （不设） |

#### zwwx.club 部署示例

假设 `zwwx.club` 上的 Discuz 配置如下（见 `config/config_global.php` 中 `$_config['db']['1']['dbname']` 与 `$_config['db']['1']['tablepre']`）：

```bash
# /etc/systemd/system/doudizhu.service 片段
[Service]
Environment=JWT_SECRET=请替换为你与Discuz共用的强随机串
Environment=DB_HOST=127.0.0.1
Environment=DB_PORT=3306
Environment=DB_USER=zwwx_dz
Environment=DB_PASSWORD=你的密码
Environment=DB_NAME=zwwx_discuz
Environment=DB_TABLE_PREFIX=pre_
WorkingDirectory=/var/www/fight-the-landlord
ExecStart=/usr/bin/node server.js
```

或者最简单，使用 `.env` + `dotenv`/直接 export：

```bash
export JWT_SECRET='...'
export DB_HOST=127.0.0.1
export DB_USER=zwwx_dz
export DB_PASSWORD='...'
export DB_NAME=zwwx_discuz
export DB_TABLE_PREFIX=pre_
node server.js
```

### 4. 数据库账号最小权限（推荐）

只给该账号本表的 CRUD + 建表权限即可：

```sql
GRANT SELECT, INSERT, UPDATE, CREATE ON `zwwx_discuz`.`pre_doudizhu_score` TO 'zwwx_dz'@'localhost';
FLUSH PRIVILEGES;
```

如果你不希望游戏服务自动建表，可去掉 `CREATE` 权限并手动执行第 2 节中的建表 SQL。

### 5. 计分规则

每局结束时（自然胜负，逃跑不算）按下式给所有真人参与者结算：

```
base = 叫分(score) × 倍率(ratio) × SCORE_BASE
地主 = ±2 × base       # 胜 + ，负 -
农民 = ±1 × base
```

> `ratio` 来自 `game.js` 中的春天/反春加倍；炸弹倍率本项目暂未叠加，可按需在 `game.js` 中扩展。

### 6. 查询接口

游戏服务器额外暴露两个 HTTP 接口，方便你在论坛页面上展示：

| 路径 | 用途 |
| --- | --- |
| `GET /api/score/me?token=<JWT>` | 当前用户积分 / 战绩 |
| `GET /api/score/top?limit=20`   | 积分榜（无需登录） |

也会在玩家登录或对局结束时通过 socket.io 推送 `MY_SCORE` 事件给本人。

### 7. 排查

- 启动时如果看到 `[db] 已连接 MySQL，使用表 pre_doudizhu_score`，说明 OK。
- 看到 `[db] 未配置 DB_USER / DB_NAME，跳过数据库初始化（内存模式）` ⇒ 环境变量没传进 Node 进程。
- 看到 `[db] 初始化失败：ER_ACCESS_DENIED_ERROR` ⇒ 账号 / 密码 / 主机错。
- 表已建但分数没增加 ⇒ 玩家很可能是匿名登录（cookie `discuz_token` 不存在或已过期，回退成手动起名）。可在浏览器 DevTools → Application → Cookies 检查。

