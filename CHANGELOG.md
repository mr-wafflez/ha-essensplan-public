# Änderungen

## 0.14.2

- Mengen & Nährwerte: Vollständige Zutaten färben nur noch den Status grün, nicht mehr die ganze Zeile.
- Neue Abbildungen in der README für Wochenplan, Rezeptwahl, Aktionsmenü, Zutatenliste, Mengen-Tabelle und Screenshot-Import; `tools/readme_screenshots.py` erzeugt sie reproduzierbar aus Testrezepten.

## 0.14.1

- **Produkte suchen**: Supermarktprodukte bei Open Food Facts per Suchbegriff finden (nur in Deutschland verkaufte Produkte mit vollständigen Nährwerten). Gesendet wird nur der Suchbegriff; die Auswahl läuft über den geprüften Barcode-Abruf.
- „Hackfleisch“ und „gemischtes Hack“ schlagen jetzt „Rind/Schwein, Hackfleisch gemischt, roh“ vor; Rinder- und Schweinehack werden erkannt.
- Produktwerte von Open Food Facts werden auf zwei Nachkommastellen gerundet.

## 0.14.0

- Neue Zutatenliste **Zutaten & Nährwerte**: Jede Zutat wird einmal zugeordnet und gilt in allen Rezepten. Häufige Zutaten stehen oben, offene Zutaten zeigen einen Vorschlag zum Übernehmen. Alle Vorschläge lassen sich gesammelt übernehmen und prüfen.
- **Mengen & Nährwerte** ersetzt „Nährwerte zuordnen“: kompakte Tabelle mit Menge und Einheit pro Zutat und dem jeweiligen Status (Menge fehlt, nicht zugeordnet, Gewicht fehlt). Ein Speichern übernimmt Mengen und Zuordnungen gemeinsam.
- Gewicht pro Stück, EL, TL, Bund, Dose und Prise sowie die Dichte für ml pro Zutat, mit Startwerten für häufige Zutaten. Mengen ohne Einheit zählen als Stück.
- Bessere BLS-Vorschläge: rohe Grundzutaten vor Fertiggerichten („Zwiebel“ → „Speisezwiebel roh“), Wortformen und zusammengesetzte Wörter, Mengenangaben im Namen werden ignoriert.
- Gewürze, Salz, Pfeffer und Wasser zählen standardmäßig nicht für die Nährwerte.
- Barcode und eigene Werte liegen unter „Eigene Werte oder Barcode“ an der jeweiligen Zutat.

## 0.13.0

- Eine einzige Navigation oben in der Karte (Heute, Woche, Rezepte, Einkauf) auf allen Ansichten, auch auf der Tageskachel. Die doppelten Schaltflächen unter der Tageskachel entfallen.
- Rezeptdetails haben einen Zurück-Button und führen zur Ausgangsansicht zurück. Die Herkunft steht als `from` in der Adresse und bleibt dadurch bei Dashboard-Pfaden erhalten.
- Wochenplan als Tageskacheln statt Formularen: Gericht, Portionen und Status auf einen Blick, Häkchen für „gekocht“ direkt an der Kachel.
- Ein Tipp auf ein Gericht öffnet ein Aktionsmenü (ansehen, Portionen und Mealprep ändern, anderes Rezept, Reste, gekocht, entfernen). Ein Tipp auf einen freien Platz öffnet die Rezeptwahl. Alle Änderungen gelten sofort, ungespeicherte Entwürfe entfallen. Entfernen fragt einmal nach.
- Eine leere Tageskachel öffnet direkt die Rezeptwahl für heute.
- `dashboard.yaml` enthält nur noch eine sichtbare Ansicht. Die übrigen Pfade bleiben als Unterseiten für bestehende Verknüpfungen.

## 0.12.1

- Kamera direkt beim Antippen anfordern und bei fehlender Live-Kamera auf Fotoaufnahme wechseln.

## 0.12.0

- Barcode-Scan per Kamera oder Foto direkt in der Nährwertzuordnung.
- Markenprodukte über Open Food Facts abrufen, lokal speichern und erneut verwenden.

## 0.11.0

- Lokale BLS-Vorschläge für Rezeptzutaten und manuelle Nährwerte.
- Kalorien und Makros pro Gericht und Portion mit Kennzeichnung fehlender Werte.

## 0.10.0

- Grundlage für das optionale Nährwertmodul im Home-Assistant-Optionsdialog.

## 0.9.0

- Lokaler Rezeptimport aus bis zu drei sortierbaren Screenshots.
- Getrennte Korrekturansichten für Zutaten und Zubereitung mit Bildausschnitten.
- Fortsetzungen und identische Überlappungen zusammenführen. Zutaten und Schritte separat oder gemeinsam ergänzen.

## 0.8.0

- Rezeptwahl direkt in freien Wochenplanplätzen mit Suche, Favoriten und Kochverlauf.
- Mealprep zeigt freie Restportionen, bietet einen direkten Einplanungsdialog und unterscheidet geplante von vorbereiteten Resten.
- Lokale Screenshot-Prüfung mit Bildausschnitt und Hinweisen für unsichere Zutatenzeilen.
- GitHub Actions prüft und baut das Installations-ZIP. Die README zeigt drei Beispiele.

## 0.7.2

- Die Kartennavigation kann zwischen echten Home-Assistant-Tabs wechseln.

## 0.7.1

- Kochtag und Restetermin direkt im selben Dialog einplanen und gemeinsam speichern.

## 0.7.0

- Suche nach Rezepten und Zutaten sowie Favoritenfilter.
- Lokaler Screenshot-Import ergänzt vorhandene Rezepte ohne Dubletten.
- Mealprep: Kochmengen und vorbereitete Portionen verknüpfen.
- Offene Einkaufsmengen pro Woche ergänzen.

## 0.6.8

- Screenshot-Import erkennt Zutatenüberschriften mit Symbolen, benannte Gruppen und zusammengefasste Zutaten mit eigenen Mengen.

## 0.6.7

- Screenshot-Import auf Zutaten beschränkt. Unterstützt mehrere Zutatenblöcke und blendet Begleittext aus.

## 0.6.6

- Deutsche Rezept-Screenshots lokal im Browser erkennen und als Entwurf übernehmen.

## 0.6.5

- Zutaten über einzelne Felder für Name, Menge und Einheit eingeben.
- Zeilen hinzufügen und entfernen; Enter wechselt zur nächsten Zutat.

## 0.6.4

- Rezeptkarten unterstützen Zutaten ohne Mengenangabe sowie leere Zutaten- und Zubereitungslisten.
- Die Einkaufsliste führt unbezifferte Zutaten als „Menge offen“.

## 0.6.3

- Lokales Hintergrundmotiv für die ganze Essensplan-Ansicht, auch neben und unter der Karte.

## 0.6.2

- Warme Farbverläufe und eine dezente Kräuterillustration innerhalb der Karte.

## 0.6.1

- Glasoptik mit abgerundeten Karten, Navigationsleiste und schwebenden Aktionsbuttons.

## 0.6.0

- Bildbasierte Rezeptübersicht, Detaildialog, Zubereitungsdauer und direktes Einplanen aus der Rezeptkarte.

## 0.5.0

- Einstellbare Anzahl von Gerichten pro Tag und separate Portionen pro Gericht.

## 0.4.1 und älter

- 0.4.1: Schalter für die Einkaufssynchronisation
- 0.4.0: Einkaufssynchronisation
- 0.3.0: Automatische Einrichtung des Essensplan-Panels
- 0.2.0: Rezeptbilder
