# Mithelfen

Bitte beschreibe in einem Issue das erwartete und beobachtete Verhalten,
Home-Assistant- und Essensplan-Version und die Schritte zum Nachstellen.
Nutze Testrezepte und anonymisierte Screenshots. Teile keine Zugangsdaten,
Sicherungen oder Dateien aus `.storage`.

Änderungen lassen sich mit folgenden Befehlen prüfen:

```sh
python -m unittest discover -s tests -v
node --test tests/frontend-unit.cjs tests/image-upload-unit.cjs tests/panel-unit.cjs
node --check custom_components/essensplan/frontend/essensplan-card.js
```

Für den Browser-Test Playwright und Chromium installieren, dann
`node tests/frontend.cjs` ausführen. Der Test simuliert die
HA-Schnittstelle; er braucht keine produktive Instanz oder Zugangsdaten.
