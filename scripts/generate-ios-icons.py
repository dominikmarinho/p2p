#!/usr/bin/env python3
"""Generate the existing geometric Highpass H brand; no external image dependencies."""
from pathlib import Path
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent


def png(size, accent):
    background = (11, 16, 25)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            u, v = x * 96 / size, y * 96 / size
            ink = 24 <= v < 72 and (24 <= u < 34 or 62 <= u < 72) or 43 <= v < 53 and 34 <= u < 62
            row.extend(accent if ink else background)
        rows.append(bytes(row))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')


def main():
    assets = ROOT / 'apps/ios/Highpass/Assets.xcassets'
    assets.mkdir(parents=True, exist_ok=True)
    (assets / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
    for mode, accent in [('http', (110, 185, 255)), ('p2p', (101, 227, 177))]:
        web = ROOT / 'apps/webplayer/public/ios'
        web.mkdir(parents=True, exist_ok=True)
        for size in [180, 192, 512]:
            (web / f'{mode}-{size}.png').write_bytes(png(size, accent))
        icon = assets / ('AppIcon' + mode.upper() + '.appiconset')
        icon.mkdir(parents=True, exist_ok=True)
        (icon / 'Icon.png').write_bytes(png(1024, accent))
        (icon / 'Contents.json').write_text(json.dumps({'images': [{'filename': 'Icon.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')


if __name__ == '__main__':
    main()
