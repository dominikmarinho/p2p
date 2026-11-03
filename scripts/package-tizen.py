from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
source = root / 'apps' / 'tizen'
ElementTree.parse(source / 'config.xml')
output = root / 'artifacts' / 'highpass-tizen-unsigned.wgt'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(source.iterdir()):
        if path.is_file():
            archive.write(path, path.name)
print(f'WGT sem assinatura: {output}')
