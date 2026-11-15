"""Run with python -m unittest discover -s tests -v; no dependencies needed."""
import importlib.util
from pathlib import Path
import unittest
import sys
from types import ModuleType

component = Path(__file__).parents[1] / 'custom_components/essensplan'
package = ModuleType('essensplan_model_test')
package.__path__ = [str(component)]
sys.modules[package.__name__] = package
spec = importlib.util.spec_from_file_location(f'{package.__name__}.model', component / 'model.py')
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
from essensplan_model_test import nutrition

TODAY = '2026-10-15'


def recipe(name='Curry', quantity='500', unit='g', ingredient='Hähnchen'):
    return {'name': name, 'servings': 4, 'ingredients': [{'name': ingredient, 'quantity': quantity, 'unit': unit}], 'steps': ['Garen.']}


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.state = model.initial_state()

    def change(self, op, data):
        self.state = model.mutate(self.state, op, data, TODAY)
        return self.state

    def add(self, **kwargs):
        before = set(self.state['recipes'])
        self.change('save_recipe', recipe(**kwargs))
        return (set(self.state['recipes'])-before).pop()

    def plan(self, rid, date=TODAY, servings=4):
        self.change('set_meal', {'date':date,'recipe_id':rid,'servings':servings})

    def test_barcode_volume_based_nutrition(self):
        self.assertEqual(nutrition.barcode(' 3017620422003 '), '3017620422003')
        with self.assertRaises(ValueError):
            nutrition.barcode('3017620422004')
        rid = self.add(ingredient='Milch', quantity='0,5', unit='l')
        product = {'barcode': '3017620422003', 'name': 'Testprodukt', 'basis': '100ml'}
        values = {'kcal': 60, 'protein': 3, 'carbs': 5, 'fat': 2}
        self.change('set_nutrition', {'id': rid, 'assignments': [{'product': product, 'values': values}]})
        current = self.state['recipes'][rid]
        self.assertEqual(current['ingredients'][0]['nutrition']['product'], product)
        self.assertEqual(nutrition.totals(current)['total']['kcal'], 300)
        self.change('save_recipe', {**current, 'ingredients': [{'name': 'Milch', 'quantity': 500, 'unit': 'g'}]})
        # Grams convert to millilitres through the density (default 1 g per ml).
        self.assertEqual(nutrition.totals(self.state['recipes'][rid])['total']['kcal'], 300)

    def test_nutrition_suggestions_and_reuse(self):
        raw, cooked, *_ = nutrition.candidates('Reis', {})
        self.assertIn('roh', raw['name'])
        self.assertIn('gekocht', cooked['name'])
        self.assertIn('Kartoffel', nutrition.candidates('Kartoffeln roh', {})[0]['name'])
        rid = self.add(ingredient='Reis')
        self.change('set_nutrition', {'id': rid, 'assignments': [{'code': cooked['code']}]})
        self.assertEqual(nutrition.candidates('Reis', self.state['recipes'])[0], cooked)

    def test_nutrition_totals_are_partial_and_do_not_change_shopping(self):
        values = {'kcal': 120, 'protein': 10, 'carbs': 15, 'fat': 3}
        raw = recipe(quantity='0,5', unit='kg')
        raw['ingredients'].append({'name': 'Rucola', 'quantity': 1, 'unit': 'bund'})
        self.change('save_recipe', raw)
        rid = next(iter(self.state['recipes']))
        self.plan(rid)
        before = model.shopping(self.state, TODAY)
        self.change('set_nutrition', {'id': rid, 'assignments': [{'values': values}, {'values': values}]})
        result = nutrition.totals(self.state['recipes'][rid])
        self.assertEqual(result['total'], {'kcal': 600, 'protein': 50, 'carbs': 75, 'fat': 15})
        self.assertEqual(result['portion']['kcal'], 150)
        self.assertEqual(result['missing'], ['Rucola'])
        self.change('set_nutrition', {'id': rid, 'assignments': [{'values': values}, {'values': values, 'grams': '80'}]})
        self.assertEqual(nutrition.totals(self.state['recipes'][rid])['total']['kcal'], 696)
        self.assertEqual(model.shopping(self.state, TODAY), before)
        self.change('save_recipe', {**raw, 'id': rid})
        self.assertEqual(self.state['recipes'][rid]['ingredients'][1]['nutrition']['grams'], '80')
        raw['ingredients'][1]['quantity'] = 2
        self.change('save_recipe', {**raw, 'id': rid})
        self.assertNotIn('grams', self.state['recipes'][rid]['ingredients'][1]['nutrition'])
        with self.assertRaises(ValueError):
            self.change('set_nutrition', {'id': rid, 'assignments': [{'code': 'invalid'}, None]})

    def test_household_ingredient_list_applies_to_all_recipes(self):
        onion = nutrition.candidates('Zwiebel', {})[0]
        first = self.add(name='Auflauf', ingredient='Zwiebeln', quantity='2', unit='stück')
        second = self.add(name='Suppe', ingredient='zwiebeln', quantity='100', unit='g')
        self.change('set_ingredients', {'items': [{'name': 'Zwiebeln', 'nutrition': {'code': onion['code']}}]})
        kcal = nutrition.catalog()[onion['code']][1][0]
        ingredients = self.state['ingredients']
        first_totals = nutrition.totals(self.state['recipes'][first], ingredients)
        self.assertEqual(first_totals['missing'], [])
        self.assertAlmostEqual(first_totals['total']['kcal'], float(kcal) * 1.6)  # 2 × 80 g default
        self.assertAlmostEqual(nutrition.totals(self.state['recipes'][second], ingredients)['total']['kcal'], float(kcal))
        self.change('set_ingredients', {'items': [{'name': 'Zwiebeln', 'nutrition': {'code': onion['code']},
                                                   'weights': {'stück': '100'}}]})
        self.assertAlmostEqual(nutrition.totals(self.state['recipes'][first], self.state['ingredients'])['total']['kcal'],
                               float(kcal) * 2)
        overview = {item['key']: item for item in nutrition.ingredient_overview(self.state)}
        entry = overview['zwiebeln']
        self.assertEqual((entry['recipes'], entry['status'], entry['units']), (2, 'mapped', ['g', 'stück']))
        self.assertEqual(entry['weights']['stück'], {'grams': '100', 'source': 'own'})
        self.assertEqual(entry['weights']['el']['source'], 'generic')
        # An empty entry removes the ingredient from the list again.
        self.change('set_ingredients', {'items': [{'name': 'ZWIEBELN'}]})
        self.assertEqual(self.state['ingredients'], {})

    def test_amount_problems_and_ignored_ingredients(self):
        rid = self.add(ingredient='Salz', quantity='', unit='')
        values = {'kcal': 100, 'protein': 1, 'carbs': 1, 'fat': 1}
        self.change('save_recipe', {**self.state['recipes'][rid], 'ingredients': [
            {'name': 'Salz', 'quantity': '', 'unit': ''},
            {'name': 'Hähnchen', 'quantity': '', 'unit': ''},
            {'name': 'Rucola', 'quantity': '1', 'unit': 'bund'},
            {'name': 'Eier', 'quantity': '2', 'unit': ''}]})
        self.change('set_ingredients', {'items': [{'name': n, 'nutrition': {'values': values}}
                                                  for n in ('Hähnchen', 'Rucola', 'Eier')]})
        result = nutrition.totals(self.state['recipes'][rid], self.state['ingredients'])
        self.assertEqual([i['status'] for i in result['items']], ['ignored', 'amount', 'weight', 'ok'])
        self.assertEqual(result['items'][3]['amount'], 120)  # a count without unit uses the piece weight
        self.assertEqual(result['missing'], ['Hähnchen', 'Rucola'])
        self.change('set_ingredients', {'items': [{'name': 'Salz', 'ignore': False}]})
        self.assertEqual(self.state['ingredients']['salz'], {'name': 'Salz', 'ignore': False})
        self.assertEqual(nutrition.totals(self.state['recipes'][rid], self.state['ingredients'])['items'][0]['status'],
                         'mapping')
        with self.assertRaises(ValueError):
            self.change('set_ingredients', {'items': [{'name': 'Salz', 'weights': {'tasse': '200'}}]})
        with self.assertRaises(ValueError):
            self.change('set_ingredients', {'items': [{'name': '  '}]})

    def test_save_amounts_updates_only_quantities_and_list(self):
        rid = self.add(ingredient='Feta', quantity='', unit='')
        recipe_before = self.state['recipes'][rid]
        self.plan(rid)
        values = {'kcal': 260, 'protein': 17, 'carbs': 1, 'fat': 21}
        self.change('save_amounts', {'id': rid, 'items': [{'quantity': '1', 'unit': 'stück'}],
                                     'ingredients': [{'name': 'Feta', 'nutrition': {'values': values}}]})
        recipe_after = self.state['recipes'][rid]
        self.assertEqual(recipe_after['ingredients'], [{'name': 'Feta', 'quantity': '1', 'unit': 'stück'}])
        self.assertEqual({k: v for k, v in recipe_after.items() if k != 'ingredients'},
                         {k: v for k, v in recipe_before.items() if k != 'ingredients'})
        self.assertEqual(nutrition.totals(recipe_after, self.state['ingredients'])['total']['kcal'], 520)
        self.assertEqual(model.shopping(self.state, TODAY)[0]['summary'], '1 Stück Feta')
        with self.assertRaises(ValueError):
            self.change('save_amounts', {'id': rid, 'items': []})
        with self.assertRaises(ValueError):
            self.change('save_amounts', {'id': rid, 'items': [{'quantity': '', 'unit': 'g'}]})

    def test_recipe_specific_assignment_wins_until_reset(self):
        rid = self.add(ingredient='Milch', quantity='200', unit='ml')
        own = {'kcal': 50, 'protein': 3, 'carbs': 5, 'fat': 2}
        listed = {'kcal': 70, 'protein': 3, 'carbs': 5, 'fat': 4}
        self.change('set_nutrition', {'id': rid, 'assignments': [{'values': own}]})
        self.change('set_ingredients', {'items': [{'name': 'Milch', 'nutrition': {'values': listed}}]})
        result = nutrition.totals(self.state['recipes'][rid], self.state['ingredients'])
        self.assertEqual((result['total']['kcal'], result['items'][0]['source']), (100, 'recipe'))
        self.change('save_amounts', {'id': rid, 'items': [{'quantity': '200', 'unit': 'ml', 'use_list': True}]})
        result = nutrition.totals(self.state['recipes'][rid], self.state['ingredients'])
        self.assertEqual((result['total']['kcal'], result['items'][0]['source']), (140, 'list'))

    def test_default_weights_match_word_forms(self):
        self.assertEqual(nutrition.default_weights('rote Zwiebeln')['stück'], '80')
        self.assertEqual(nutrition.default_weights('Cherrytomaten')['stück'], '80')
        self.assertEqual(nutrition.default_weights('Hähnchenbrust')['stück'], '150')
        self.assertNotIn('stück', nutrition.default_weights('Brei'))
        self.assertTrue(nutrition.ignored_by_default('Salz und Pfeffer'))
        self.assertTrue(nutrition.ignored_by_default('Taco-Gewürz'))
        self.assertTrue(nutrition.ignored_by_default('Paprikapulver'))
        self.assertFalse(nutrition.ignored_by_default('Kakaopulver'))
        self.assertFalse(nutrition.ignored_by_default('Brühe'))

    def test_suggestions_prefer_raw_basic_foods(self):
        expected = {'Zwiebel': 'Speisezwiebel roh', 'Paprika': 'Gemüsepaprika rot, roh', 'Eier': 'Hühnerei roh',
                    'Hackfleisch': 'Rind/Schwein, Hackfleisch gemischt, roh',
                    'gemischtes Hack': 'Rind/Schwein, Hackfleisch gemischt, roh',
                    'Rinderhackfleisch': 'Rind Hackfleisch, roh', 'Schweinehack': 'Schwein Hackfleisch, roh', 'passierte Tomaten': 'Tomaten passiert/Tomatenpüree',
                    'rote Linsen': 'Linse rot reif', 'Cherrytomaten': 'Tomate roh', 'Schnittlauch': 'Schnittlauch roh',
                    'Ca. 400g Hähnchenbrust': 'Hähnchen Brust, ohne Haut, roh', 'Zucchini': 'Zucchini roh'}
        for query, name in expected.items():
            self.assertEqual(nutrition.candidates(query, {})[0]['name'], name, query)
        unresolved = [name for names in nutrition.ALIASES.values() for name in names
                      if name not in nutrition.codes_by_name()]
        self.assertEqual(unresolved, [])

    def test_cooked_status_persists_without_changing_shopping(self):
        rid = self.add()
        batch = {'date': TODAY, 'slot': 0, 'recipe_id': rid, 'servings': '2', 'cook_servings': '6'}
        target = {'date': '2026-10-16', 'slot': 0, 'servings': '4'}
        self.change('set_meal', {**batch, 'leftover': target})
        original = model.shopping(self.state, TODAY)
        self.change('mark_cooked', {'date': TODAY, 'slot': 0, 'cooked': True})
        self.assertTrue(model.normalize_state(self.state)['plan'][TODAY][0]['cooked'])
        self.assertEqual(model.shopping(self.state, TODAY), original)
        self.change('set_meal', batch)
        self.assertTrue(self.state['plan'][TODAY][0]['cooked'])
        with self.assertRaises(ValueError):
            self.change('mark_cooked', {**target, 'cooked': True})
        self.change('set_meal', {**batch, 'cook_servings': '7'})
        self.assertNotIn('cooked', self.state['plan'][TODAY][0])

    def test_portions_and_compatible_units(self):
        a=self.add(); b=self.add(name='Pfanne',quantity='1',unit='kg',ingredient='HÄHNCHEN')
        self.plan(a,servings=2); self.plan(b,date='2026-10-16')
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'1250 g Hähnchen')

    def test_different_units_stay_separate(self):
        a=self.add(ingredient='Zucker',unit='EL',quantity='2'); b=self.add(ingredient='Zucker',quantity='100')
        self.plan(a);self.plan(b,date='2026-10-16')
        self.assertEqual(len(model.shopping(self.state,TODAY)),2)

    def test_changed_amount_reopens_and_unrelated_change_preserves_check(self):
        a=self.add(); self.plan(a)
        uid=model.shopping(self.state,TODAY)[0]['uid']
        self.change('complete',{'uid':uid,'completed':True})
        self.add(name='Ungeplant')
        self.assertTrue(model.shopping(self.state,TODAY)[0]['completed'])
        self.plan(a,servings=8)
        item=model.shopping(self.state,TODAY)[0]
        self.assertFalse(item['completed']);self.assertNotEqual(item['uid'],uid)
        with self.assertRaises(ValueError): self.change('complete',{'uid':uid,'completed':True})

    def test_repeat_recipe_and_remove_day(self):
        a=self.add();self.plan(a);self.plan(a,date='2026-10-16')
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'1000 g Hähnchen')
        self.change('set_meal',{'date':TODAY,'recipe_id':None})
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'500 g Hähnchen')

    def test_week_boundaries_and_check_reset(self):
        a=self.add();self.plan(a)
        uid=model.shopping(self.state,TODAY)[0]['uid']
        self.change('complete',{'uid':uid,'completed':True})
        self.plan(a,date='2026-10-19')
        self.assertEqual(self.state['shopping_week'],'2026-10-19')
        self.assertEqual(len(model.shopping(self.state,TODAY)),1)
        self.assertFalse(model.shopping(self.state,TODAY)[0]['completed'])
        self.assertEqual(model.monday('2027-01-01'),'2026-12-28')

    def test_delete_guard_and_atomic_input(self):
        a=self.add();self.plan(a)
        original=repr(self.state)
        with self.assertRaises(ValueError):self.change('delete_recipe',{'id':a})
        with self.assertRaises(ValueError):self.plan('nonexistent')
        self.assertEqual(repr(self.state),original)

    def test_recipe_edit_updates_planned_quantities(self):
        a=self.add();self.plan(a)
        data=recipe(quantity='0,75',unit='kg');data['id']=a
        self.change('save_recipe',data)
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'750 g Hähnchen')

    def test_invalid_inputs(self):
        for bad in ['NaN','Infinity','-1','0',True,None, '1e999999']:
            with self.subTest(bad=bad),self.assertRaises(ValueError): model.number(bad)
        for bad in ['2026-02-30','20261015','2026-1-1']:
            with self.subTest(bad=bad),self.assertRaises(ValueError):model.day(bad)
        for bad in [dict(recipe(),steps=''),dict(recipe(),image='https://example.com/photo.jpg'),dict(recipe(),name='')]:
            with self.assertRaises(ValueError):model.validate_recipe(bad)

    def test_decimal_accuracy(self):
        a=self.add(quantity='0,1',unit='kg');self.plan(a,servings=3)
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'75 g Hähnchen')

    def test_empty_plan(self):
        self.assertEqual(model.shopping(self.state,TODAY),[])

    def test_mealprep_counts_cooked_portions_once_and_rejects_overbooking(self):
        rid = self.add()
        self.change('set_meal', {'date':TODAY, 'recipe_id':rid, 'servings':2, 'cook_servings':6})
        self.change('set_meal', {'date':'2026-10-20', 'recipe_id':rid, 'servings':4,
                                 'prepared_from':{'date':TODAY,'slot':0}})
        self.assertEqual([i['summary'] for i in model.shopping(self.state,TODAY)], ['750 g Hähnchen'])
        self.change('shopping_week', {'date':'2026-10-20'})
        self.assertEqual(model.shopping(self.state,TODAY), [])
        with self.assertRaises(ValueError):
            self.change('set_meal', {'date':'2026-10-21','recipe_id':rid,'servings':1,
                                     'prepared_from':{'date':TODAY,'slot':0}})
        with self.assertRaises(ValueError):
            self.change('set_meal', {'date':TODAY,'recipe_id':None})
        self.assertEqual(self.state['plan'][TODAY][0]['cook_servings'], '6')

    def test_cooking_and_leftovers_save_together_without_overwriting(self):
        rid = self.add()
        later = '2026-10-16'
        request = {'date':TODAY,'recipe_id':rid,'servings':2,'cook_servings':6,
                   'leftover':{'date':later,'slot':0,'servings':4}}
        self.plan(rid,date=later)
        before = repr(self.state)
        with self.assertRaisesRegex(ValueError, 'belegt'):
            self.change('set_meal',request)
        self.assertEqual(repr(self.state),before)
        self.change('set_meal',{'date':later,'recipe_id':None})
        with self.assertRaisesRegex(ValueError, 'nicht genug'):
            self.change('set_meal',dict(request,leftover={'date':later,'slot':0,'servings':5}))
        self.assertNotIn(TODAY,self.state['plan'])
        revision = self.state['revision']
        self.change('set_meal',request)
        self.assertEqual(self.state['revision'],revision+1)
        self.assertEqual(self.state['plan'][later][0]['prepared_from'],{'date':TODAY,'slot':0})
        self.assertEqual([i['summary'] for i in model.shopping(self.state,TODAY)],['750 g Hähnchen'])

    def test_manual_amount_is_week_specific_and_keeps_recipe_unchanged(self):
        rid = self.add(quantity=None, unit='', ingredient='Paprika')
        self.plan(rid)
        old = model.shopping(self.state,TODAY)[0]
        self.change('complete', {'uid':old['uid'],'completed':True})
        self.change('shopping_amount', {'key':old['amount_key'],'quantity':'2','unit':'stück'})
        item = model.shopping(self.state,TODAY)[0]
        self.assertEqual(item['summary'], '2 Stück Paprika')
        self.assertFalse(item['completed'])
        self.assertIsNone(self.state['recipes'][rid]['ingredients'][0]['quantity'])
        self.plan(rid, date='2026-10-20')
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'], 'Paprika (Menge offen)')
        self.change('shopping_week', {'date':TODAY})
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'], '2 Stück Paprika')
        self.change('shopping_amount', {'key':old['amount_key'],'quantity':''})
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'], 'Paprika (Menge offen)')

    def test_favorite_survives_recipe_edits(self):
        rid = self.add()
        self.change('favorite', {'id':rid,'favorite':True})
        self.change('save_recipe', dict(recipe(name='Neu'), id=rid))
        self.assertTrue(self.state['recipes'][rid]['favorite'])

    def test_unmeasured_ingredients_are_deduplicated_without_inventing_amounts(self):
        rid = self.add(quantity=None, unit='', ingredient='Paprika')
        self.plan(rid, servings=2)
        self.plan(rid, date='2026-10-16', servings=6)
        self.assertEqual([i['summary'] for i in model.shopping(self.state, TODAY)], ['Paprika (Menge offen)'])
        self.assertEqual(model.validate_recipe(dict(recipe(), ingredients=[], steps=[]))['steps'], [])

    def test_optional_recipe_duration_and_legacy_updates(self):
        rid = self.add()
        self.assertNotIn('minutes', self.state['recipes'][rid])
        self.change('save_recipe', dict(recipe(), id=rid, minutes=25))
        self.change('save_recipe', dict(recipe(), id=rid, image='/local/curry.jpg'))
        self.assertEqual(self.state['recipes'][rid]['minutes'], 25)
        self.assertEqual(self.state['recipes'][rid]['image'], '/local/curry.jpg')
        for minutes in (0, -1, True, 1.5, 1441):
            with self.assertRaises(ValueError):
                self.change('save_recipe', dict(recipe(), id=rid, minutes=minutes))
        self.change('save_recipe', dict(recipe(), id=rid, minutes=None))
        self.assertNotIn('minutes', self.state['recipes'][rid])

    def test_multiple_meals_have_independent_portions_and_aggregate(self):
        a=self.add(); b=self.add(name='Salat',quantity='200',ingredient='Hähnchen')
        self.plan(a,servings=2)
        self.state=model.mutate(self.state,'set_meal',{'date':TODAY,'slot':1,'recipe_id':b,'servings':6},TODAY,2)
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'550 g Hähnchen')
        self.assertEqual(self.state['plan'][TODAY],[{'recipe_id':a,'servings':'2'},{'recipe_id':b,'servings':'6'}])

    def test_remove_one_slot_preserves_other_slots_and_their_positions(self):
        a=self.add();self.plan(a)
        self.state=model.mutate(self.state,'set_meal',{'date':TODAY,'slot':1,'recipe_id':a,'servings':2},TODAY,2)
        self.change('set_meal',{'date':TODAY,'slot':0,'recipe_id':None})
        self.assertIsNone(self.state['plan'][TODAY][0])
        self.assertEqual(self.state['plan'][TODAY][1]['servings'],'2')
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'250 g Hähnchen')
        with self.assertRaises(ValueError):self.change('delete_recipe',{'id':a})
        self.change('set_meal',{'date':TODAY,'slot':1,'recipe_id':None})
        self.assertNotIn(TODAY,self.state['plan'])
        self.change('delete_recipe',{'id':a})

    def test_count_reduction_keeps_all_meals_and_shopping_checks(self):
        a=self.add();self.plan(a)
        self.state=model.mutate(self.state,'set_meal',{'date':TODAY,'slot':5,'recipe_id':a,'servings':4},TODAY,6)
        uid=model.shopping(self.state,TODAY)[0]['uid']
        self.change('complete',{'uid':uid,'completed':True})
        self.assertEqual(len(self.state['plan'][TODAY]),6)
        self.assertTrue(model.shopping(self.state,TODAY)[0]['completed'])
        self.assertEqual(model.shopping(self.state,TODAY)[0]['summary'],'1000 g Hähnchen')
        self.change('set_meal',{'date':TODAY,'slot':5,'recipe_id':None})
        self.assertEqual(len(self.state['plan'][TODAY]),1)

    def test_legacy_plan_upgrade_preserves_checks_revision_and_original(self):
        a=self.add()
        self.state['plan'][TODAY]={'recipe_id':a,'servings':'4'}
        uid=model.shopping(self.state,TODAY)[0]['uid'];self.state['completed']=[uid]
        original=repr(self.state)
        upgraded=model.normalize_state(self.state)
        self.assertEqual(repr(self.state),original)
        self.assertEqual(upgraded['plan'][TODAY],[self.state['plan'][TODAY]])
        self.assertEqual(upgraded['revision'],self.state['revision'])
        self.assertEqual(upgraded,model.normalize_state(upgraded))
        self.assertEqual(model.shopping(upgraded,TODAY),model.shopping(self.state,TODAY))
        self.plan(a,servings=8)
        self.assertEqual(self.state['plan'][TODAY][0]['servings'],'8')

    def test_invalid_slots_are_atomic_and_cannot_create_unconfigured_slots(self):
        a=self.add();self.plan(a);original=repr(self.state)
        for slot in [-1,1,6,True,1.0,'1',None,99999]:
            with self.subTest(slot=slot), self.assertRaises(ValueError):
                self.change('set_meal',{'date':TODAY,'slot':slot,'recipe_id':a,'servings':4})
        self.assertEqual(repr(self.state),original)

    def test_uploaded_and_legacy_images_roundtrip(self):
        for image in ['', '/local/rezepte/curry.jpg', '/api/image/serve/' + 'a1'*16 + '/original']:
            state=model.mutate(self.state,'save_recipe',dict(recipe(),image=image),TODAY)
            stored=next(iter(state['recipes'].values()))
            self.assertEqual(stored['image'],image)
            edited=model.mutate(state,'save_recipe',dict(stored,image=''),TODAY)
            self.assertEqual(edited['recipes'][stored['id']]['image'],'')

    def test_only_native_image_urls_are_accepted(self):
        for image in ['https://example.com/a.jpg','//example.com/a.jpg','blob:photo',
                      'data:image/png;base64,AA', '/api/config', '/api/image/serve/../original',
                      '/api/image/serve/'+'g'*32+'/original', '/api/image/serve/'+'a'*31+'/original',
                      '/api/image/serve/'+'a'*32+'/original?remote=1', None]:
            with self.subTest(image=image), self.assertRaises(ValueError):
                model.validate_recipe(dict(recipe(),image=image))


if __name__=='__main__':unittest.main()
