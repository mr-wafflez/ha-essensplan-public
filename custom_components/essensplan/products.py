"""Product lookup, search and contributions through the Open Food Facts API."""
import asyncio
import base64
from decimal import Decimal
from time import monotonic

from aiohttp import BasicAuth, ClientError, FormData

from .const import VERSION
from .nutrition import FIELDS, LIMITS, barcode, decimal_value

API = 'https://world.openfoodfacts.org/api/v3.6/product/'
# Writes go to production, or to the test server, which needs HTTP basic auth off/off.
WRITE_HOSTS = {False: 'https://world.openfoodfacts.org', True: 'https://world.openfoodfacts.net'}
USER_AGENT = 'Essensplan/{} (https://github.com/mr-wafflez/ha-essensplan-public)'
MAX_IMAGE = 4 * 1024 * 1024
SEARCH = 'https://search.openfoodfacts.org/search'
SEARCH_FIELDS = ('energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g')


def rounded(value):
    # Open Food Facts stores floats such as 1.70000004768372.
    return format(Decimal(value).quantize(Decimal('0.01')).normalize(), 'f')


def search_hits(payload):
    """Products sold in Germany with complete energy and macros, as short choices."""
    result = []
    for hit in payload.get('hits') or []:
        nutrients = hit.get('nutriments') or {}
        name = hit.get('product_name')
        code = hit.get('code')
        if not (isinstance(name, str) and name.strip() and isinstance(code, str) and code.isdigit()):
            continue
        try:
            kcal = float(nutrients[SEARCH_FIELDS[0]])
            if any(float(nutrients[field]) < 0 for field in SEARCH_FIELDS):
                continue
        except (KeyError, TypeError, ValueError):
            continue
        brands = hit.get('brands')
        brands = ', '.join(b.strip() for b in brands if isinstance(b, str) and b.strip()) if isinstance(brands, list) else brands
        label = ' · '.join(part for part in (name.strip(), brands if isinstance(brands, str) else '') if part)
        quantity = hit.get('quantity') if isinstance(hit.get('quantity'), str) else ''
        result.append({'barcode': code, 'name': label[:200], 'quantity': quantity[:40], 'kcal': round(kcal)})
        if len(result) >= 12:
            break
    return result


def normalize_product(payload, code):
    product = payload.get('product') or {}
    if not product:
        raise ValueError('Kein Produkt zu diesem Barcode gefunden.')
    nutrition = (product.get('nutrition') or {}).get('aggregated_set') or {}
    basis = nutrition.get('per')
    if (basis not in ('100g', '100ml') or nutrition.get('preparation') != 'as_sold'
            or product.get('nutrition_data_per') not in (None, '', basis)):
        raise ValueError('Für dieses Produkt fehlen passende Nährwerte pro 100 g oder 100 ml.')
    nutrients = nutrition.get('nutrients') or {}
    values = {}
    try:
        for field, label, unit, limit in zip(FIELDS, ('energy-kcal', 'proteins', 'carbohydrates', 'fat'),
                                             ('kcal', 'g', 'g', 'g'), LIMITS):
            nutrient = nutrients[label]
            if nutrient.get('unit') != unit:
                raise ValueError
            values[field] = rounded(decimal_value(nutrient['value'], 0, limit))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError('Das Produkt hat keine vollständigen Angaben für Energie und Makros.') from None
    name = ' · '.join(value.strip() for value in (product.get('product_name'), product.get('brands'))
                      if isinstance(value, str) and value.strip())
    return {'values': values, 'product': {'barcode': code, 'name': name[:200] or code, 'basis': basis}}


def contribution_fields(raw):
    """Validate what the user typed from the packaging."""
    name = raw.get('name')
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValueError('Bitte den Produktnamen von der Packung eingeben.')
    result = {'barcode': barcode(raw.get('barcode')), 'name': ' '.join(name.split())}
    for field in ('brand', 'quantity'):
        value = raw.get(field) or ''
        if not isinstance(value, str) or len(value) > 100:
            raise ValueError('Marke oder Packungsgröße ist zu lang.')
        result[field] = ' '.join(value.split())
    values = raw.get('values')
    if not isinstance(values, dict):
        raise ValueError('Bitte alle vier Werte pro 100 g von der Packung eingeben.')
    result['values'] = {field: rounded(decimal_value(values.get(field), 0, limit))
                        for field, limit in zip(FIELDS, LIMITS)}
    image = raw.get('image')
    result['image'] = None
    if image:
        try:
            data = base64.b64decode(image, validate=True)
        except (ValueError, TypeError):
            raise ValueError('Das Foto konnte nicht gelesen werden.') from None
        if len(data) > MAX_IMAGE or not data.startswith(b'\xff\xd8\xff'):
            raise ValueError('Das Foto muss ein JPEG unter 4 MB sein.')
        result['image'] = data
    return result


class ProductLookup:
    def __init__(self, session, account=None, staging=False):
        self.session = session
        self.cache = {}
        # (user name, password) of the household's Open Food Facts account, if any.
        self.account = account
        self.host = WRITE_HOSTS[bool(staging)]
        self.auth = BasicAuth('off', 'off') if staging else None

    @property
    def can_contribute(self):
        return bool(self.account)

    async def _request(self, method, url, **kwargs):
        try:
            async with self.session.request(method, url, auth=self.auth, timeout=20, allow_redirects=False,
                                            headers={'User-Agent': USER_AGENT.format(VERSION)}, **kwargs) as response:
                if response.status in (401, 403):
                    raise ValueError('Open Food Facts hat die Anmeldung abgelehnt. Prüfe Benutzername und Passwort '
                                     'in den Optionen der Integration.')
                if response.status == 404:
                    return None
                if response.status != 200:
                    raise ValueError('Open Food Facts ist gerade nicht verfügbar. Versuche es später noch einmal.')
                return await response.json(content_type=None)
        except (asyncio.TimeoutError, ClientError):
            raise ValueError('Open Food Facts ist gerade nicht erreichbar. Versuche es später noch einmal.') from None

    async def contribute(self, raw):
        """Add a missing product or its missing nutrition facts. Existing values are never replaced."""
        if not self.account:
            raise ValueError('Trage zuerst ein Open-Food-Facts-Konto in den Optionen der Integration ein.')
        data = contribution_fields(raw)
        code = data['barcode']
        found = await self._request('GET', f'{self.host}/api/v3.6/product/{code}',
                                    params={'fields': 'product_name,brands,quantity,nutrition,nutrition_data_per'})
        existing = (found or {}).get('product') or {}
        try:
            normalize_product(found or {}, code)
        except ValueError:
            pass
        else:
            raise ValueError('Dieses Produkt hat bei Open Food Facts schon Nährwerte. Nutze „Scannen“ oder die Suche.')
        per = {existing.get('nutrition_data_per')} | {
            item.get('per') for item in ((existing.get('nutrition') or {}).get('input_sets') or []) if isinstance(item, dict)}
        if 'serving' in per:
            # Switching to per-100 g would reinterpret the existing per-serving values.
            raise ValueError('Dieses Produkt hat bei Open Food Facts Angaben pro Portion. '
                             'Ergänze es bitte direkt auf openfoodfacts.org.')
        user, password = self.account
        form = {'code': code, 'user_id': user, 'password': password, 'lc': 'de', 'cc': 'de',
                'app_name': 'Essensplan', 'app_version': VERSION,
                'comment': 'Nährwerte von der Packung, eingetragen mit Essensplan für Home Assistant',
                'nutrition_data_per': '100g', 'add_countries': 'Deutschland'}
        for field, nutrient, unit in zip(FIELDS, ('energy-kcal', 'proteins', 'carbohydrates', 'fat'),
                                         ('kcal', 'g', 'g', 'g')):
            form[f'nutriment_{nutrient}'] = data['values'][field]
            form[f'nutriment_{nutrient}_unit'] = unit
        # Only fill gaps: an existing name or quantity stays, brands are added, not replaced.
        if not (existing.get('product_name') or '').strip():
            form['product_name_de'] = data['name']
        if data['quantity'] and not (existing.get('quantity') or '').strip():
            form['quantity'] = data['quantity']
        if data['brand']:
            form['add_brands'] = data['brand']
        answer = await self._request('POST', f'{self.host}/cgi/product_jqm2.pl', data=form)
        if not answer or answer.get('status') != 1:
            raise ValueError('Open Food Facts hat die Werte nicht gespeichert: '
                             + str((answer or {}).get('status_verbose') or 'unbekannter Fehler'))
        photo = None
        if data['image']:
            upload = FormData()
            for key in ('code', 'user_id', 'password', 'app_name', 'app_version'):
                upload.add_field(key, form[key])
            upload.add_field('imagefield', 'nutrition_de')
            upload.add_field('imgupload_nutrition_de', data['image'], filename='naehrwerte.jpg',
                             content_type='image/jpeg')
            try:
                result = await self._request('POST', f'{self.host}/cgi/product_image_upload.pl', data=upload)
                photo = bool(result) and result.get('status') == 'status ok'
            except ValueError:
                photo = False
        self.cache.pop(code, None)
        name = ' · '.join(part for part in (existing.get('product_name') or data['name'],
                                            existing.get('brands') or data['brand']) if part)
        return {'values': data['values'], 'product': {'barcode': code, 'name': name[:200], 'basis': '100g'},
                'photo': photo, 'test_server': self.auth is not None}

    async def search(self, query):
        """Text search; only the search term leaves Home Assistant."""
        query = ' '.join(query.split()) if isinstance(query, str) else ''
        if not 2 <= len(query) <= 100 or '"' in query or ':' in query:
            raise ValueError('Gib 2 bis 100 Zeichen ohne Anführungszeichen oder Doppelpunkt ein.')
        cached = self.cache.get(('search', query.casefold()))
        if cached and cached[0] > monotonic():
            return cached[1]
        try:
            async with self.session.get(
                SEARCH,
                params={'q': f'{query} countries_tags:"en:germany"', 'page_size': '50',
                        'fields': 'code,product_name,brands,quantity,nutriments'},
                headers={'User-Agent': f'Essensplan/{VERSION} (https://github.com/mr-wafflez/ha-essensplan-public)'},
                timeout=10, allow_redirects=False,
            ) as response:
                if response.status != 200:
                    raise ValueError('Die Produktsuche von Open Food Facts ist gerade nicht verfügbar.')
                data = await response.json()
        except (asyncio.TimeoutError, ClientError):
            raise ValueError('Open Food Facts ist gerade nicht erreichbar. BLS-Suche und eigene Werte gehen weiterhin.') from None
        result = search_hits(data if isinstance(data, dict) else {})
        if len(self.cache) >= 256:
            self.cache.pop(next(iter(self.cache)))
        self.cache[('search', query.casefold())] = (monotonic() + 3600, result)
        return result

    async def find(self, value, state):
        code = barcode(value)
        # Previously confirmed product values remain available offline.
        stored = [item.get('nutrition', {}) for recipe in state['recipes'].values() for item in recipe['ingredients']]
        stored += [entry.get('nutrition', {}) for entry in state.get('ingredients', {}).values()]
        for entry in stored:
            if entry.get('product', {}).get('barcode') == code:
                return {'values': entry['values'], 'product': entry['product']}
        cached = self.cache.get(code)
        if cached and cached[0] > monotonic():
            return cached[1]
        try:
            async with self.session.get(
                API + code,
                params={'fields': 'product_name,brands,nutrition,nutrition_data_per'},
                headers={'User-Agent': f'Essensplan/{VERSION} (https://github.com/mr-wafflez/ha-essensplan-public)'},
                timeout=8, allow_redirects=False,
            ) as response:
                if response.status == 404:
                    raise ValueError('Kein Produkt zu diesem Barcode gefunden.')
                if response.status != 200:
                    raise ValueError('Open Food Facts ist gerade nicht verfügbar. Eigene Werte sind weiterhin möglich.')
                data = await response.json()
        except (asyncio.TimeoutError, ClientError):
            raise ValueError('Open Food Facts ist gerade nicht erreichbar. Eigene Werte sind weiterhin möglich.') from None
        result = normalize_product(data, code)
        if len(self.cache) >= 256:
            self.cache.pop(next(iter(self.cache)))
        self.cache[code] = (monotonic() + 3600, result)
        return result
