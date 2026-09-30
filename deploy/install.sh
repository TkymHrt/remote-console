#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run this script with sudo.' >&2
  exit 1
fi
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app=/opt/remote-console
config=/etc/remote-console
if [ -e "$app/dist" ] && [ ! -L "$app/dist" ]; then
  printf '%s\n' 'An unmanaged /opt/remote-console/dist directory exists. Refusing to replace it.' >&2
  exit 1
fi

for file in node.tar.xz cloudflared application.env tunnel-token remote-console.service dist/server/index.mjs dist/client/index.html; do
  test -s "$bundle/$file" || { printf 'Missing deployment file: %s\n' "$file" >&2; exit 1; }
done

if ! getent passwd remote-console >/dev/null; then
  useradd --system --user-group --home-dir "$app" --shell /usr/sbin/nologin remote-console
fi
install -d -o root -g remote-console -m 0755 "$app" "$app/releases"
install -d -o root -g root -m 0700 "$config"
release=$(mktemp -d "$app/releases/release.XXXXXXXX")
cp -a "$bundle/dist" "$release/dist"
chown -R root:remote-console "$release"
chmod -R g+rX "$release"
if systemctl cat remote-console.service >/dev/null 2>&1; then
  systemctl stop remote-console.service
fi
install -d -o root -g root -m 0755 "$app/runtime"
tar -xJf "$bundle/node.tar.xz" --strip-components=1 -C "$app/runtime"
"$app/runtime/bin/node" --version
install -o root -g root -m 0755 "$bundle/cloudflared" /usr/local/bin/cloudflared
/usr/local/bin/cloudflared version
install -o root -g root -m 0600 "$bundle/application.env" "$config/remote-console.env"
install -o root -g root -m 0644 "$bundle/remote-console.service" /etc/systemd/system/remote-console.service

ln -sfn "$release/dist" "$app/dist"
systemd-analyze verify /etc/systemd/system/remote-console.service
systemctl daemon-reload
systemctl enable --now remote-console.service

# Use cloudflared's official service generator. It writes a private token file,
# so the long-running service does not contain the token in its argv.
if ! systemctl cat cloudflared.service >/dev/null 2>&1; then
  tunnel_token=$(tr -d '\r\n' < "$bundle/tunnel-token")
  /usr/local/bin/cloudflared service install "$tunnel_token"
  unset tunnel_token
else
  if ! systemctl cat cloudflared.service | grep -q -- '--token-file /etc/cloudflared/token'; then
    printf '%s\n' 'Existing cloudflared service is not the expected token-file managed service. Refusing to overwrite it.' >&2
    exit 1
  fi
  install -o root -g root -m 0600 "$bundle/tunnel-token" /etc/cloudflared/token
fi
systemctl enable --now cloudflared.service
systemctl restart cloudflared.service
systemctl is-active remote-console.service cloudflared.service
printf '%s\n' 'Remote Console and cloudflared are installed and active.'
