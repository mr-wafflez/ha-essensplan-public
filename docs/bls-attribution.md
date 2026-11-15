# Quelle der Nährwertdaten

Max Rubner-Institut (2025), Bundeslebensmittelschlüssel (BLS), Version 4.0,
Deutsche Nährstoffdatenbank, Karlsruhe, DOI [10.25826/Data20251217-134202-0](https://doi.org/10.25826/Data20251217-134202-0).

Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
[Originaldaten und Dokumentation](https://blsdb.de/download).

Essensplan übernimmt BLS-Code, deutsche Bezeichnung, Energie in kcal,
Protein (Nx6,25), verfügbare Kohlenhydrate und Fett pro 100 g. Der Auszug
enthält Zeilen mit vollständigen numerischen Werten für diese vier Felder.
Essensplan bereitet das Format für die lokale Suche auf und ergänzt eigene
Suchregeln. Änderungen betreffen Auswahl und Format der Daten.

Mit dem Original-ZIP lässt sich der Auszug über `python tools/import_bls.py <ZIP>`
reproduzieren. Dafür wird OpenPyXL benötigt.
