# Essensplan für Home Assistant

Eine lokale Custom Integration mit eigener Dashboard-Karte. Kein zusätzlicher Server, kein Cloud-Konto und keine extern geladenen Frontend-Abhängigkeiten. Die Oberfläche übernimmt Farben aus deinem HA-Theme und ist für Maus und Touch gedacht.

## Funktionen

- Rezepte als Karten anlegen, bearbeiten, ansehen und löschen; optional mit lokalem Bild.
- 1 bis 6 Gerichte pro Tag einstellen, jedes mit eigenen Portionen planen und wochenweise blättern.
- Tageskachel: Alle Gerichte des Tages sehen; Tippen/Klicken öffnet das jeweilige Rezept, 600 ms gedrückt halten öffnet den Wochenplan.
- Separate Dashboard-Unterseite für Zutaten und Zubereitung; alternativ innerhalb derselben Karte navigieren.
- Zutaten automatisch zur eigenen nativen HA-To-do-Liste aggregieren und abhaken.
- Tagesgericht als Sensor für andere Karten oder Automationen.
- Lokale Speicherung in Home Assistant, einschließlich Häkchen und Plan; Aktualisierung um lokale Mitternacht.
- Gleichzeitiges Bearbeiten wird durch Revisionen geprüft; fehlgeschlagenes Speichern veröffentlicht keine ungesicherten Änderungen.

Die Integration enthält ihre Dashboard-Karte bereits. Bei einer neuen Einrichtung steht der vollständige Plan direkt als **Essensplan** in der Seitenleiste bereit. Vorhandene Essensplan-Dashboards werden weiterverwendet.

## Rezeptkarten

Die Suche unter **Rezepte** findet Namen und Zutaten. Mit **★ Favorit** markierst
du ein Rezept; **Nur Favoriten** schränkt die Ansicht ein.

Beim Anlegen oder Bearbeiten kannst du **Zutaten aus Screenshot übernehmen** wählen.
Die Texterkennung für deutsche Screenshots läuft auf dem Gerät, auf dem das
Dashboard geöffnet ist. Die Vorschau zeigt nur Zutatenzeilen. Prüfe und
korrigiere bei Bedarf Mengen und Einheiten, bevor du sie übernimmst. Die Vorschau
zeigt, welche Zutaten neu sind und welche bereits vorhanden sind. Du kannst
mehrere Screenshots nacheinander ergänzen. Vorhandene Zutaten, Titel,
Portionen und Zubereitung bleiben unverändert. Verwende einen Ausschnitt mit
der Überschrift „Zutaten“ oder eine eng zugeschnittene Liste.

Die lokale OCR verwendet Tesseract.js 7.0.0, Tesseract.js Core 7.0.0 und
deutsche Sprachdaten aus tessdata_fast 4.1.0. Engine, Sprachdaten und
Lizenztexte liegen im Integrationspaket. Es gibt keinen Upload des Screenshots
und keine externe Verbindung zur Auswertung.

Unter **Rezepte** öffnet das Buchsymbol die Rezeptdetails. Über das Kalendersymbol
oder **Einplanen** im Detaildialog wählst du Datum, Platz und Portionen. Ist ein
Platz belegt, muss das Ersetzen bestätigt werden. Die Einkaufsliste wird wie beim
Speichern im Wochenplan aktualisiert.

Die Zubereitungsdauer ist optional und lässt sich im Rezepteditor ergänzen.
Rezepte ohne Bild oder mit einer nicht mehr erreichbaren Bilddatei verwenden eine
lokale Illustration. Bestehende lokale Bildreferenzen bleiben erhalten.
Der Rezepteditor prüft Format, Dateisignatur, Decodierbarkeit und Größe, bevor er
das Bild über die angemeldete Home-Assistant-Bildverwaltung hochlädt. Die
Dateigrenze kann in der Kartenkonfiguration mit `image_max_mb: 10` geändert werden
(1–20 MB, Standard 20 MB). Das gilt für die betreffende Karte, unabhängig vom
eigenen Uploadlimit der HA-Bildverwaltung.

Zutatenmengen, Zutatenliste und Zubereitung können offenbleiben. Bestehende
Rezepte müssen dafür nicht migriert werden. Eine Übersicht der Änderungen steht
im [Changelog](CHANGELOG.md).

## Installation

1. Entpacke `essensplan-0.7.2.zip` und kopiere **nur den Ordner `custom_components/essensplan`** nach `/config/custom_components/essensplan` in Home Assistant.
2. Starte Home Assistant neu.
3. Öffne **Einstellungen → Geräte & Dienste → Integration hinzufügen → Essensplan** und bestätige die Einrichtung.
4. Öffne **Essensplan** in der Seitenleiste und lege dein erstes Rezept an.

Die Karte wird automatisch geladen. Separate Dateien unter `www`, manuelle Dashboard-Ressourcen und das Kopieren einer Dashboard-Konfiguration sind für die erste Einrichtung nicht nötig. Die Integration ist einmal pro HA-Installation vorgesehen. `/config` bezeichnet den Konfigurationsordner der laufenden HA-Instanz.

Wenn bereits ein Dashboard mit einer Essensplan-Karte vorhanden ist, wird dieses verwendet und kein zusätzlicher Seitenleisteneintrag angelegt. In einem eigenen Dashboard kannst du die Karte über **Karte hinzufügen → Essensplan** auswählen.

### Aktualisierung von einer älteren Version

1. Sichere deine HA-Konfiguration und ersetze `/config/custom_components/essensplan` durch den neuen Ordner.
2. Prüfe die HA-Konfiguration, starte Home Assistant neu und lade das Dashboard  neu.

Rezepte, Bilder, Wochenplan und Einkaufsstatus werden weiterverwendet. Bestehende Dashboard-Konfigurationen bleiben erhalten. Eine bisher manuell eingetragene Ressourcenadresse `/local/essensplan-card.js?...` wird bei Ressourcen im Speichermodus automatisch auf das mitgelieferte Modul umgestellt. Die alte Datei unter `www` wird danach nicht mehr benötigt und kann nach erfolgreicher Prüfung entfernt werden.

Ab 0.5.0 wird ein bisheriges Tagesgericht automatisch als „Gericht 1“ übernommen. Das neue Planformat wird mit der nächsten erfolgreichen Änderung gespeichert. Für eine Rückkehr zu 0.4.x das zuvor erstellte Backup verwenden.

Rezepte mit offenen Mengen benötigen mindestens Version 0.6.4. Für ein Downgrade auf eine ältere Version einen dazu passenden Datenstand aus einer Sicherung verwenden.

Bei YAML-definierten Ressourcen kannst du den bisherigen `essensplan-card.js`-Eintrag aus der Ressourcenliste entfernen: Das Modul lädt nun über die Integration. Die YAML-Datei wird von der Integration nicht bearbeitet.

## Mehrere Gerichte pro Tag

Unter **Einstellungen → Geräte & Dienste → Essensplan → Konfigurieren → Gerichte pro Tag** wählst du **1 bis 6**. Der Standard bleibt ein Gericht. Mit **2** kannst du zum Beispiel mittags einen Salat und abends ein Hauptgericht einplanen. Die Plätze heißen neutral „Gericht 1“, „Gericht 2“ usw.; feste Essenszeiten sind nicht vorgegeben.

Jeder Platz im Wochenplan hat eine eigene Rezeptauswahl, Portionenzahl und Speichern-Schaltfläche. Freie Plätze dürfen leer bleiben. „Noch offen“ entfernt nur das gewählte Gericht. Alle geplanten Gerichte werden für die Einkaufsliste zusammengezählt, auch dasselbe Rezept an mehreren Plätzen oder Tagen. Tageskachel und Rezept-Links berücksichtigen den gewählten Platz.

Wenn du die Anzahl verringerst, bleiben zusätzlich belegte Plätze sichtbar, bearbeitbar und in der Einkaufsliste enthalten, bis du sie ausdrücklich leerst. Ungespeicherte Änderungen an anderen Plätzen bleiben beim Speichern erhalten. Bei einem Bearbeitungskonflikt den Plan mit **Plan neu laden und ungespeicherte Änderungen verwerfen** aktualisieren.

Für **Mealprep** wähle beim Einplanen oder am gespeicherten Wochenplanplatz
**Mealprep**. Beispiel: Für Montag 2 Portionen am Platz und **Insgesamt kochen: 6**
eintragen. **Reste einplanen** zeigt die übrigen 4 Portionen. Wähle im selben
Dialog Mittwoch und einen freien Platz, dann speichere beide Termine gemeinsam.
Du kannst den Restetermin auch offenlassen und später über **Vorbereitet**
eintragen. Die Zutaten zählen für 6 Portionen am Kochtag. Ein Kochtag
kann erst entfernt werden, wenn seine vorbereiteten Portionen gelöst sind.

## Einkaufsliste mit anderen Apps synchronisieren

Unter **Einstellungen → Geräte & Dienste → Essensplan → Konfigurieren** kannst du **Einkaufsliste synchronisieren** ein- oder ausschalten und eine Ziel-Einkaufsliste auswählen. Sie muss Hinzufügen, Ändern und Entfernen von Einträgen unterstützen. Beim Ausschalten bleiben die ausgewählte Liste und ihre Einträge erhalten; zum Fortsetzen reicht erneutes Einschalten. Bei einer neuen Einrichtung ist der Schalter aus. Bereits aktive Verbindungen aus Version 0.4.0 bleiben beim Update eingeschaltet.

Essensplan ergänzt dort seine offenen Zutaten. Abhaken und erneutes Öffnen werden in beide Richtungen abgeglichen. Mengen und benötigte Zutaten kommen weiterhin aus Rezepten und Wochenplan; zusätzliche Einkäufe in der Zielliste bleiben erhalten. Der Abgleich läuft nach Änderungen und spätestens beim nächsten erfolgreichen 30-Sekunden-Durchlauf.

Für **Apple Erinnerungen auf dem iPhone** wird eine normale HA-Liste mit der Erinnerungen-Synchronisation der Companion-App gekoppelt. Die generierte `todo.essensplan_einkaufsliste` darf dafür nicht direkt gekoppelt werden, da sie keine frei hinzugefügten Einträge unterstützt.

Die genaue Einrichtung, Wiederherstellung nach Verbindungsfehlern und die Grenzen des iPhone-Hintergrundabgleichs stehen unter [Einkaufslisten und Apple Erinnerungen](docs/shopping-sync.md). Dafür werden im Essensplan keine Apple-Zugangsdaten gespeichert.

### Automatisches Panel und eigene Dashboards

Das automatisch angelegte Panel öffnet den Wochenplan. Seine Navigation bietet Heute, Wochenplan, Rezepte und Einkauf. Bei einem Entladen oder Entfernen der Integration wird nur dieses automatisch erzeugte Panel entfernt. Benutzerdefinierte Dashboards und Rezeptdaten bleiben erhalten.

Die folgende Dashboard-Konfiguration ist eine optionale Alternative für angepasste Tablet-Ansichten.

## Die Tageskachel in deinem vorhandenen Tablet-Dashboard

```yaml
type: custom:essensplan-card
mode: today
title: Heute auf dem Tisch
detail_path: /essensplan-plan/rezept
week_path: /essensplan-plan/woche
```

Dazu das unten beschriebene eigene Dashboard mit URL `essensplan-plan` erstellen. Wenn du andere Dashboard-/View-Pfade verwendest, die beiden Pfade anpassen. Die ausgewählte Mahlzeit wird als `meal_date=YYYY-MM-DD` und ab dem zweiten Platz zusätzlich mit `meal_slot=1` usw. in der lokalen URL mitgegeben (Zählung ab 0).

Ohne `detail_path` und `week_path` öffnet sich die jeweilige Ansicht direkt in derselben Karte. Die sichtbaren Schaltflächen erlauben die Bedienung auch ohne langes Drücken. Ein eigener Essensplan-Editor im visuellen Karteneditor ist noch nicht enthalten; die Kartenkonfiguration erfolgt per YAML.

## Fertiges Dashboard

Optional: Erstelle unter **Einstellungen → Dashboards → Dashboard hinzufügen** ein leeres eigenes Dashboard, Titel „Essensplan“, URL **essensplan-plan**. Öffne dessen Rohkonfigurationseditor und setze den Inhalt von `dashboard.yaml` ein. Dadurch entstehen die Ansichten Heute, Wochenplan, Rezepte, Einkauf und die Rezept-Detailunterseite.

Das Beispiel ist eine vollständige Dashboard-Konfiguration. Nicht ungeprüft über die Rohkonfiguration deines bestehenden Haupt-Dashboards kopieren.

Der warme Verlauf mit Kräutermotiv wird im automatischen Panel bereits hinter
der Karte angezeigt. In einem bestehenden **eigenen Essensplan-Dashboard** lässt
er sich über die Dashboard-Einstellung **Hintergrund** oder im
Rohkonfigurationseditor ergänzen. Für den Rohkonfigurationseditor nur diesen
Abschnitt auf derselben Ebene wie `views:` ergänzen:

```yaml
background:
  image: /essensplan_static/dashboard-background.svg?v=0.6.3
  opacity: 100
  size: cover
```

Die Grafik wird lokal von der Integration ausgeliefert. Hat eine Ansicht einen
eigenen Hintergrund, hat dieser Vorrang. Die Glaskarten übernehmen weiterhin
die Farben des Home-Assistant-Themes.

Du kannst jede Ansicht auch einzeln nutzen:

```yaml
type: custom:essensplan-card
mode: week
```

Weitere Modi: `today`, `recipes`, `detail`, `shopping`.

In einem Dashboard mit mehreren Ansichten kannst du die Karten über
`view_paths` mit den echten Home-Assistant-Tabs verbinden. Setze dieselben
Pfade in jeder Essensplan-Karte des Dashboards:

```yaml
view_paths:
  today: /essensplan-plan/heute
  week: /essensplan-plan/woche
  detail: /essensplan-plan/rezept
  recipes: /essensplan-plan/rezepte
  shopping: /essensplan-plan/einkauf
```

Damit wechselt auch die ausgewählte Ansicht oben im Dashboard. Einzelkarten
ohne diese Pfade wechseln weiterhin innerhalb der Karte. Bestehende
`detail_path`- und `week_path`-Angaben werden weiter unterstützt.

## Erstes Rezept und erster Wochenplan

1. Öffne „Rezepte“ und drücke „+ Rezept“.
2. Trage Name und Grundportionen ein. Zutaten, Zubereitung, Dauer und Bild kannst du sofort oder später ergänzen.
3. Speichere das Rezept. Unter „Wochenplan“ für jeden gewünschten Platz Gericht und Portionen wählen und jeweils **Speichern** drücken. Die Anzahl der Plätze ist in den Integrationseinstellungen wählbar.
4. Die Einkaufsliste wird bei jedem Speichern automatisch auf die bearbeitete Woche gestellt und neu berechnet. Die Listenüberschrift zeigt den Zeitraum. Wochenweise Blättern allein verändert sie nicht.
5. „Noch offen“ auswählen und speichern entfernt nur das Gericht dieses Platzes.
6. Tageskachel antippen: Zutaten und Zubereitung. Gedrückt halten: Wochenplan.

### Beispiel: Hähnchen-Kokos-Curry, Grundrezept für 4 Portionen

Beispiele für einzelne Zutatenzeilen:

| Zutat | Menge | Einheit |
| --- | --- | --- |
| Hähnchenbrust | 500 | g |
| Kokosmilch | 400 | ml |
| Paprika | 2 | Stück |

Zubereitungsfeld, ein Schritt pro Zeile:

```text
Hähnchen in mundgerechte Stücke schneiden. Paprika würfeln und Frühlingszwiebeln in Ringe schneiden.
Öl in einer großen Pfanne erhitzen und Hähnchen anbraten.
Currypaste und Paprika kurz mitbraten, dann Kokosmilch zugeben.
Sanft köcheln lassen, bis das Hähnchen durchgegart und die Paprika nach Wunsch weich ist. Frühlingszwiebeln zugeben und abschmecken.
```

Menge und Einheit werden für die Einkaufsliste verwendet. Dezimalzeichen: Komma oder Punkt. Erlaubte Einheiten: `g`, `kg`, `ml`, `l`, `Stück` (auch `stk`), `EL`, `TL`, `Prise`, `Bund`, `Dose` oder leer. Bei leerer Einheit trotzdem beide Semikolons verwenden, z. B. `1 ; ; Salz nach Bedarf`.

Ist die Menge unbekannt, gib nur den Zutatennamen ein und lasse Menge und Einheit leer.
Das Rezept zeigt dann nur den Zutatennamen. Beim Einplanen erscheint
„Paprika (Menge offen)“ auf der Einkaufsliste.

Ein Rezeptbild kann direkt im Editor mit **Bild auswählen** hinzugefügt werden. Die Vorschau erscheint sofort; hochgeladen wird es erst mit **Rezept speichern**. **Bild entfernen** entfernt die Bildzuordnung beim nächsten Speichern. Abbrechen verwirft eine neu ausgewählte Datei ohne Upload. Vorhandene `/local/`-Bilder bleiben beim Bearbeiten erhalten.

Unterstützt werden JPEG, PNG, WebP und GIF bis 20 MB. Das Bild wird im Browser auf höchstens 1600 Pixel Kantenlänge verkleinert und als JPEG ohne ursprüngliche Dateimetadaten an die native, angemeldete HA-Bildverwaltung gesendet. Transparente Bereiche werden weiß, bei GIF wird ein Einzelbild verwendet. HEIC-Dateien gegebenenfalls vorher als JPEG exportieren. Die Bildverwaltung ist eine Abhängigkeit der Integration; kein eigener Upload-Server und kein manuell eingetragener Bildpfad sind nötig.

Wie andere native HA-Bilder ist ein hochgeladenes Rezeptbild über seine zufällige Bildadresse ohne zusätzliche Anmeldung abrufbar. Beim Ersetzen oder Entfernen einer Zuordnung wird die alte Bilddatei nicht automatisch aus der HA-Bildverwaltung gelöscht, da sie in anderen Rezepten oder Dashboards verwendet werden könnte.

## Regeln der Einkaufsliste

- Namen werden ohne Groß-/Kleinschreibung und mit Unicode-Normalisierung verglichen. „Paprika“ und „paprika“ passen zusammen, „rote Paprika“ und „Paprika“ bleiben getrennt.
- `kg` und `g` werden zu Gramm, `l` und `ml` zu Millilitern umgerechnet. EL, TL, Stück, Bund usw. bleiben getrennt. Keine Schätzung von Stückgewicht oder Dosenfüllmenge.
- Mengen werden anhand von geplanten Portionen / Grundportionen skaliert und mit maximal drei Nachkommastellen angezeigt.
- Zutaten ohne Mengenangabe erscheinen pro Zutat und Einkaufswoche einmal als „Menge offen“. Sie bleiben von bezifferten Mengen derselben Zutat getrennt.
- Über **Menge ergänzen** kannst du im Essensplan die offene Menge für diese Einkaufswoche eintragen. Das Rezept bleibt unverändert. Eine leere Menge setzt den Eintrag zurück.
- Unveränderte Positionen derselben Einkaufswoche behalten ihren Haken. Ändert sich die Gesamtmenge, wird die Position erneut offen.
- Beim Wechsel der Einkaufswoche werden die Haken zurückgesetzt. Alte Wochen behalten keine getrennte Einkaufs-Historie.
- Nach einer Planänderung bezieht sich die Liste auf genau diese Woche. „Einkaufsliste für diese Woche anzeigen“ wählt eine Woche ohne Planänderung ausdrücklich aus.
- Die Liste enthält alle geplanten Tage der gewählten Woche, auch bereits vergangene Tage. Es wird nicht aus einer Vorratsliste abgezogen.
- Die generierte Liste erlaubt nur Abhaken, keine freie Bearbeitung von Text, Menge, Reihenfolge oder zusätzlichen Einträgen. Weitere Haushaltsartikel in einer separaten Einkaufsliste führen.

### Native Home-Assistant-Karte

Die Integration legt zusätzlich eine To-do-Entität an. Ihr Standardname ist normalerweise `todo.essensplan_einkaufsliste`; den tatsächlichen Namen unter **Einstellungen → Geräte & Dienste → Entitäten** prüfen.

```yaml
type: todo-list
entity: todo.essensplan_einkaufsliste
title: Einkauf für den Essensplan
```

Der Tagesgericht-Sensor heißt normalerweise `sensor.essensplan_heute`. Sein Zustand enthält die Namen aller Tagesgerichte. Das Attribut `meals` enthält pro geplantem Gericht `slot` (ab 0), `recipe_id`, `name` und `servings`; `meals_per_day` gibt die Einstellung an. Die bisherigen Attribute `recipe_id` und `servings` beziehen sich weiter auf das erste belegte Gericht. Umbenannte bzw. schon vergebene Entitäts-IDs können abweichen. Die eigene Karte findet den zugehörigen Sensor anhand seiner Attribute.

## Daten, Backup und Berechtigungen

Rezepte, Plan und Einkaufsstatus liegen im HA-Konfigurationsordner unter `.storage/essensplan`. Vollständige HA-Backups mit dem Konfigurationsordner verwenden. Die Datei nicht im laufenden Betrieb von Hand bearbeiten. Ein Entfernen und erneutes Hinzufügen der Integration löscht die Rezeptdatei nicht absichtlich.

Alle angemeldeten HA-Nutzer können diese gemeinsame Haushaltssammlung über die API lesen und bearbeiten. Eine ausgeblendete Dashboard-Schaltfläche ist keine Berechtigungssperre. Keine eigenen Tokens, externen Benutzerkonten oder externen Rezeptdienste erforderlich.

Die Karte lädt Daten über die angemeldete HA-WebSocket-Verbindung. Sensoränderungen und ein zusätzlicher 60-Sekunden-Abruf aktualisieren andere Karten. Während der Rezeptbearbeitung wird der ungespeicherte Text nicht durch Hintergrundabrufe ersetzt; ein inzwischen geänderter Datenstand verhindert das Überschreiben beim Speichern. Dann abbrechen, Daten neu öffnen und Änderungen übernehmen.

## Grenzen und nächste sinnvolle Erweiterungen

Noch nicht enthalten: benannte Frühstück-/Mittag-/Abendplätze, Drag & Drop, Import von Rezept-Webseiten, Vorratsverwaltung, automatische Synonym-Erkennung, Tags, Nährwertberechnung und individuelle Nutzerrechte. Mengen im freien Zubereitungstext werden beim Skalieren nicht umgeschrieben.

Das Layout reagiert auf schmale Displays. Ein vollständiger Wochenplan oder langes Rezept kann scrollen; die Tageskachel ist die kompakte Variante für dein Tablet-Dashboard. 

## Entwicklungsprüfungen

```sh
python -m unittest discover -s tests -v
node --test tests/frontend-unit.cjs tests/image-upload-unit.cjs tests/panel-unit.cjs
node --check custom_components/essensplan/frontend/essensplan-card.js
```

`tests/frontend.cjs` enthält einen Browser-Smoke-Test über Playwright mit simulierter HA-WebSocket-Grenze. Er benötigt Playwright und dessen Chromium. Im Codex-Runtime kann er `CODEX_PRIMARY_RUNTIME_NODE_MODULES` verwenden, andernfalls löst er Playwright aus lokal installierten Node-Modulen auf. Ausführen mit `node tests/frontend.cjs`.

Zum Bauen des Installationsarchivs: `python tools/build_release.py`.

### Mithelfen

Fehler und Vorschläge bitte über [GitHub Issues](https://github.com/mr-wafflez/ha-essensplan-public/issues) melden. Hinweise zu Tests und vertraulichen Daten stehen in [CONTRIBUTING.md](CONTRIBUTING.md).

Essensplan steht unter [Apache 2.0](LICENSE). Hinweise zu mitgelieferter Software stehen in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Technische Grundlagen

- [Eigene Dashboard-Karten](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/)
- [WebSocket-Erweiterungen](https://developers.home-assistant.io/docs/frontend/extending/websocket-api/)
- [To-do-Entitäten](https://developers.home-assistant.io/docs/core/entity/todo/)
- [Config Flow](https://developers.home-assistant.io/docs/core/integration/config_flow/)
