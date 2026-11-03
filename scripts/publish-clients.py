#!/usr/bin/env python3
"""Validate every variant before publishing immutable APKs and atomic update feeds."""
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


def validate(source, clients, variant):
    relative = Path('android/p2p') if variant == 'p2p' else Path('android')
    metadata = json.loads((source / relative / 'latest.json').read_text())
    code, size, certificate = (metadata.get(key) for key in ['versionCode', 'sizeBytes', 'signingCertificateSha256'])
    expected_package = 'com.highpass.player.p2p' if variant == 'p2p' else 'com.highpass.player'
    if type(code) is not int or not 1 <= code <= 2100000000 or metadata.get('applicationId') != expected_package:
        raise SystemExit('Metadados de APK inválidos')
    if type(size) is not int or not 0 < size <= MAX_APK_SIZE or not isinstance(metadata.get('versionName'), str) or not re.fullmatch(r'[a-zA-Z0-9.+_-]{1,40}', metadata['versionName']):
        raise SystemExit('Tamanho ou versão de APK inválidos')
    if not isinstance(certificate, str) or not re.fullmatch(r'[a-f0-9]{64}', certificate):
        raise SystemExit('Certificado de assinatura inválido')
    name = f'highpass-{code}.apk'
    if metadata.get('downloadUrl') != f'/downloads/{relative}/{name}' or not isinstance(metadata.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', metadata['sha256']):
        raise SystemExit('Caminho ou hash inválido')
    apk = source / relative / name
    if not apk.is_file() or apk.is_symlink() or apk.stat().st_size != size or sha256(apk) != metadata['sha256']:
        raise SystemExit('APK e manifesto não correspondem')
    if clients.get('androidP2p' if variant == 'p2p' else 'android') != metadata:
        raise SystemExit('Os manifestos dos clientes e do Android não correspondem')
    return relative, metadata, apk


def publish(source, destination):
    clients_path = source / 'clients.json'
    clients = json.loads(clients_path.read_text())
    variants = ['http', 'p2p'] if 'androidP2p' in clients else ['http']
    releases = [validate(source, clients, variant) for variant in variants]
    if len({metadata['signingCertificateSha256'] for _, metadata, _ in releases}) != 1:
        raise SystemExit('As versões precisam da mesma identidade de assinatura')
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
        # Verify all current identities/versions before publishing any files or feeds.
        for relative, metadata, apk in releases:
            directory = destination / relative
            current = directory / 'latest.json'
            if current.exists():
                installed = json.loads(current.read_text())
                if int(installed.get('versionCode', 0)) > metadata['versionCode']:
                    raise SystemExit('Não é permitido reduzir a versão publicada')
                if installed.get('signingCertificateSha256') != metadata['signingCertificateSha256']:
                    raise SystemExit('O certificado publicado precisa manter a identidade dos aplicativos instalados')
            target = directory / apk.name
            if target.exists() and sha256(target) != metadata['sha256']:
                raise SystemExit('A versão já existe com outro conteúdo. Incremente versionCode antes de publicar.')
        for relative, metadata, apk in releases:
            directory = destination / relative
            directory.mkdir(parents=True, exist_ok=True)
            directory.chmod(0o755)
            target = directory / apk.name
            if not target.exists():
                atomic_copy(apk, target)
        if tv_files:
            tv = destination / 'tv'
            tv.mkdir(exist_ok=True)
            tv.chmod(0o755)
            for item in tv_files:
                atomic_copy(item, tv / item.name)
        for relative, _, apk in releases:
            directory = destination / relative
            descriptor, link_name = tempfile.mkstemp(prefix='.highpass-latest.', dir=directory)
            os.close(descriptor)
            link = Path(link_name)
            try:
                link.unlink()
                link.symlink_to(apk.name)
                os.replace(link, directory / 'highpass-latest.apk')
            finally:
                link.unlink(missing_ok=True)
            atomic_copy(source / relative / 'latest.json', directory / 'latest.json')
        atomic_copy(clients_path, destination / 'clients.json')
    print('Clientes validados e publicados com APKs imutáveis e feeds separados')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--destination', type=Path, default=Path('/var/www/highpass-downloads'))
    args = parser.parse_args()
    publish(args.source, args.destination)
