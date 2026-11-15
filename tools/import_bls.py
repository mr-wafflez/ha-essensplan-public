"""Generate the small Essensplan catalog from the official BLS 4.0 download.

Usage: python tools/import_bls.py BLS_4_0_2025_DE.zip (requires openpyxl).
"""
import argparse
from decimal import Decimal, InvalidOperation
import gzip
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook

FIELDS = ('BLS', 'Lebensmittelbezeichnung', 'ENERCC', 'PROT625', 'CHO', 'FAT')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    with ZipFile(args.archive) as archive:
        name = next(name for name in archive.namelist() if name.endswith('/BLS_4_0_Daten_2025_DE.xlsx'))
        workbook = load_workbook(BytesIO(archive.read(name)), read_only=True, data_only=True)
    rows = iter(workbook.active.values)
    header = [name.split(' ')[0] if isinstance(name, str) else '' for name in next(rows)]
    columns = [header.index(field) for field in FIELDS]
    result = []
    for row in rows:
        code, name, *raw = [row[column] for column in columns]
        try:
            values = [Decimal(str(value).replace(',', '.')) for value in raw]
        except InvalidOperation:
            continue
        if all(value.is_finite() and value >= 0 for value in values):
            result.append([code, name, *(str(value) for value in values)])
    workbook.close()
    target = Path(__file__).resolve().parents[1] / 'custom_components/essensplan/bls-4.0.json.gz'
    target.write_bytes(gzip.compress(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
    print(f'{len(result)} BLS records in {target.name}')


if __name__ == '__main__':
    main()
