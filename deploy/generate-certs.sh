#!/bin/sh

set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CERT_DIR="$SCRIPT_DIR/certs"
CA_KEY="$CERT_DIR/excalidraw-local-ca.key"
CA_CERT="$CERT_DIR/excalidraw-local-ca.crt"
SERVER_KEY="$CERT_DIR/excalidraw.office.test.key"
SERVER_CERT="$CERT_DIR/excalidraw.office.test.crt"
SERVER_EXT="$CERT_DIR/excalidraw.office.test.ext"

mkdir -p "$CERT_DIR"

if [ -f "$CA_KEY" ] && [ -f "$CA_CERT" ] && [ -f "$SERVER_KEY" ] && [ -f "$SERVER_CERT" ] \
  && openssl verify -CAfile "$CA_CERT" "$SERVER_CERT" >/dev/null 2>&1 \
  && openssl x509 -in "$SERVER_CERT" -noout -checkend 86400 >/dev/null 2>&1 \
  && openssl x509 -in "$SERVER_CERT" -noout -ext subjectAltName 2>/dev/null \
    | grep -q 'DNS:excalidraw.office.test' \
  && openssl x509 -in "$SERVER_CERT" -noout -ext subjectAltName 2>/dev/null \
    | grep -q 'IP Address:10.0.0.176' \
  && openssl x509 -in "$SERVER_CERT" -noout -text 2>/dev/null \
    | grep -q 'CA:FALSE' \
  && openssl x509 -in "$SERVER_CERT" -noout -text 2>/dev/null \
    | grep -q 'TLS Web Server Authentication'; then
  printf 'Certificates already exist and are valid in %s\n' "$CERT_DIR"
  exit 0
fi

rm -f "$CA_KEY" "$CA_CERT" "$SERVER_KEY" "$SERVER_CERT" "$SERVER_EXT"

openssl req -x509 -newkey rsa:4096 -sha256 -nodes \
  -days 3650 \
  -keyout "$CA_KEY" \
  -out "$CA_CERT" \
  -subj '/CN=Excalidraw Office Local CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'

openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$SERVER_KEY" \
  -out "$CERT_DIR/excalidraw.office.test.csr" \
  -subj '/CN=excalidraw.office.test' \
  -addext 'subjectAltName=DNS:excalidraw.office.test,IP:10.0.0.176'

cat > "$SERVER_EXT" <<'EOF'
subjectAltName=DNS:excalidraw.office.test,IP:10.0.0.176
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF

openssl x509 -req -sha256 \
  -in "$CERT_DIR/excalidraw.office.test.csr" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -days 825 \
  -out "$SERVER_CERT" \
  -extfile "$SERVER_EXT"

rm -f \
  "$CERT_DIR/excalidraw.office.test.csr" \
  "$CERT_DIR/excalidraw-local-ca.srl" \
  "$SERVER_EXT"
chmod 600 "$CA_KEY" "$SERVER_KEY"
chmod 644 "$CA_CERT" "$SERVER_CERT"

printf 'Generated certificates in %s\n' "$CERT_DIR"
printf 'Trust this local CA on clients: %s\n' "$CA_CERT"
