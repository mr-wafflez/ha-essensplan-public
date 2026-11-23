# Essensplan – Arbeitsweise

Dieses Repository ist der Hauptort der Entwicklung. Das private Repository
`ha-essensplan` des Maintainers dient nur noch dazu, große Funktionen zuerst
testweise zu parken; was fertig ist, kommt hierher.

## Ablauf einer Änderung

- Änderungen laufen über einen Pull Request auf `main`. Beim Merge legt der Workflow
  automatisch das Release `v<Version>` an, sofern es für die Version in
  `custom_components/essensplan/manifest.json` noch keines gibt. Für eine neue Version
  die Versionsnummer überall anheben (Manifest, `const.py` und alle `?v=`-Angaben im
  Frontend; `tests/test_frontend.py` prüft das).
- Bei jeder Änderung an Funktionen, Bedienung, Installation oder Verhalten die
  `README.md` und den `CHANGELOG.md` im selben Commit aktualisieren. Dabei die README auf
  veraltete Stellen prüfen (Versionsnummern, Dateinamen, entfernte oder umbenannte
  Bedienelemente, Funktionsliste, Grenzen). Ändert sich die Oberfläche, die Bilder mit
  `python tools/readme_screenshots.py` neu erzeugen und ansehen.
- Vor dem Pull Request alle Prüfungen ausführen: Python-Unittests, Node-Unit-Tests,
  Browser-Test `tests/frontend.cjs` und die Laufzeittests `tests/ha_runtime_*.py` gegen
  ein echtes Home Assistant (siehe README, „Entwicklungsprüfungen“). Ergebnisse und
  nicht Geprüftes gehören in die Beschreibung des Pull Requests.

## Einspielen auf der Home-Assistant-Installation des Maintainers

- Nach einer Änderung das geprüfte Paket in der bestehenden Installation einspielen
  (Marketplace, vom Arbeitsbranch oder vom Release) und die Funktion dort prüfen.
- Vorher die Konfiguration und die Essensplan-Daten sichern und die Sicherung prüfen.
  Die HA-Konfiguration vor einem erforderlichen Neustart validieren.
- Danach den geladenen Integrationseintrag, die ausgelieferte Frontend-Version und die
  Erhaltung von Plänen, Einstellungen und Einkaufsdaten prüfen. Ist ein Schritt
  blockiert, klar sagen, was installiert wurde und was nicht geprüft werden konnte.

## Was nicht ins Repository gehört

Echte Rezepte, Gerätenamen, Netzwerkadressen, Zugangsdaten und Sicherungen. Bilder und
Beispiele verwenden erfundene Testdaten.
