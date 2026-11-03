#!/usr/bin/env python3
"""Docker/host metrics via textfile; the exporter never receives Docker's socket."""
import json
import os
from pathlib import Path
import re
import subprocess
import time

OUTPUT = Path('/opt/highpass/monitoring/textfile')
UNITS = {'B': 1, 'kB': 1000, 'MB': 1000**2, 'GB': 1000**3, 'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'TiB': 1024**4}

def size(value):
    match = re.fullmatch(r'\s*([\d.]+)\s*([A-Za-z]+)\s*', value)
    if not match or match[2] not in UNITS:
        raise ValueError('Unidade Docker desconhecida')
    return float(match[1]) * UNITS[match[2]]

def collect():
    lines = ['# Container CPU percentage may exceed 100% on multiple cores.']
    command = ['docker', 'stats', '--no-stream', '--format', '{{json .}}']
    result = subprocess.run(command, capture_output=True, text=True, timeout=12, check=True)
    for raw in result.stdout.splitlines():
        item = json.loads(raw)
        name = item['Name']
        if not re.fullmatch(r'highpass-[a-zA-Z0-9_-]+', name):
            continue
        label = '{container="' + name + '"}'
        used, limit = item['MemUsage'].split('/')
        received, sent = item['NetIO'].split('/')
        for metric, value in [('cpu_percent', float(item['CPUPerc'].rstrip('%'))), ('memory_bytes', size(used)), ('memory_limit_bytes', size(limit)), ('network_received_bytes', size(received)), ('network_sent_bytes', size(sent)), ('pids', int(item['PIDs']))]:
            lines.append(f'highpass_container_{metric}{label} {value}')
    for nic in Path('/sys/class/net').iterdir():
        if not re.fullmatch(r'(eth|en|bond)[a-zA-Z0-9_.-]+', nic.name):
            continue
        for direction, filename in [('received', 'rx_bytes'), ('sent', 'tx_bytes'), ('receive_dropped', 'rx_dropped'), ('transmit_dropped', 'tx_dropped')]:
            lines.append(f'highpass_host_network_{direction}_total{{interface="{nic.name}"}} {int((nic / "statistics" / filename).read_text())}')
    lines.append(f'highpass_container_collection_timestamp_seconds {time.time()}')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT / 'containers.prom.tmp'
    temporary.write_text('\n'.join(lines) + '\n')
    temporary.chmod(0o644)
    os.replace(temporary, OUTPUT / 'containers.prom')

if __name__ == '__main__':
    collect()
