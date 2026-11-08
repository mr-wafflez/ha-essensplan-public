"""Recipe validation and deterministic shopping aggregation, without HA dependencies."""
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from hashlib import sha256
import re
import unicodedata
from uuid import uuid4

UNITS = {'g': ('g', 1), 'kg': ('g', 1000), 'ml': ('ml', 1), 'l': ('ml', 1000),
         'stück': ('Stück', 1), 'stk': ('Stück', 1), 'el': ('EL', 1), 'tl': ('TL', 1),
         'prise': ('Prise', 1), 'bund': ('Bund', 1), 'dose': ('Dose', 1), '': ('', 1)}


def number(value, minimum=Decimal('0.001'), maximum=Decimal('1000000')):
    try:
        result = Decimal(str(value).replace(',', '.'))
    except (InvalidOperation, ValueError):
        raise ValueError('Ungültige Menge') from None
    if not result.is_finite() or not minimum <= result <= maximum:
        raise ValueError('Menge außerhalb des erlaubten Bereichs')
    return result


def text(value, limit=200):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError('Text fehlt oder ist zu lang')
    return value.strip()


def day(value):
    result = date.fromisoformat(value)
    if result.isoformat() != value:
        raise ValueError('Datum muss YYYY-MM-DD sein')
    return result


def monday(value):
    result = day(value)
    return (result - timedelta(days=result.weekday())).isoformat()


def validate_recipe(raw, recipe_id=None):
    ingredients = raw.get('ingredients', [])
    steps = raw.get('steps', [])
    if not isinstance(ingredients, list) or len(ingredients) > 100:
        raise ValueError('Höchstens 100 Zutaten erlaubt')
    if not isinstance(steps, list) or len(steps) > 100:
        raise ValueError('Höchstens 100 Zubereitungsschritte erlaubt')
    cleaned = []
    for item in ingredients:
        unit = item.get('unit', '')
        if not isinstance(unit, str) or unit.lower().strip() not in UNITS:
            raise ValueError('Einheit: g, kg, ml, l, Stück, EL, TL, Prise, Bund, Dose oder leer')
        quantity = item.get('quantity')
        if quantity is None or quantity == '':
            if unit.strip():
                raise ValueError('Ohne Menge bitte auch die Einheit leer lassen')
            quantity = None
        else:
            quantity = str(number(quantity))
        cleaned.append({'name': text(item.get('name')), 'quantity': quantity,
                        'unit': unit.lower().strip()})
    image = raw.get('image', '')
    if not isinstance(image, str) or len(image) > 500 or (image and not (
        image.startswith('/local/')
        or re.fullmatch(r'/api/image/serve/[0-9a-f]{32}/original', image)
    )):
        raise ValueError('Bitte ein Bild hochladen oder ein vorhandenes lokales Rezeptbild verwenden')
    return {'id': recipe_id or uuid4().hex, 'name': text(raw.get('name')),
            'servings': str(number(raw.get('servings'), maximum=Decimal(100))),
            'ingredients': cleaned, 'steps': [text(s, 4000) for s in steps], 'image': image}


def initial_state():
    return {'recipes': {}, 'plan': {}, 'completed': [], 'shopping_week': '', 'revision': 0}


def meals_for(state, stamp):
    """Read both legacy single meals and ordered slots, retaining empty positions."""
    meals = state['plan'].get(stamp, [])
    return [meals] if isinstance(meals, dict) else meals


def normalize_state(state):
    """Upgrade on a copy; persist with the next successful transaction."""
    result = deepcopy(state)
    result['plan'] = {stamp: deepcopy(meals_for(state, stamp)) for stamp in state['plan']}
    return result


def validate_prepared_meals(plan):
    """A prepared portion must point to an earlier cooking slot with enough food."""
    used = {}
    for stamp, meals in plan.items():
        for slot, meal in enumerate(meals):
            if not meal or 'prepared_from' not in meal:
                continue
            source = meal['prepared_from']
            source_date, source_slot = source['date'], source['slot']
            day(source_date)
            if type(source_slot) is not int or source_slot < 0 or (source_date, source_slot) >= (stamp, slot):
                raise ValueError('Wähle einen früheren Kochtag oder Platz.')
            batch = plan.get(source_date, [])
            cooking = batch[source_slot] if source_slot < len(batch) else None
            if not cooking or 'prepared_from' in cooking or cooking['recipe_id'] != meal['recipe_id']:
                raise ValueError('Der Kochtag gehört zu einem eingeplanten vorbereiteten Gericht.')
            key = source_date, source_slot
            used[key] = used.get(key, Decimal(0)) + Decimal(meal['servings'])
            available = Decimal(cooking.get('cook_servings', cooking['servings'])) - Decimal(cooking['servings'])
            if used[key] > available:
                raise ValueError('Der Kochtag hat nicht genug freie vorbereitete Portionen. Passe die Kochmenge an.')


def shopping(state, today):
    week = state['shopping_week'] or monday(today)
    totals = {}
    unspecified = {}
    with localcontext() as context:
        context.prec = 28
        for stamp in state['plan']:
            if monday(stamp) != week:
                continue
            for meal in meals_for(state, stamp):
                if meal and 'prepared_from' in meal:
                    continue
                recipe = state['recipes'].get(meal['recipe_id']) if meal else None
                if not recipe:
                    continue
                scale = Decimal(meal.get('cook_servings', meal['servings'])) / Decimal(recipe['servings'])
                for item in recipe['ingredients']:
                    name = unicodedata.normalize('NFKC', item['name']).casefold().strip()
                    if item['quantity'] is None:
                        unspecified.setdefault(name, item['name'])
                        continue
                    base, factor = UNITS[item['unit']]
                    key = (name, base)
                    entry = totals.setdefault(key, {'name': item['name'], 'unit': base, 'quantity': Decimal(0)})
                    entry['quantity'] += Decimal(item['quantity']) * factor * scale
    result = []
    for key, item in sorted(totals.items()):
        # Three decimals are enough for household quantities. Identity changes with quantity.
        qty = item['quantity'].quantize(Decimal('0.001')).normalize()
        uid = sha256(f'{week}|{key!r}|{qty:f}'.encode()).hexdigest()[:24]
        display_qty = format(qty, 'f').replace('.', ',')
        summary = f"{display_qty} {item['unit']} {item['name']}".replace('  ', ' ')
        result.append({'uid': uid, 'summary': summary, 'completed': uid in state['completed']})
    for name, display in sorted(unspecified.items()):
        key = sha256(f'{week}|unmeasured|{name}'.encode()).hexdigest()[:24]
        amount = state.get('shopping_amounts', {}).get(key)
        if amount:
            qty = format(Decimal(amount['quantity']).normalize(), 'f')
            unit = UNITS[amount['unit']][0]
            summary = ' '.join(part for part in (qty.replace('.', ','), unit, display) if part)
            uid = sha256(f'{key}|{qty}|{unit}'.encode()).hexdigest()[:24]
        else:
            uid, summary = key, f'{display} (Menge offen)'
        result.append({'uid': uid, 'summary': summary, 'completed': uid in state['completed'],
                       'amount_key': key, 'ingredient': display, 'amount': amount})
    return result


def mutate(state, operation, payload, today, meals_per_day=1):
    """Apply one transaction to a copy. Caller persists before publishing."""
    result = normalize_state(state)
    if operation == 'save_recipe':
        rid = payload.get('id')
        if rid is not None and rid not in result['recipes']:
            raise ValueError('Rezept existiert nicht mehr')
        recipe = validate_recipe(payload, rid)
        minutes = payload.get('minutes', result['recipes'].get(rid, {}).get('minutes'))
        if minutes is not None:
            if type(minutes) is not int or not 1 <= minutes <= 1440:
                raise ValueError('Zubereitungsdauer muss zwischen 1 und 1440 Minuten liegen')
            recipe['minutes'] = minutes
        if result['recipes'].get(rid, {}).get('favorite'):
            recipe['favorite'] = True
        result['recipes'][recipe['id']] = recipe
    elif operation == 'favorite':
        recipe = result['recipes'].get(payload['id'])
        if not recipe or type(payload.get('favorite')) is not bool:
            raise ValueError('Ungültiger Favorit')
        recipe['favorite'] = payload['favorite']
    elif operation == 'delete_recipe':
        rid = payload['id']
        if any(m and m['recipe_id'] == rid for meals in result['plan'].values() for m in meals):
            raise ValueError('Rezept ist noch eingeplant. Bitte zuerst aus dem Plan entfernen.')
        if rid not in result['recipes']:
            raise ValueError('Unbekanntes Rezept')
        del result['recipes'][rid]
    elif operation == 'set_meal':
        stamp = payload['date']
        day(stamp)
        meals = result['plan'].get(stamp, [])
        slot = payload.get('slot', 0)
        # Retain access to occupied slots when the configured count is reduced.
        if type(slot) is not int or not 0 <= slot < max(meals_per_day, len(meals)):
            raise ValueError('Ungültiger Platz für ein Gericht')
        rid = payload.get('recipe_id')
        meal = None
        if rid is not None:
            if rid not in result['recipes']:
                raise ValueError('Unbekanntes Rezept')
            meal = {'recipe_id': rid, 'servings': str(number(payload['servings'], maximum=Decimal(100)))}
            old = meals[slot] if slot < len(meals) else None
            old = old if old and old['recipe_id'] == rid else {}
            prepared = payload.get('prepared_from', old.get('prepared_from'))
            cook = payload.get('cook_servings', old.get('cook_servings'))
            if prepared is not None:
                if not isinstance(prepared, dict) or cook is not None:
                    raise ValueError('Wähle entweder Kochen oder vorbereitete Portionen.')
                meal['prepared_from'] = {'date': prepared['date'], 'slot': prepared['slot']}
            if cook is not None and cook != '':
                quantity = number(cook, minimum=Decimal(meal['servings']), maximum=Decimal(100))
                meal['cook_servings'] = str(quantity)
            if (old.get('cooked') and prepared is None and
                    Decimal(old.get('cook_servings', old['servings'])) ==
                    Decimal(meal.get('cook_servings', meal['servings']))):
                meal['cooked'] = True
        meals.extend([None] * (slot + 1 - len(meals)))
        meals[slot] = meal
        # Trim trailing gaps only; removing lunch must never move dinner.
        while meals and meals[-1] is None:
            meals.pop()
        if meals:
            result['plan'][stamp] = meals
        else:
            result['plan'].pop(stamp, None)
        leftover = payload.get('leftover')
        if leftover is not None:
            if not isinstance(leftover, dict) or not meal or 'prepared_from' in meal:
                raise ValueError('Reste können nur mit einem Kochtag eingeplant werden.')
            leftover_date, leftover_slot = leftover['date'], leftover['slot']
            day(leftover_date)
            if type(leftover_slot) is not int or not 0 <= leftover_slot < meals_per_day:
                raise ValueError('Ungültiger Platz für die Reste.')
            if (leftover_date, leftover_slot) <= (stamp, slot):
                raise ValueError('Plane die Reste nach dem Kochtag ein.')
            target = result['plan'].setdefault(leftover_date, [])
            if leftover_slot < len(target) and target[leftover_slot] is not None:
                raise ValueError('Der Platz für die Reste ist schon belegt. Wähle einen freien Platz.')
            servings = number(leftover['servings'], maximum=Decimal(100))
            target.extend([None] * (leftover_slot + 1 - len(target)))
            target[leftover_slot] = {'recipe_id': rid, 'servings': str(servings),
                                     'prepared_from': {'date': stamp, 'slot': slot}}
        validate_prepared_meals(result['plan'])
        # Editing a week automatically makes it the shopping week.
        result['shopping_week'] = monday(meal['prepared_from']['date'] if meal and 'prepared_from' in meal else stamp)
    elif operation == 'mark_cooked':
        stamp, slot = payload['date'], payload['slot']
        day(stamp)
        meals = result['plan'].get(stamp, [])
        if type(slot) is not int or not 0 <= slot < len(meals):
            raise ValueError('Ungültiger Kochplatz.')
        meal = meals[slot]
        if not meal or 'prepared_from' in meal or type(payload.get('cooked')) is not bool:
            raise ValueError('Nur frisch geplante Gerichte können als gekocht markiert werden.')
        if payload['cooked']:
            if stamp > today:
                raise ValueError('Ein zukünftiger Kochtag kann noch nicht abgehakt werden.')
            meal['cooked'] = True
        else:
            meal.pop('cooked', None)
    elif operation == 'shopping_week':
        result['shopping_week'] = monday(payload['date'])
    elif operation == 'shopping_amount':
        key = payload['key']
        if key not in {i.get('amount_key') for i in shopping(result, today) if i.get('amount_key')}:
            raise ValueError('Einkaufsposition existiert nicht mehr')
        amounts = result.setdefault('shopping_amounts', {})
        if payload.get('quantity') in (None, ''):
            amounts.pop(key, None)
        else:
            unit = payload.get('unit', '').strip().lower()
            if unit not in UNITS:
                raise ValueError('Unbekannte Einheit')
            amounts[key] = {'quantity': str(number(payload['quantity'])), 'unit': unit}
    elif operation == 'complete':
        uid = payload['uid']
        if uid not in {i['uid'] for i in shopping(result, today)}:
            raise ValueError('Einkaufsposition existiert nicht mehr')
        completed = set(result['completed'])
        if payload.get('completed') is True:
            completed.add(uid)
        elif payload.get('completed') is False:
            completed.discard(uid)
        else:
            raise ValueError('completed muss true oder false sein')
        result['completed'] = sorted(completed)
    else:
        raise ValueError('Unbekannte Aktion')
    current_ids = {i['uid'] for i in shopping(result, today)}
    result['completed'] = [uid for uid in result['completed'] if uid in current_ids]
    result['revision'] += 1
    return result
