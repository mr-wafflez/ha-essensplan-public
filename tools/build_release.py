"""Build the self-contained manual-install ZIP using only the standard library."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
component = root / 'custom_components' / 'essensplan'
version = json.loads((component / 'manifest.json').read_text())['version']
target = root / 'dist' / f'essensplan-{version}.zip'
target.parent.mkdir(exist_ok=True)
files = [p for p in component.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc']
files += [root / name for name in ['README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE',
                                   'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md',
                                   'dashboard.yaml', 'hacs.json']]
files += [p for p in (root / 'docs').rglob('*') if p.is_file()]
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, path.relative_to(root).as_posix())
print(target)
