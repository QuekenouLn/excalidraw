#!/bin/sh

set -eu

host_name="excalidraw.office.test"
expected_ip="10.0.0.176"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ca_file=${1:-"$script_dir/certs/excalidraw-local-ca.crt"}

failures=0

pass() {
  printf 'OK: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

resolved_ips=""
if command -v getent >/dev/null 2>&1; then
  resolved_ips=$(getent ahostsv4 "$host_name" 2>/dev/null | awk '{print $1}' | sort -u || true)
elif command -v dscacheutil >/dev/null 2>&1; then
  resolved_ips=$(dscacheutil -q host -a name "$host_name" 2>/dev/null | awk '/^ip_address: / {print $2}' | sort -u || true)
else
  fail "找不到 getent 或 dscacheutil，无法检查域名解析"
fi

if [ -n "$resolved_ips" ]; then
  unexpected_ips=$(printf '%s\n' "$resolved_ips" | awk -v expected="$expected_ip" '$0 != expected')
  if printf '%s\n' "$resolved_ips" | grep -Fxq "$expected_ip" && [ -z "$unexpected_ips" ]; then
    pass "$host_name 仅解析到 $expected_ip"
  else
    fail "$host_name 解析为 [$resolved_ips]，预期仅为 $expected_ip"
  fi
else
  fail "$host_name 没有可用的 IPv4 解析结果"
fi

if [ ! -f "$ca_file" ]; then
  fail "CA 公钥证书不存在：$ca_file"
elif grep -q "PRIVATE KEY" "$ca_file"; then
  fail "CA 文件包含私钥标记，禁止分发：$ca_file"
elif ! command -v openssl >/dev/null 2>&1; then
  fail "找不到 openssl，无法检查 CA 和远端证书"
elif ! openssl x509 -in "$ca_file" -noout -checkend 0 >/dev/null 2>&1; then
  fail "CA 文件不是有效且未过期的 X.509 证书：$ca_file"
elif ! openssl x509 -in "$ca_file" -noout -text | grep -q "CA:TRUE"; then
  fail "证书未声明 CA:TRUE，不能作为 CA 公钥证书分发：$ca_file"
else
  pass "CA 公钥证书格式有效且当前未过期"
  openssl x509 -in "$ca_file" -noout -subject -issuer -fingerprint -sha256

  tls_output=$(openssl s_client \
    -connect "$host_name:443" \
    -servername "$host_name" \
    -CAfile "$ca_file" \
    -verify_hostname "$host_name" </dev/null 2>&1 || true)
  if printf '%s\n' "$tls_output" | grep -Fq "Verify return code: 0 (ok)"; then
    pass "远端 TLS 证书链和域名验证通过"
  else
    fail "远端 TLS 验证失败；确认 443 入口、证书链和 SAN 已完成服务端集成"
    printf '%s\n' "$tls_output" | tail -n 12 >&2
  fi
fi

if [ "$failures" -ne 0 ]; then
  printf '检查完成：%s 项失败。脚本未修改任何系统配置。\n' "$failures" >&2
  exit 1
fi

printf '检查完成：全部通过。脚本未修改任何系统配置。\n'
