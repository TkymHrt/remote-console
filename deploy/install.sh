#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run this script with sudo.' >&2
  exit 1
fi
mode=bootstrap
if [ "${1:-}" = --app-only ]; then
  mode=app-only
  test -n "${2:-}" || { printf '%s\n' 'Specify the staged application directory.' >&2; exit 1; }
  bundle=$(CDPATH= cd -- "$2" && pwd)
elif [ "$#" -eq 0 ]; then
  bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
else
  printf '%s\n' 'Usage: install.sh [--app-only STAGED_DIRECTORY]' >&2
  exit 1
fi
app=/opt/remote-console
config=/etc/remote-console
if [ -e "$app/dist" ] && [ ! -L "$app/dist" ]; then
  printf '%s\n' 'An unmanaged /opt/remote-console/dist directory exists. Refusing to replace it.' >&2
  exit 1
fi
for file in remote-console.service dist/server/index.mjs dist/client/index.html source-revision; do
  test -s "$bundle/$file" || { printf 'Missing deployment file: %s\n' "$file" >&2; exit 1; }
done
if [ "$mode" = bootstrap ]; then
  for file in node.tar.xz cloudflared application.env tunnel-token; do
    test -s "$bundle/$file" || { printf 'Missing bootstrap file: %s\n' "$file" >&2; exit 1; }
  done
else
  test -x "$app/runtime/bin/node"
  test -s "$config/remote-console.env"
  test -L "$app/dist"
  systemctl cat remote-console.service >/dev/null
  systemctl is-active --quiet cloudflared.service
  configuration_before=$(sha256sum "$config/remote-console.env" /etc/cloudflared/token)
fi

if ! getent passwd remote-console >/dev/null; then
  if [ "$mode" != bootstrap ]; then printf '%s\n' 'Production service user is missing.' >&2; exit 1; fi
  useradd --system --user-group --home-dir "$app" --shell /usr/sbin/nologin remote-console
fi
install -d -o root -g remote-console -m 0755 "$app" "$app/releases"
release=$(mktemp -d "$app/releases/release.XXXXXXXX")
cp -a "$bundle/dist" "$release/dist"
cp "$bundle/source-revision" "$release/source-revision"
chown -R root:remote-console "$release"
chmod -R g+rX "$release"
previous=
if [ -L "$app/dist" ]; then previous=$(readlink "$app/dist"); fi
if [ "$mode" = app-only ]; then
  cp -p /etc/systemd/system/remote-console.service "$release/previous.service"
  rollback_update() {
    status=$?
    trap - 0 HUP INT TERM
    if [ "$status" -ne 0 ]; then
      set +e
      install -o root -g root -m 0644 "$release/previous.service" /etc/systemd/system/remote-console.service
      ln -s "$previous" "$app/.dist-rollback.$$"
      mv -Tf "$app/.dist-rollback.$$" "$app/dist"
      systemctl daemon-reload
      if systemctl restart remote-console.service; then
        printf '%s\n' 'Update failed; previous application and service unit restored.' >&2
      else
        printf '%s\n' 'Update failed; previous files restored but service restart also failed.' >&2
      fi
    fi
    exit "$status"
  }
  trap rollback_update 0
  trap 'exit 1' HUP INT TERM
fi
if systemctl cat remote-console.service >/dev/null 2>&1; then
  systemctl stop remote-console.service
fi
if [ "$mode" = bootstrap ]; then
  install -d -o root -g root -m 0700 "$config"
  install -d -o root -g root -m 0755 "$app/runtime"
  tar -xJf "$bundle/node.tar.xz" --strip-components=1 -C "$app/runtime"
  "$app/runtime/bin/node" --version
  install -o root -g root -m 0755 "$bundle/cloudflared" /usr/local/bin/cloudflared
  /usr/local/bin/cloudflared version
  install -o root -g root -m 0600 "$bundle/application.env" "$config/remote-console.env"
fi
install -o root -g root -m 0644 "$bundle/remote-console.service" /etc/systemd/system/remote-console.service
ln -s "$release/dist" "$app/.dist-next.$$"
mv -Tf "$app/.dist-next.$$" "$app/dist"
systemd-analyze verify /etc/systemd/system/remote-console.service
systemctl daemon-reload
systemctl enable --now remote-console.service

# The origin must be listening and reject anonymous API access before success.
"$app/runtime/bin/node" --input-type=module - "$config/remote-console.env" <<'NODE'
  import { readFileSync } from "node:fs";
  import { parseEnv } from "node:util";
  import { setTimeout } from "node:timers/promises";
  const environment = parseEnv(readFileSync(process.argv[2], "utf8"));
  const port = Number(environment.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid production PORT");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/pc`);
      if (response.status === 401) process.exit(0);
      throw new Error(`Origin returned ${response.status}, expected 401`);
    } catch (error) {
      if (error.cause?.code !== "ECONNREFUSED") throw error;
    }
    await setTimeout(100);
  }
  throw new Error("Origin startup timed out");
NODE

if [ "$mode" = bootstrap ]; then
  # Official generator writes a private token file for the long-running service.
  if ! systemctl cat cloudflared.service >/dev/null 2>&1; then
    tunnel_token=$(tr -d '\r\n' < "$bundle/tunnel-token")
    /usr/local/bin/cloudflared service install "$tunnel_token"
    unset tunnel_token
  else
    if ! systemctl cat cloudflared.service | grep -q -- '--token-file /etc/cloudflared/token'; then
      printf '%s\n' 'Existing cloudflared service is not the expected token-file managed service.' >&2
      exit 1
    fi
    install -o root -g root -m 0600 "$bundle/tunnel-token" /etc/cloudflared/token
  fi
  systemctl enable --now cloudflared.service
  systemctl restart cloudflared.service
fi
if [ "$mode" = app-only ]; then
  configuration_after=$(sha256sum "$config/remote-console.env" /etc/cloudflared/token)
  if [ "$configuration_before" != "$configuration_after" ]; then
    printf '%s\n' 'Production configuration changed during update; refusing success.' >&2
    exit 1
  fi
  printf '%s\n' 'Existing application configuration and Tunnel token are unchanged.'
fi
systemctl is-active remote-console.service cloudflared.service
printf 'Deployed application revision %s (%s).\n' "$(cat "$release/source-revision")" "$mode"
trap - 0 HUP INT TERM
