#!/usr/bin/env python3
"""Validate the signed release APK and assemble immutable public update files."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--apk', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--aapt', required=True)
parser.add_argument('--apksigner', required=True)
parser.add_argument('--expected-cert', required=True)
parser.add_argument('--revision', required=True)
args = parser.parse_args()
expected_certificate = args.expected_cert.lower().replace(':', '')
if not re.fullmatch(r'[a-f0-9]{64}', expected_certificate):
    raise SystemExit('Certificado esperado inválido')
if not args.apk.is_file() or not 0 < args.apk.stat().st_size <= 128 * 1024 * 1024:
    raise SystemExit('APK ausente ou acima do limite de 128 MB')
if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
    raise SystemExit('Commit SHA inválido')
badging = subprocess.check_output([args.aapt, 'dump', 'badging', str(args.apk)], text=True)
package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
sdk = re.search(r"sdkVersion:'(\d+)'", badging)
if not package or package[1] != 'com.highpass.player' or not sdk or 'application-debuggable' in badging:
    raise SystemExit('O pacote precisa ser a versão release não depurável do Highpass Play')
signature = subprocess.check_output([args.apksigner, 'verify', '--print-certs', str(args.apk)], text=True)
cert = re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)', signature)
if not cert or cert[1].lower() != expected_certificate or 'Signer #2 certificate' in signature:
    raise SystemExit('Assinatura incompatível com os APKs já distribuídos')
version_code = int(package[2])
if not 1 <= version_code <= 2100000000 or not re.fullmatch(r'[a-zA-Z0-9.+_-]{1,40}', package[3]):
    raise SystemExit('Número de versão inválido')
directory = args.output / 'android'; directory.mkdir(parents=True, exist_ok=True)
file = directory / f'highpass-{version_code}.apk'; shutil.copyfile(args.apk, file)
metadata = {'schemaVersion': 1, 'applicationId': package[1], 'versionCode': version_code, 'versionName': package[3], 'minSdk': int(sdk[1]), 'downloadUrl': f'/downloads/android/{file.name}', 'sizeBytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'signingCertificateSha256': cert[1].lower(), 'revision': args.revision, 'releaseNotes': 'Corrige a reutilização da sessão HLS do XUI, reduz buscas repetidas do seed e prioriza P2P durante o aquecimento. Inclui correções do painel e mantém login e favoritos.'}
(directory / 'latest.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
(args.output / 'clients.json').write_text(json.dumps({'android': metadata, 'roku': {'versionName': '1.1.0', 'downloadUrl': 'https://p2p.remoto.api.br/downloads/tv/highpass-roku.zip'}, 'tizen': {'versionName': '1.1.0', 'hostedInterface': True}, 'webos': {'versionName': '1.1.0', 'hostedInterface': True}}, ensure_ascii=False, indent=2) + '\n')
print(f'APK release verificado: {package[3]} ({version_code}), mesma assinatura dos aparelhos existentes')
