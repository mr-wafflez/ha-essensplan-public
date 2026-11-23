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
# Recipes say "Zwiebel"; the BLS says "Speisezwiebel roh". Household words map to
# raw basic foods first. Keys are whole query keys or word stems (see stems()).
_NOODLES = ('Teigwaren eifrei, roh', 'Eierteigwaren roh')
_GRATED = ('Gouda mind. 40 % Fett i. Tr.', 'Emmentaler mind. 45 % Fett i. Tr.', 'Edamer mind. 40 % Fett i. Tr.')
ALIASES = {
    'zwiebel': ('Speisezwiebel roh',), 'paprika': ('Gemüsepaprika rot, roh', 'Gemüsepaprika gelb, roh',
                                                   'Gemüsepaprika grün, roh'),
    'knoblauch': ('Knoblauch roh',), 'hackfleisch': ('Rind/Schwein, Hackfleisch gemischt, roh', 'Rind Hackfleisch, roh', 'Schwein Hackfleisch, roh'),
    'hack': ('Rind/Schwein, Hackfleisch gemischt, roh', 'Rind Hackfleisch, roh', 'Schwein Hackfleisch, roh'),
    'rinderhackfleisch': ('Rind Hackfleisch, roh',), 'rinderhack': ('Rind Hackfleisch, roh',),
    'schweinehackfleisch': ('Schwein Hackfleisch, roh',),
    'schweinehack': ('Schwein Hackfleisch, roh',), 'mageres hackfleisch': ('Rind Hackfleisch, roh',),
    'hahnchenbrust': ('Hähnchen Brustfilet, roh', 'Hähnchen Brust, ohne Haut, roh'),
    'hahnchenbrustfilet': ('Hähnchen Brustfilet, roh',),
    'sahne': ('Schlagsahne mind. 30 % Fett', 'Schlagsahne mind. 36 % Fett'),
    'saure sahne': ('Sauerrahm/Saure Sahne, mind. 10 % Fett',),
    'schmand': ('Sauerrahm/Schmand, mind. 20 % Fett',), 'fraiche': ('Sauerrahm/Creme fraiche, 30 % Fett',),
    'tomate': ('Tomate roh', 'Tomaten passiert/Tomatenpüree'), 'passiert': ('Tomaten passiert/Tomatenpüree',),
    'reibekase': _GRATED, 'kase': _GRATED, 'gouda': _GRATED[:1], 'gurke': ('Gurke roh',),
    'reis': ('Reis poliert, roh', 'Reis poliert, gekocht'), 'feta': ('Feta mind. 45 % Fett i. Tr.',),
    'mais': ('Zuckermais Konserve, abgetropft', 'Mais roh'),
    'bruhe': ('Gemüsebrühe', 'Hühnerbrühe', 'Fleischbrühe (Rind)'),
    'kartoffel': ('Kartoffel geschält, roh', 'Kartoffel ungeschält, roh'),
    'mohre': ('Karotte/Möhre, roh',), 'karotte': ('Karotte/Möhre, roh',), 'zucchini': ('Zucchini roh',),
    'nudel': _NOODLES, 'spaghetti': _NOODLES, 'pasta': _NOODLES, 'penne': _NOODLES, 'fusilli': _NOODLES,
    'makkaroni': _NOODLES, 'tagliatelle': _NOODLES, 'kritharaki': _NOODLES, 'farfalle': _NOODLES,
    'olivenol': ('Olivenöl',), 'ol': ('Rapsöl/Rüböl', 'Sonnenblumenöl', 'Olivenöl'),
    'rapsol': ('Rapsöl/Rüböl',), 'sonnenblumenol': ('Sonnenblumenöl',),
    'ei': ('Hühnerei roh',), 'eier': ('Hühnerei roh',), 'zitrone': ('Zitrone roh', 'Zitronensaft'),
    'zitronensaft': ('Zitronensaft',), 'brokkoli': ('Broccoli roh',), 'broccoli': ('Broccoli roh',),
    'milch': ('Vollmilch frisch, 3,5 % Fett, pasteurisiert',), 'butter': ('Butter mild gesäuert',),
    'frischkase': ('Frischkäsezubereitung Natur, mind. 50 % Fett i. Tr.',),
    'mozzarella': ('Mozzarella mind. 45 % Fett i. Tr.',), 'joghurt': ('Joghurt mild, mind. 3,5 % Fett',),
    'kidneybohne': ('Kidneybohne reif, Konserve, abgetropft',), 'kichererbse': ('Kichererbse reif, gekocht',),
    'kokosmilch': ('Kokosmilch/Kokosnussmilch',),
    'thunfisch': ('Thunfisch im eigenen Saft, Konserve, abgetropft',),
    'tortilla': ('Weizentortilla',), 'wrap': ('Weizentortilla',), 'brotchen': ('Weizenbrötchen',),
    'lauch': ('Porree/Lauch, roh',), 'porree': ('Porree/Lauch, roh',),
    'fruhlingszwiebel': ('Frühlingszwiebel/Lauchzwiebel, roh',), 'spinat': ('Spinat roh',),
    'champignon': ('Champignon roh',), 'pilz': ('Champignon roh',), 'ingwer': ('Ingwer/Ingwerwurzel, roh',),
    'honig': ('Honig',), 'senf': ('Senf mittelscharf',), 'ketchup': ('Tomatenketchup',),
    'passierte tomaten': ('Tomaten passiert/Tomatenpüree',), 'passierte tomate': ('Tomaten passiert/Tomatenpüree',),
    'schnittlauch': ('Schnittlauch roh',), 'petersilie': ('Petersilienblatt roh',),
    'lauchzwiebel': ('Frühlingszwiebel/Lauchzwiebel, roh',), 'rostzwiebel': ('Röstzwiebeln',),
    'wurstchen': ('Wiener Würstchen',), 'lachs': ('Lachs roh',), 'lachsfilet': ('Lachs roh',),
    'linse': ('Linse reif', 'Linse reif, gekocht'), 'rote linse': ('Linse rot reif',),
    'quark': ('Speisequark Magerstufe, Magerquark < 10 % Fett i. Tr.', 'Speisequark Halbfettstufe, 20 % Fett i. Tr.'),
    'magerquark': ('Speisequark Magerstufe, Magerquark < 10 % Fett i. Tr.',),
    'zucker': ('Zucker weiß (Raffinadezucker/Weißzucker)', 'Zucker braun (Kandisfarin/Rohzucker)'),
    'mayonnaise': ('Mayonnaise (Fertigprodukt)',), 'kartoffelknodel': ('Kartoffelkloß halb und halb, tiefgefroren',),
    'wokgemuse': ('Gemüsemischung asiatische Art, roh',), 'gyrosfleisch': ('Gyros (Schweinefleisch) gebraten',),
    'essig': ('Weinessig', 'Apfelessig'), 'gemischter salat': ('Gemischter Salat ohne Salatmarinade',),
}
# Prepared dishes rank below basic foods unless the query asks for them.
PROCESSED = {'gebraten', 'gedunstet', 'frittiert', 'gebacken', 'uberbacken', 'suppe', 'sauce', 'sosse',
             'kuchen', 'salat', 'auflauf', 'pudding', 'fullung', 'getrank', 'likor', 'mit', 'paniert',
             'geschmort', 'gegrillt', 'eintopf', 'gratin', 'pastete', 'teig', 'creme', 'cremesuppe'}
_NOISE = re.compile(r'\(.*?\)|[-—–]+>.*|\b(?:ca|circa|etwa)\b\.?|\d+[.,]?\d*\s*(?:kg|g|ml|l)?\b', re.I)


def key(value):
    return ' '.join(re.findall(r'[a-z0-9]+', unicodedata.normalize(
        'NFKD', value.casefold()).encode('ascii', 'ignore').decode()))


@cache
def catalog():
    path = Path(__file__).with_name('bls-4.0.json.gz')
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        return {code: (name, tuple(values)) for code, name, *values in json.load(handle)}


@cache
def codes_by_name():
    return {name: code for code, (name, _) in catalog().items()}


def search_key(value):
    return ' '.join(SYNONYMS.get(word, word) for word in key(value).split())


def word_forms(word):
    yield word
    for ending in ('en', 'es', 'n', 's', 'e'):
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            yield word[:-len(ending)]


@cache
def search_index():
    return [(code, search_key(name), set(search_key(name).split()),
             search_key(name.split(',')[0]), len(name))
            for code, (name, _) in catalog().items()]


def _matches(forms, tokens):
    # "zwiebel" matches "speisezwiebel"; short forms must match a whole word.
    return any(token == form or (len(form) >= 4 and token.endswith(form))
               for form in forms for token in tokens)


def _aliases(term):
    found = []
    words = term.split()
    whole = [' '.join([*words[:-1], form]) for form in word_forms(words[-1])]
    for probe in [*whole, *(form for word in reversed(words) for form in word_forms(word))]:
        for name in ALIASES.get(probe, ()):
            if name in codes_by_name() and name not in found:
                found.append(name)
        if found:
            break
    if not found:
        # Compounds: "Cherrytomaten" ends with "tomate", "Reibekäse" with "kase".
        for word in reversed(term.split()):
            for form in word_forms(word):
                base = max((alias for alias in ALIASES if ' ' not in alias and len(alias) >= 4
                            and form.endswith(alias)), key=len, default=None)
                if base:
                    return [name for name in ALIASES[base] if name in codes_by_name()]
    return found


def _ranked(words, term):
    preferred = PREFERRED.get(term, ())
    query_words = set(term.split())
    results = []
    for code, label, tokens, base, length in search_index():
        if not all(_matches(list(word_forms(word)), tokens) for word in words):
            continue
        processed = len((tokens & PROCESSED) - query_words)
        priority = preferred.index(label) if label in preferred else len(preferred)
        results.append((priority, processed, 'roh' not in tokens, label != term, base != term,
                        not label.startswith(term.split()[0] + ' '), length, code))
    return [item[-1] for item in sorted(results)]


def candidates(query, recipes, ingredients=None):
    original = key(query)
    term = search_key(_NOISE.sub(' ', query))
    if not term:
        return []
    remembered = Counter(item['nutrition']['code'] for recipe in recipes.values()
                         for item in recipe['ingredients']
                         if key(item['name']) == original and item.get('nutrition', {}).get('code') in catalog())
    listed = ((ingredients or {}).get(original) or {}).get('nutrition', {}).get('code')
    if listed in catalog():
        remembered[listed] += 1000
    ordered = [code for code, _ in remembered.most_common()]
    ordered += [codes_by_name()[name] for name in _aliases(term)]
    words = term.split()
    found = _ranked(words, term)
    # "rote Zwiebel", "mageres Hackfleisch": fall back to the head noun, then to any word.
    for fallback in ([words[-1]], *([word] for word in reversed(words[:-1]))):
        if found or len(words) == 1:
            break
        found = _ranked(fallback, fallback[0])
    ordered += found
    unique = list(dict.fromkeys(ordered))
    return [{'code': code, 'name': catalog()[code][0], 'kcal': round(float(catalog()[code][1][0]))}
            for code in unique[:12]]


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


# Grams per unit. "ml" is the density in g per ml. Values are household
# approximations; the ingredient list shows and lets you override each one.
WEIGHT_UNITS = ('stück', 'el', 'tl', 'prise', 'bund', 'dose', 'ml')
GENERIC_WEIGHTS = {'el': '10', 'tl': '4', 'prise': '0.3', 'ml': '1'}
DEFAULT_WEIGHTS = {
    'zwiebel': {'stück': '80'}, 'knoblauch': {'stück': '4'}, 'paprika': {'stück': '150'},
    'tomate': {'stück': '80', 'dose': '400'}, 'gurke': {'stück': '400'}, 'ei': {'stück': '60'}, 'eier': {'stück': '60'},
    'kartoffel': {'stück': '100'}, 'mohre': {'stück': '80'}, 'zucchini': {'stück': '250'},
    'aubergine': {'stück': '300'}, 'avocado': {'stück': '150'}, 'zitrone': {'stück': '100'},
    'limette': {'stück': '60'}, 'apfel': {'stück': '150'}, 'banane': {'stück': '120'},
    'fruhlingszwiebel': {'stück': '15', 'bund': '120'}, 'lauch': {'stück': '200'},
    'brokkoli': {'stück': '400'}, 'blumenkohl': {'stück': '600'}, 'champignon': {'stück': '20'},
    'chili': {'stück': '5'}, 'hahnchenbrust': {'stück': '150'}, 'mozzarella': {'stück': '125'},
    'feta': {'stück': '200'}, 'brotchen': {'stück': '60'}, 'tortilla': {'stück': '60'},
    'wrap': {'stück': '60'}, 'mais': {'dose': '140'}, 'kidneybohne': {'dose': '250'},
    'kichererbse': {'dose': '240'}, 'kokosmilch': {'dose': '400', 'ml': '1'},
    'thunfisch': {'dose': '150'}, 'petersilie': {'bund': '30'}, 'schnittlauch': {'bund': '30'},
    'dill': {'bund': '20'}, 'basilikum': {'bund': '20'}, 'koriander': {'bund': '25'},
    'radieschen': {'bund': '200'}, 'ol': {'el': '10', 'tl': '4', 'ml': '0.92'},
    'olivenol': {'el': '10', 'tl': '4', 'ml': '0.92'}, 'butter': {'el': '12'},
    'zucker': {'el': '12', 'tl': '4'}, 'mehl': {'el': '8', 'tl': '3'}, 'honig': {'el': '20', 'tl': '7'},
}
IGNORED_WORDS = {'salz', 'pfeffer', 'wasser', 'und', 'etwas', 'zum', 'abschmecken', 'nach', 'belieben',
                 'geschmack', 'oder', 'frisch', 'gemahlen', 'getrocknet'}
# Spices weigh a few grams per recipe; they count as "zählt nicht" until changed.
SPICES = {'paprikapulver', 'currypulver', 'chilipulver', 'knoblauchpulver', 'zwiebelpulver', 'ingwerpulver',
          'oregano', 'muskat', 'muskatnuss', 'kreuzkummel', 'kumin', 'zimt', 'thymian', 'rosmarin', 'majoran',
          'kurkuma', 'cayennepfeffer', 'chiliflocken', 'lorbeer', 'lorbeerblatt', 'lorbeerblatter', 'minze',
          'gewurz', 'gewurze', 'gewurzmischung', 'italienische', 'krauter'}


def stems(name):
    """Singular-ish word forms; 'Zwiebeln' and 'rote Zwiebel' share 'zwiebel'."""
    for word in set(key(name).split()) | set(search_key(name).split()):
        yield from word_forms(word)


def default_weights(name):
    found = {}
    for stem in stems(name):
        for base, weights in DEFAULT_WEIGHTS.items():
            # Compounds such as "Cherrytomaten" end with the base word; short words must match exactly.
            if stem == base or (len(base) >= 4 and stem.endswith(base)):
                for unit, grams in weights.items():
                    found.setdefault(unit, grams)
    return found


def ignored_by_default(name):
    words = key(_NOISE.sub(' ', name)).split()
    if not words:
        return False
    # The last word is the German head noun: "Hähnchen Gewürz" is a spice, "Taco-Gewürz" too.
    head = words[-1]
    return (set(words) <= IGNORED_WORDS | SPICES or head in SPICES or head.endswith('gewurz')
            or head.endswith('gewurze'))


def effective_weights(name, entry=None):
    """Return {unit: (grams, source)} with source own, default or generic."""
    result = {unit: (grams, 'generic') for unit, grams in GENERIC_WEIGHTS.items()}
    result.update({unit: (grams, 'default') for unit, grams in default_weights(name).items()})
    result.update({unit: (grams, 'own') for unit, grams in ((entry or {}).get('weights') or {}).items()})
    return result


def validate_ingredient(raw):
    """One entry of the household ingredient list; None removes the entry."""
    if not isinstance(raw, dict) or not isinstance(raw.get('name'), str) or not key(raw['name']):
        raise ValueError('Ungültige Zutat')
    name = raw['name'].strip()
    if len(name) > 200:
        raise ValueError('Zutatenname ist zu lang')
    result = {'name': name}
    if raw.get('nutrition') is not None:
        result['nutrition'] = validate_assignment(raw['nutrition'])
        result['nutrition'].pop('grams', None)
    weights = raw.get('weights') or {}
    if not isinstance(weights, dict) or any(unit not in WEIGHT_UNITS for unit in weights):
        raise ValueError('Gewichte gibt es nur für Stück, EL, TL, Prise, Bund, Dose und ml')
    cleaned = {unit: decimal_value(value, Decimal('0.001'), 100000)
               for unit, value in weights.items() if value not in (None, '')}
    if cleaned:
        result['weights'] = cleaned
    ignore = raw.get('ignore')
    if ignore is not None and type(ignore) is not bool:
        raise ValueError('ignore muss true oder false sein')
    if ignore is not None and ignore != ignored_by_default(name):
        result['ignore'] = ignore
    return result if len(result) > 1 else None


def is_ignored(name, entry):
    return (entry or {}).get('ignore', ignored_by_default(name))


def item_amount(item, entry, assignment):
    """Grams, or millilitres for products listed per 100 ml; (amount, problem)."""
    if assignment.get('grams') is not None:
        return Decimal(assignment['grams']), None
    if item.get('quantity') is None:
        return None, 'amount'
    quantity = Decimal(item['quantity'])
    unit = item['unit'] or 'stück'
    weights = effective_weights(item['name'], entry)
    density = Decimal(weights['ml'][0])
    volume = assignment.get('product', {}).get('basis') == '100ml'
    if unit in ('ml', 'l'):
        ml = quantity * (1000 if unit == 'l' else 1)
        return (ml if volume else ml * density), None
    if unit in ('g', 'kg'):
        grams = quantity * (1000 if unit == 'kg' else 1)
    elif unit in weights:
        grams = quantity * Decimal(weights[unit][0])
    else:
        return None, 'weight'
    return (grams / density if volume else grams), None


def totals(recipe, ingredients=None):
    """Recipe-specific assignments win; otherwise the household ingredient list applies."""
    ingredients = ingredients or {}
    total = dict.fromkeys(FIELDS, Decimal(0))
    missing, items = [], []
    used = 0
    for item in recipe['ingredients']:
        override = item.get('nutrition') or {}
        entry = ingredients.get(key(item['name']))
        if not override and is_ignored(item['name'], entry):
            items.append({'name': item['name'], 'status': 'ignored'})
            continue
        assignment = override or (entry or {}).get('nutrition') or {}
        code = assignment.get('code')
        catalog_entry = catalog().get(code) if code else None
        values = dict(zip(FIELDS, catalog_entry[1])) if catalog_entry else assignment.get('values')
        amount, problem = item_amount(item, entry, assignment)
        if values is None:
            problem = 'mapping'
        if problem:
            missing.append(item['name'])
            items.append({'name': item['name'], 'status': problem})
            continue
        used += 1
        items.append({'name': item['name'], 'status': 'ok', 'amount': float(amount),
                      'basis': '100ml' if assignment.get('product', {}).get('basis') == '100ml' else '100g',
                      'source': 'recipe' if override else 'list'})
        for field in FIELDS:
            total[field] += Decimal(values[field]) * amount / 100
    servings = Decimal(recipe['servings'])
    return {'total': {field: float(value) for field, value in total.items()},
            'portion': {field: float(value / servings) for field, value in total.items()},
            'missing': missing, 'used': used, 'items': items}


def assignment_label(assignment):
    if not assignment:
        return ''
    if 'product' in assignment:
        return assignment['product']['name']
    if 'code' in assignment:
        return catalog()[assignment['code']][0]
    return 'Eigene Werte'


def ingredient_overview(state):
    """Every distinct ingredient name used in recipes, most frequent first."""
    groups = {}
    for recipe in state['recipes'].values():
        seen = set()
        for item in recipe['ingredients']:
            name_key = key(item['name'])
            if not name_key:
                continue
            group = groups.setdefault(name_key, {'names': Counter(), 'recipes': 0, 'units': set(),
                                                 'unmeasured': 0})
            group['names'][item['name']] += 1
            group['units'].add(item['unit'] or ('stück' if item.get('quantity') is not None else ''))
            group['unmeasured'] += item.get('quantity') is None
            if name_key not in seen:
                group['recipes'] += 1
                seen.add(name_key)
    catalog_entries = state.get('ingredients', {})
    result = []
    for name_key, group in groups.items():
        entry = catalog_entries.get(name_key) or {}
        name = entry.get('name') or group['names'].most_common(1)[0][0]
        assignment = entry.get('nutrition')
        ignored = is_ignored(name, entry)
        result.append({
            'key': name_key, 'name': name, 'recipes': group['recipes'],
            'units': sorted(unit for unit in group['units'] if unit),
            'unmeasured': group['unmeasured'],
            'status': 'ignored' if ignored else 'mapped' if assignment else 'open',
            'ignore': ignored, 'ignore_default': ignored_by_default(name),
            'nutrition': assignment, 'label': assignment_label(assignment),
            'weights': {unit: {'grams': grams, 'source': source}
                        for unit, (grams, source) in effective_weights(name, entry).items()},
            'defaults': {unit: {'grams': grams, 'source': source}
                         for unit, (grams, source) in effective_weights(name).items()},
        })
    result.sort(key=lambda item: (-item['recipes'], item['name'].casefold()))
    return result
