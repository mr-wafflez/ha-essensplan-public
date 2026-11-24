"""Create the README images from invented test recipes.

Usage: python tools/readme_screenshots.py
Requires Node.js and Playwright with Chromium. The data is computed with the
integration's own model and nutrition code, so totals, suggestions and the
ingredient list match what Home Assistant would show. No real recipes are used.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / 'custom_components/essensplan'
TODAY = '2026-10-15'


def load():
    package = ModuleType('essensplan_readme')
    package.__path__ = [str(COMPONENT)]
    sys.modules[package.__name__] = package
    modules = {}
    for name in ('nutrition', 'model'):
        spec = importlib.util.spec_from_file_location(f'{package.__name__}.{name}', COMPONENT / f'{name}.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        modules[name] = module
    return modules['model'], modules['nutrition']


RECIPES = [
    ('Hähnchen-Curry mit Reis', 4, 35, [('Hähnchenbrust', '500', 'g'), ('Kokosmilch', '400', 'ml'),
                                        ('Paprika', '2', 'stück'), ('Zwiebel', '1', 'stück'),
                                        ('Reis', '250', 'g'), ('Currypulver', '2', 'tl')]),
    ('Linsensuppe', 4, 40, [('rote Linsen', '250', 'g'), ('Karotten', '2', 'stück'),
                            ('Zwiebel', '1', 'stück'), ('Gemüsebrühe', '1', 'l'), ('Olivenöl', '2', 'el')]),
    ('Ofengemüse mit Feta', 2, 45, [('Kartoffeln', '600', 'g'), ('Zucchini', '1', 'stück'),
                                    ('Paprika', '1', 'stück'), ('Feta', '1', 'stück'), ('Olivenöl', '3', 'el')]),
    ('Spaghetti Bolognese', 4, 50, [('Spaghetti', '500', 'g'), ('Hackfleisch', '500', 'g'),
                                    ('passierte Tomaten', '500', 'g'), ('Zwiebel', '1', 'stück'),
                                    ('Knoblauch', '2', 'stück'), ('Parmesan', None, '')]),
    ('Griechischer Salat', 2, 15, [('Gurke', '1', 'stück'), ('Tomaten', '4', 'stück'), ('Feta', '1', 'stück'),
                                   ('rote Zwiebel', '1', 'stück'), ('Oliven', '80', 'g'), ('Olivenöl', '2', 'el')]),
    ('Kartoffel-Lauch-Auflauf', 4, 60, [('Kartoffeln', '1', 'kg'), ('Lauch', '2', 'stück'), ('Sahne', '200', 'ml'),
                                        ('Reibekäse', '150', 'g'), ('Muskat', None, '')]),
]


def fixture():
    model, nutrition = load()
    state = model.initial_state()
    ids = {}

    def change(operation, payload, meals_per_day=2):
        nonlocal state
        state = model.mutate(state, operation, payload, TODAY, meals_per_day)

    for name, servings, minutes, items in RECIPES:
        before = set(state['recipes'])
        change('save_recipe', {'name': name, 'servings': servings, 'minutes': minutes, 'steps': ['Zubereiten.'],
                               'ingredients': [{'name': n, 'quantity': q or '', 'unit': u} for n, q, u in items]})
        ids[name] = (set(state['recipes']) - before).pop()
    change('favorite', {'id': ids['Linsensuppe'], 'favorite': True})
    change('set_meal', {'date': '2026-10-12', 'slot': 1, 'recipe_id': ids['Hähnchen-Curry mit Reis'], 'servings': 2,
                        'cook_servings': 6, 'leftover': {'date': '2026-10-14', 'slot': 0, 'servings': 2}})
    change('mark_cooked', {'date': '2026-10-12', 'slot': 1, 'cooked': True})
    change('set_meal', {'date': '2026-10-13', 'slot': 1, 'recipe_id': ids['Linsensuppe'], 'servings': 4})
    change('mark_cooked', {'date': '2026-10-13', 'slot': 1, 'cooked': True})
    change('set_meal', {'date': '2026-10-15', 'slot': 0, 'recipe_id': ids['Griechischer Salat'], 'servings': 2})
    change('set_meal', {'date': '2026-10-15', 'slot': 1, 'recipe_id': ids['Spaghetti Bolognese'], 'servings': 4})
    change('set_meal', {'date': '2026-10-17', 'slot': 1, 'recipe_id': ids['Ofengemüse mit Feta'], 'servings': 2})
    # Most ingredients take the first suggestion; a few stay open to show the workflow.
    open_names = {'Oliven', 'Reibekäse', 'Lauch', 'Sahne'}
    listed = []
    for entry in nutrition.ingredient_overview(state):
        if entry['status'] == 'open' and entry['name'] not in open_names:
            first = nutrition.candidates(entry['name'], state['recipes'])[0]
            listed.append({'name': entry['name'], 'nutrition': {'code': first['code']}})
    change('set_ingredients', {'items': listed})
    snapshot = dict(state, meals_per_day=2, modules={'nutrition': True}, today=TODAY,
                    nutrition={rid: nutrition.summary(nutrition.totals(r, state['ingredients']))
                               for rid, r in state['recipes'].items()},
                    shopping=model.shopping(state, TODAY))
    ingredient_list = nutrition.ingredient_overview(state)
    names = {entry['name'] for entry in ingredient_list}
    # Invented products; the real search asks Open Food Facts.
    products = {'Sahne': [
        {'barcode': '4000000000013', 'name': 'Schlagsahne 30 % · Beispielhof', 'quantity': '200 ml', 'kcal': 292},
        {'barcode': '4000000000020', 'name': 'Kochsahne 15 % · Musterland', 'quantity': '200 g', 'kcal': 164},
        {'barcode': '4000000000037', 'name': 'Bio-Sahne 32 % · Grünes Tal', 'quantity': '250 g', 'kcal': 307}]}
    return {'state': snapshot, 'ids': ids, 'products': products, 'ingredient_list': ingredient_list,
            'search': {name: nutrition.candidates(name, state['recipes'], state['ingredients']) for name in names}}


def main():
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'fixture.json'
        path.write_text(json.dumps(fixture(), ensure_ascii=False))
        subprocess.run(['node', str(ROOT / 'tools/readme_screenshots.cjs'), str(path), str(ROOT / 'docs/images')],
                       check=True)


if __name__ == '__main__':
    main()
