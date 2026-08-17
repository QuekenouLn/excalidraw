# 客户端接入

客户端通过 `https://excalidraw.office.test` 访问服务器 `10.0.0.176`。需要同时完成：

1. 将域名解析到服务器 IP。
2. 将内部 CA 公钥证书加入系统信任库。

> 仅修改 `hosts` 不够：它只负责域名解析，不会让浏览器信任内部 CA；跳过 CA 安装仍会出现 TLS 证书警告。不要绕过浏览器警告继续访问。

## 获取 CA 公钥证书

仓库约定的可分发文件为：

```text
deploy/certs/excalidraw-local-ca.crt
```

该文件由服务端证书生成流程提供，且只包含 CA **公钥证书**。只能单独分发这个 `.crt` 文件，严禁打包或分发整个 `deploy/certs/` 目录；不得分发 CA 私钥、服务器私钥或包含私钥的 `.key`、`.p12`、`.pfx` 文件。

服务端启用 HTTPS：

```bash
deploy/generate-certs.sh
docker compose --profile https up -d
```

普通 `docker compose up -d` 仍只启动 HTTP 服务；HTTPS 不会强制跳转或替代 `http://10.0.0.176:5000`。

安装前请通过独立可信渠道向管理员核对 SHA-256 指纹：

```bash
openssl x509 -in deploy/certs/excalidraw-local-ca.crt -noout -subject -issuer -fingerprint -sha256
```

还可确认文件不包含私钥标记：

```bash
! grep -q "PRIVATE KEY" deploy/certs/excalidraw-local-ca.crt
```

## 配置 hosts

以下操作会修改系统文件，请先确认命令内容并备份原文件。重复配置时保留一条有效记录，避免同一域名映射到多个 IP。

### Linux

编辑 `/etc/hosts`，加入：

```text
10.0.0.176 excalidraw.office.test
```

例如先备份，再使用系统编辑器：

```bash
sudo cp -a /etc/hosts /etc/hosts.before-excalidraw
sudoedit /etc/hosts
```

### macOS

编辑 `/etc/hosts`，加入同一行：

```text
10.0.0.176 excalidraw.office.test
```

```bash
sudo cp -p /etc/hosts /etc/hosts.before-excalidraw
sudoedit /etc/hosts
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

### Windows

以管理员身份打开文本编辑器，先备份再编辑：

```text
C:\Windows\System32\drivers\etc\hosts
```

加入：

```text
10.0.0.176 excalidraw.office.test
```

然后在管理员 PowerShell 中刷新缓存：

```powershell
ipconfig /flushdns
```

## 安装 CA

安装 CA 会改变系统信任边界。仅在已核对指纹、确认来源可信后执行；共享设备应由管理员统一部署。

### Linux

Debian/Ubuntu：

```bash
sudo install -m 0644 deploy/certs/excalidraw-local-ca.crt \
  /usr/local/share/ca-certificates/excalidraw-office-test-ca.crt
sudo update-ca-certificates
```

RHEL/Fedora：

```bash
sudo install -m 0644 deploy/certs/excalidraw-local-ca.crt \
  /etc/pki/ca-trust/source/anchors/excalidraw-office-test-ca.crt
sudo update-ca-trust extract
```

### macOS

安装到系统钥匙串需要管理员授权：

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  deploy/certs/excalidraw-local-ca.crt
```

### Windows

在管理员 PowerShell 中安装到本机根证书库：

```powershell
certutil -addstore -f Root .\deploy\certs\excalidraw-local-ca.crt
```

不具备管理员权限时，可去掉管理员身份并使用当前用户证书管理器导入到“受信任的根证书颁发机构”；企业设备应遵循组织策略，不要自行覆盖组策略。

部分独立管理证书库的浏览器或工具可能不会读取系统信任库，需要在其“证书颁发机构”设置中单独导入同一 `.crt` 文件。

## 验证

先确认解析结果仅指向预期 IP：

```bash
getent hosts excalidraw.office.test       # Linux
dscacheutil -q host -a name excalidraw.office.test  # macOS
```

Windows PowerShell：

```powershell
Resolve-DnsName excalidraw.office.test
```

使用指定 CA 验证服务端证书链和域名：

```bash
openssl s_client \
  -connect excalidraw.office.test:443 \
  -servername excalidraw.office.test \
  -CAfile deploy/certs/excalidraw-local-ca.crt \
  -verify_hostname excalidraw.office.test </dev/null
```

输出应包含 `Verify return code: 0 (ok)`。再验证 HTTPS：

```bash
curl --fail --show-error --cacert deploy/certs/excalidraw-local-ca.crt \
  https://excalidraw.office.test/
```

Linux/macOS 也可在仓库根目录运行只读辅助检查：

```bash
deploy/verify-client-setup.sh
```

脚本只读取解析结果、证书文件和远端 TLS 信息，不会修改 `hosts`、证书库或其他系统配置。

## 故障排查

- 解析不是 `10.0.0.176`：检查重复的 `hosts` 记录、DNS 缓存、VPN 或代理规则。
- 连接被拒绝或超时：确认客户端能访问 `10.0.0.176:443`，并由服务端完成 HTTPS 入口集成。
- 证书链验证失败：确认 CA 文件和服务端证书属于同一信任链，并重新核对 CA 指纹。
- 域名验证失败：服务端证书的 SAN 必须包含 `excalidraw.office.test`，不能只包含 IP 或其他域名。
