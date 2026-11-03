#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute como root no servidor de produção' >&2; exit 1; }
: "${1:?Informe o IP público do servidor TURN}"
command -v turnserver >/dev/null
python3 - "$1" <<'PY'
from pathlib import Path
import grp, ipaddress, os, re, secrets, shutil, sys
from urllib.parse import urlparse
public_ip = str(ipaddress.IPv4Address(sys.argv[1]))
path = Path('/opt/highpass/.env')
lines = path.read_text().splitlines()
env = dict(line.split('=',1) for line in lines if '=' in line and not line.startswith('#'))
domain = urlparse(env.get('PUBLIC_ENGINE_URL','https://p2p.remoto.api.br')).hostname
if not domain or not re.fullmatch(r'[A-Za-z0-9.-]+',domain):raise SystemExit('Domínio público inválido')
lineage = Path('/etc/letsencrypt/live') / domain
if not (lineage/'privkey.pem').is_file():raise SystemExit('Emita o certificado HTTPS antes de configurar TURN')
secret = env.get('TURN_SHARED_SECRET') or secrets.token_hex(48)
if len(secret)<32:raise SystemExit('TURN_SHARED_SECRET deve ter pelo menos 32 caracteres')
updates = {'TURN_SHARED_SECRET':secret,'TURN_URLS':f'turn:{domain}:3478?transport=udp,turn:{domain}:3478?transport=tcp,turns:{domain}:5349?transport=tcp'}
result = []; seen=set()
for line in lines:
    key = line.split('=',1)[0]
    if key in updates:result.append(f'{key}={updates[key]}');seen.add(key)
    else:result.append(line)
for key,value in updates.items():
    if key not in seen:result.append(f'{key}={value}')
path.write_text('\n'.join(result)+'\n');path.chmod(0o600)
group = grp.getgrnam('turnserver').gr_gid
tls = Path('/etc/highpass-turn/tls');tls.mkdir(parents=True,exist_ok=True);tls.chmod(0o750);os.chown(tls,0,group)
for source,target in [('fullchain.pem','cert.pem'),('privkey.pem','key.pem')]:
    dest=tls/target;shutil.copyfile(lineage/source,dest);dest.chmod(0o640);os.chown(dest,0,group)
conf = f'''listening-port=3478
 tls-listening-port=5349
 listening-ip={public_ip}
 relay-ip={public_ip}
 external-ip={public_ip}
 realm={domain}
 server-name={domain}
 fingerprint
 use-auth-secret
 static-auth-secret={secret}
 cert={tls}/cert.pem
 pkey={tls}/key.pem
 min-port=49160
 max-port=49559
 user-quota=64
 total-quota=512
 max-bps=4194304
 bps-capacity=67108864
 no-cli
 no-tcp-relay
 no-dtls
 no-tlsv1
 no-tlsv1_1
 no-multicast-peers
 denied-peer-ip=0.0.0.0-0.255.255.255
 denied-peer-ip=10.0.0.0-10.255.255.255
 denied-peer-ip=127.0.0.0-127.255.255.255
 denied-peer-ip=169.254.0.0-169.254.255.255
 denied-peer-ip=172.16.0.0-172.31.255.255
 denied-peer-ip=192.168.0.0-192.168.255.255
 denied-peer-ip=224.0.0.0-255.255.255.255
 denied-peer-ip=::1
 denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
 log-file=syslog
 simple-log
'''
config=Path('/etc/turnserver.conf')
if config.exists() and not Path('/opt/highpass/backups/turnserver-before-highpass.conf').exists():
    backup=Path('/opt/highpass/backups/turnserver-before-highpass.conf');shutil.copyfile(config,backup);backup.chmod(0o600)
config.write_text('\n'.join(line.strip() for line in conf.splitlines())+'\n');config.chmod(0o640);os.chown(config,0,group)
hook=Path('/etc/letsencrypt/renewal-hooks/deploy/highpass-turn')
hook.write_text(f'''#!/bin/sh
set -eu
[ "${{RENEWED_LINEAGE:-{lineage}}}" = "{lineage}" ] || exit 0
install -o root -g turnserver -m 0640 "{lineage}/fullchain.pem" "{tls}/cert.pem"
install -o root -g turnserver -m 0640 "{lineage}/privkey.pem" "{tls}/key.pem"
systemctl try-restart coturn.service
''');hook.chmod(0o755)
override=Path('/etc/systemd/system/coturn.service.d');override.mkdir(parents=True,exist_ok=True)
(override/'highpass.conf').write_text('[Service]\nLimitNOFILE=65536\nMemoryMax=512M\nCPUQuota=200%\n')
print('Configuração TURN gerada com autenticação temporária e TLS')
PY
systemctl daemon-reload
systemctl unmask coturn.service
systemctl enable --now coturn.service
systemctl restart coturn.service
systemctl is-active coturn.service
