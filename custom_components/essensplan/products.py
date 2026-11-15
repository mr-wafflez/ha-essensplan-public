"""Product lookup by validated GTIN through the Open Food Facts API."""
import asyncio
from time import monotonic

from aiohttp import ClientError

from .const import VERSION
from .nutrition import FIELDS, LIMITS, barcode, decimal_value

API = 'https://world.openfoodfacts.org/api/v3.6/product/'


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
            values[field] = decimal_value(nutrient['value'], 0, limit)
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError('Das Produkt hat keine vollständigen Angaben für Energie und Makros.') from None
    name = ' · '.join(value.strip() for value in (product.get('product_name'), product.get('brands'))
                      if isinstance(value, str) and value.strip())
    return {'values': values, 'product': {'barcode': code, 'name': name[:200] or code, 'basis': basis}}


class ProductLookup:
    def __init__(self, session):
        self.session = session
        self.cache = {}

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
