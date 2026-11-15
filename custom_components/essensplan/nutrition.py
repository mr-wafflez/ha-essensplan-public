"""Local BLS catalog, matching and mass-based nutrition totals."""
from collections import Counter
from decimal import Decimal, InvalidOperation
from functools import cache
import gzip
import json
from pathlib import Path
import re
import unicodedata

FIELDS = ('kcal', 'protein', 'carbs', 'fat')
LIMITS = (1000, 100, 100, 100)
SYNONYMS = {'kartoffeln': 'kartoffel', 'zwiebeln': 'zwiebel',
            'karotten': 'mohre', 'karotte': 'mohre', 'mohren': 'mohre',
            'hahnchenbrust': 'hahnchen brust', 'hahnchenbrustfilet': 'hahnchen brustfilet'}
PREFERRED = {'reis': ('reis poliert roh', 'reis poliert gekocht'),
             'mehl': ('weizen mehl type 405', 'weizen mehl type 550')}


def key(value):
    return ' '.join(re.findall(r'[a-z0-9]+', unicodedata.normalize(
        'NFKD', value.casefold()).encode('ascii', 'ignore').decode()))


@cache
def catalog():
    path = Path(__file__).with_name('bls-4.0.json.gz')
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        return {code: (name, tuple(values)) for code, name, *values in json.load(handle)}


def search_key(value):
    return ' '.join(SYNONYMS.get(word, word) for word in key(value).split())


@cache
def search_index():
    return [(code, search_key(name), set(search_key(name).split()),
             search_key(name.split(',')[0]), len(name))
            for code, (name, _) in catalog().items()]


def candidates(query, recipes):
    original = key(query)
    term = search_key(query)
    if not term:
        return []
    remembered = Counter(item['nutrition']['code'] for recipe in recipes.values()
                         for item in recipe['ingredients']
                         if key(item['name']) == original and item.get('nutrition', {}).get('code') in catalog())
    words = set(term.split())
    preferred = PREFERRED.get(term, ())
    results = []
    for code, label, tokens, base, length in search_index():
        if code not in remembered and not words <= tokens:
            continue
        priority = preferred.index(label) if label in preferred else len(preferred)
        results.append((-remembered[code], priority, label != term, base != term,
                        not label.startswith(term.split()[0]+' '), length, code))
    return [{'code': code, 'name': catalog()[code][0]}
            for *_, code in sorted(results)[:12]]


def decimal_value(value, minimum, maximum):
    try:
        result = Decimal(str(value).replace(',', '.'))
    except InvalidOperation:
        raise ValueError('Ungültiger Nährwert oder ungültiges Gewicht') from None
    if not result.is_finite() or not minimum <= result <= maximum:
        raise ValueError('Nährwert oder Gewicht außerhalb des erlaubten Bereichs')
    return str(result)


def barcode(value):
    value = value.strip() if isinstance(value, str) else ''
    if not re.fullmatch(r'(?:[0-9]{8}|[0-9]{12,14})', value):
        raise ValueError('Gib einen EAN- oder UPC-Barcode mit 8, 12, 13 oder 14 Ziffern ein.')
    checksum = sum(int(digit) * (3 if i % 2 else 1) for i, digit in enumerate(reversed(value)))
    if checksum % 10:
        raise ValueError('Die Prüfziffer des Barcodes stimmt nicht.')
    return value


def validate_assignment(raw):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError('Ungültige Nährwertzuordnung')
    result = {}
    if 'code' in raw:
        code = raw['code']
        if code not in catalog() or 'values' in raw:
            raise ValueError('Unbekannter BLS-Eintrag')
        result['code'] = code
    elif 'values' in raw:
        values = raw['values']
        result['values'] = {field: decimal_value(values[field], 0, limit)
                            for field, limit in zip(FIELDS, LIMITS)}
    else:
        raise ValueError('Wähle einen BLS-Eintrag oder gib eigene Nährwerte ein')
    if 'product' in raw:
        product = raw['product']
        if 'values' not in result or product['basis'] not in ('100g', '100ml'):
            raise ValueError('Ungültige Produktzuordnung')
        name = product['name']
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ValueError('Ungültiger Produktname')
        result['product'] = {'barcode': barcode(product['barcode']), 'name': name.strip(), 'basis': product['basis']}
    if raw.get('grams') not in (None, '') and result.get('product', {}).get('basis') != '100ml':
        result['grams'] = decimal_value(raw['grams'], Decimal('0.001'), 1000000000)
    return result


def totals(recipe):
    total = dict.fromkeys(FIELDS, Decimal(0))
    missing = []
    used = 0
    for item in recipe['ingredients']:
        assignment = item.get('nutrition', {})
        entry = catalog().get(assignment.get('code')) if assignment.get('code') else None
        values = dict(zip(FIELDS, entry[1])) if entry else assignment.get('values')
        volume = assignment.get('product', {}).get('basis') == '100ml'
        amount = None if volume else assignment.get('grams')
        units = ('ml', 'l') if volume else ('g', 'kg')
        if amount is None and item.get('quantity') is not None and item['unit'] in units:
            amount = Decimal(item['quantity']) * (1000 if item['unit'] == units[1] else 1)
        if values is None or amount is None:
            missing.append(item['name'])
            continue
        used += 1
        for field in FIELDS:
            total[field] += Decimal(values[field]) * Decimal(amount) / 100
    servings = Decimal(recipe['servings'])
    return {'total': {field: float(value) for field, value in total.items()},
            'portion': {field: float(value / servings) for field, value in total.items()},
            'missing': missing, 'used': used}
