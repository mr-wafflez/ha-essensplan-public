"""Open Food Facts parsing and text search without network or aiohttp."""
import asyncio
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest

component = Path(__file__).parents[1] / 'custom_components/essensplan'
package = ModuleType('essensplan_products_test')
package.__path__ = [str(component)]
sys.modules[package.__name__] = package
sys.modules.setdefault('aiohttp', SimpleNamespace(ClientError=OSError))
spec = importlib.util.spec_from_file_location(f'{package.__name__}.products', component / 'products.py')
products = importlib.util.module_from_spec(spec)
spec.loader.exec_module(products)


def hit(code, name, kcal=234, **extra):
    nutrients = {'energy-kcal_100g': kcal, 'proteins_100g': 18, 'carbohydrates_100g': 0.5, 'fat_100g': 18}
    return {'code': code, 'product_name': name, 'brands': ['Landjunker'], 'quantity': '500 g',
            'nutriments': nutrients, **extra}


class Response:
    def __init__(self, status, payload):
        self.status, self.payload = status, payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def json(self):
        return self.payload


class Session:
    def __init__(self, response):
        self.response, self.calls = response, []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class ProductTests(unittest.TestCase):
    def test_search_keeps_complete_products_only(self):
        incomplete = hit('4021782250052', 'Hackfleisch gemischt')
        del incomplete['nutriments']['fat_100g']
        payload = {'hits': [hit('4056489116066', 'Hackfleisch gemischt'), incomplete,
                            hit('123', ' ', kcal=100), hit('abc', 'Kein Barcode'),
                            hit('4306528127813', 'Hackfleisch, gemischt', kcal=235.6)]}
        self.assertEqual(products.search_hits(payload), [
            {'barcode': '4056489116066', 'name': 'Hackfleisch gemischt · Landjunker', 'quantity': '500 g', 'kcal': 234},
            {'barcode': '4306528127813', 'name': 'Hackfleisch, gemischt · Landjunker', 'quantity': '500 g', 'kcal': 236}])

    def test_search_sends_only_the_term_and_caches(self):
        session = Session(Response(200, {'hits': [hit('4056489116066', 'Hackfleisch gemischt')]}))
        lookup = products.ProductLookup(session)
        first = asyncio.run(lookup.search('  Hackfleisch   gemischt '))
        second = asyncio.run(lookup.search('hackfleisch gemischt'))
        self.assertEqual(first, second)
        self.assertEqual(len(session.calls), 1)
        url, kwargs = session.calls[0]
        self.assertEqual(url, products.SEARCH)
        self.assertEqual(kwargs['params']['q'], 'Hackfleisch gemischt countries_tags:"en:germany"')
        for query in ('a', 'x' * 101, 'name:"x"'):
            with self.assertRaises(ValueError):
                asyncio.run(lookup.search(query))
        with self.assertRaises(ValueError):
            asyncio.run(products.ProductLookup(Session(Response(503, {}))).search('Kartoffeln'))

    def test_product_values_are_rounded(self):
        nutrients = {label: {'value': value, 'unit': unit} for label, value, unit in (
            ('energy-kcal', 71, 'kcal'), ('proteins', 1.70000004768372, 'g'),
            ('carbohydrates', 15, 'g'), ('fat', 0.100000001490116, 'g'))}
        payload = {'product': {'product_name': 'Speisekartoffeln festkochend', 'brands': 'REWE',
                               'nutrition': {'aggregated_set': {'per': '100g', 'preparation': 'as_sold',
                                                                'nutrients': nutrients}}}}
        result = products.normalize_product(payload, '4388860481389')
        self.assertEqual(result['values'], {'kcal': '71', 'protein': '1.7', 'carbs': '15', 'fat': '0.1'})
