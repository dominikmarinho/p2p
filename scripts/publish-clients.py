#!/usr/bin/env python3
"""Validate a release and publish immutable APKs before atomically replacing feeds."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

MAX_APK_SIZE = 128 * 1024 * 1024


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_copy(source, target):
    descriptor, name = tempfile.mkstemp(prefix='.' + target.name + '.', dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as output, source.open('rb') as input_file:
            shutil.copyfileobj(input_file, output)
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o644)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def publish(source, destination):
    manifest = source / 'android/latest.json'
    metadata = json.loads(manifest.read_text())
    clients_path = source / 'clients.json'
    clients = json.loads(clients_path.read_text())
    code = metadata.get('versionCode')
    size = metadata.get('sizeBytes')
    certificate = metadata.get('signingCertificateSha256')
    if type(code) is not int or not 1 <= code <= 2100000000 or metadata.get('applicationId') != 'com.highpass.player':
        raise SystemExit('Metadados de APK inválidos')
    if type(size) is not int or not 0 < size <= MAX_APK_SIZE or not isinstance(metadata.get('versionName'), str) or not re.fullmatch(r'[a-zA-Z0-9.+_-]{1,40}', metadata['versionName']):
        raise SystemExit('Tamanho ou versão de APK inválidos')
    if not isinstance(certificate, str) or not re.fullmatch(r'[a-f0-9]{64}', certificate):
        raise SystemExit('Certificado de assinatura inválido')
    name = f'highpass-{code}.apk'
    if metadata.get('downloadUrl') != '/downloads/android/' + name or not isinstance(metadata.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', metadata['sha256']):
        raise SystemExit('Caminho ou hash inválido')
    apk = source / 'android' / name
    if not apk.is_file() or apk.is_symlink() or apk.stat().st_size != size or sha256(apk) != metadata['sha256']:
        raise SystemExit('APK e manifesto não correspondem')
    if clients.get('android') != metadata:
        raise SystemExit('Os manifestos dos clientes e do Android não correspondem')
    tv_files = []
    for filename in ['highpass-roku.zip', 'highpass-tizen-unsigned.wgt', 'highpass-webos.ipk']:
        item = source / 'tv' / filename
        if item.exists():
            if item.is_symlink() or not item.is_file() or not 0 < item.stat().st_size <= MAX_APK_SIZE:
                raise SystemExit('Pacote de TV inválido')
            tv_files.append(item)
    destination.mkdir(parents=True, exist_ok=True)
    destination.chmod(0o755)
    with (destination / '.publish.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        android = destination / 'android'
        android.mkdir(exist_ok=True)
        android.chmod(0o755)
        current = android / 'latest.json'
        if current.exists():
            installed = json.loads(current.read_text())
            if int(installed.get('versionCode', 0)) > code:
                raise SystemExit('Não é permitido reduzir a versão publicada')
            if installed.get('signingCertificateSha256') != certificate:
                raise SystemExit('O certificado publicado precisa manter a identidade dos aplicativos instalados')
        target = android / name
        if target.exists() and sha256(target) != metadata['sha256']:
            raise SystemExit('A versão já existe com outro conteúdo. Incremente versionCode antes de publicar.')
        if not target.exists():
            atomic_copy(apk, target)
        # Packages exist before any feed can advertise the new release.
        if tv_files:
            tv = destination / 'tv'
            tv.mkdir(exist_ok=True)
            tv.chmod(0o755)
            for item in tv_files:
                atomic_copy(item, tv / item.name)
        descriptor, link_name = tempfile.mkstemp(prefix='.highpass-latest.', dir=android)
        os.close(descriptor)
        link = Path(link_name)
        try:
            link.unlink()
            link.symlink_to(name)
            os.replace(link, android / 'highpass-latest.apk')
        finally:
            link.unlink(missing_ok=True)
        atomic_copy(clients_path, destination / 'clients.json')
        atomic_copy(manifest, current)
    print(f'Atualização Android {metadata["versionName"]} publicada com arquivo imutável e manifesto atômico')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--destination', type=Path, default=Path('/var/www/highpass-downloads'))
    args = parser.parse_args()
    publish(args.source, args.destination)
