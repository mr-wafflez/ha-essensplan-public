"""Open Food Facts parsing and text search without network or aiohttp."""
import asyncio
import base64
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest

component = Path(__file__).parents[1] / 'custom_components/essensplan'
package = ModuleType('essensplan_products_test')
package.__path__ = [str(component)]
sys.modules[package.__name__] = package
class FakeForm:
    def __init__(self):
        self.fields = []

    def add_field(self, name, value, **extra):
        self.fields.append((name, value, extra))


sys.modules.setdefault('aiohttp', SimpleNamespace(ClientError=OSError, BasicAuth=lambda user, password: (user, password),
                                                  FormData=FakeForm))
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

    async def json(self, **_):
        return self.payload


class Session:
    def __init__(self, response):
        self.response, self.calls = response, []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class WriteSession:
    """Answers per (method, path suffix); records every request."""
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        for (want_method, suffix), response in self.answers.items():
            if method == want_method and url.endswith(suffix):
                return response
        raise AssertionError(f'unexpected {method} {url}')


PACKAGE = {'barcode': '4000000000013', 'name': ' Rote  Zwiebeln ', 'brand': 'Beispielhof', 'quantity': '500 g',
           'values': {'kcal': '40', 'protein': '1,2', 'carbs': '7.6', 'fat': '0.1'}}


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


class ContributionTests(unittest.TestCase):
    def contribute(self, existing, raw=PACKAGE, staging=False, upload=None):
        answers = {('GET', '/product/4000000000013'): Response(404 if existing is None else 200, existing),
                   ('POST', '/cgi/product_jqm2.pl'): Response(200, {'status': 1, 'status_verbose': 'fields saved'})}
        if upload is not None:
            answers[('POST', '/cgi/product_image_upload.pl')] = upload
        session = WriteSession(answers)
        lookup = products.ProductLookup(session, ('haushalt', 'geheim'), staging)
        return asyncio.run(lookup.contribute(dict(raw))), session

    def test_new_product_sends_packaging_values_per_100_g(self):
        result, session = self.contribute(None)
        method, url, kwargs = session.calls[1]
        form = kwargs['data']
        self.assertEqual(url, 'https://world.openfoodfacts.org/cgi/product_jqm2.pl')
        self.assertEqual({k: form[k] for k in ('code', 'user_id', 'password', 'product_name_de', 'add_brands', 'quantity',
                                               'nutrition_data_per', 'nutriment_energy-kcal', 'nutriment_energy-kcal_unit',
                                               'nutriment_proteins', 'nutriment_carbohydrates', 'nutriment_fat', 'app_name')},
                         {'code': '4000000000013', 'user_id': 'haushalt', 'password': 'geheim',
                          'product_name_de': 'Rote Zwiebeln', 'add_brands': 'Beispielhof', 'quantity': '500 g',
                          'nutrition_data_per': '100g', 'nutriment_energy-kcal': '40', 'nutriment_energy-kcal_unit': 'kcal',
                          'nutriment_proteins': '1.2', 'nutriment_carbohydrates': '7.6', 'nutriment_fat': '0.1',
                          'app_name': 'Essensplan'})
        self.assertIsNone(kwargs['auth'])
        self.assertEqual(result['product'], {'barcode': '4000000000013', 'name': 'Rote Zwiebeln · Beispielhof', 'basis': '100g'})
        self.assertIsNone(result['photo'])

    def test_existing_product_keeps_its_name_and_complete_values_are_refused(self):
        named = {'product': {'product_name': 'Zwiebeln rot', 'quantity': '1 kg'}}
        result, session = self.contribute(named)
        form = session.calls[1][2]['data']
        self.assertNotIn('product_name_de', form)
        self.assertNotIn('quantity', form)
        self.assertEqual(result['product']['name'], 'Zwiebeln rot · Beispielhof')
        nutrients = {label: {'value': 1, 'unit': unit} for label, unit in (
            ('energy-kcal', 'kcal'), ('proteins', 'g'), ('carbohydrates', 'g'), ('fat', 'g'))}
        complete = {'product': {'product_name': 'X', 'nutrition': {'aggregated_set': {
            'per': '100g', 'preparation': 'as_sold', 'nutrients': nutrients}}}}
        with self.assertRaisesRegex(ValueError, 'schon Nährwerte'):
            self.contribute(complete)
        with self.assertRaisesRegex(ValueError, 'pro Portion'):
            self.contribute({'product': {'nutrition_data_per': 'serving'}})

    def test_photo_upload_and_test_server(self):
        jpeg = base64.b64encode(b'\xff\xd8\xff\xe0' + b'0' * 100).decode()
        result, session = self.contribute(None, {**PACKAGE, 'image': jpeg}, staging=True,
                                          upload=Response(200, {'status': 'status ok', 'imgid': 3}))
        self.assertTrue(result['photo'] and result['test_server'])
        method, url, kwargs = session.calls[2]
        self.assertEqual(url, 'https://world.openfoodfacts.net/cgi/product_image_upload.pl')
        self.assertEqual(kwargs['auth'], ('off', 'off'))
        fields = {name: value for name, value, _ in kwargs['data'].fields}
        self.assertEqual(fields['imagefield'], 'nutrition_de')
        self.assertTrue(fields['imgupload_nutrition_de'].startswith(b'\xff\xd8\xff'))
        # A failed photo upload keeps the saved values and is reported.
        result, _ = self.contribute(None, {**PACKAGE, 'image': jpeg}, upload=Response(503, {}))
        self.assertIs(result['photo'], False)

    def test_invalid_input_and_missing_account(self):
        for raw in ({**PACKAGE, 'barcode': '123'}, {**PACKAGE, 'name': ' '},
                    {**PACKAGE, 'values': {**PACKAGE['values'], 'fat': ''}},
                    {**PACKAGE, 'values': {**PACKAGE['values'], 'kcal': '5000'}},
                    {**PACKAGE, 'image': base64.b64encode(b'GIF89a').decode()}):
            with self.assertRaises(ValueError):
                products.contribution_fields(raw)
        with self.assertRaisesRegex(ValueError, 'Konto'):
            asyncio.run(products.ProductLookup(WriteSession({})).contribute(dict(PACKAGE)))
        rejected = WriteSession({('GET', '/product/4000000000013'): Response(403, {})})
        with self.assertRaisesRegex(ValueError, 'Anmeldung'):
            asyncio.run(products.ProductLookup(rejected, ('a', 'b')).contribute(dict(PACKAGE)))
