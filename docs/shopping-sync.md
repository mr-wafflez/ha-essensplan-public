# Einkaufslisten und Apple Erinnerungen

## Was synchronisiert wird

- Die offene Zutatenliste der im Essensplan ausgewählten Einkaufswoche wird in eine ausgewählte HA-To-do-Liste übertragen.
- Häkchen und erneutes Öffnen werden in beide Richtungen synchronisiert.
- Rezept- und Mengenänderungen ersetzen nur die von Essensplan erzeugten Einträge. Weitere Einkäufe werden weder geändert noch gelöscht. Gleichnamige vorhandene Einträge werden nicht automatisch übernommen.
- Nachträgliche Notizen und Fälligkeitsdaten an bereits gekoppelten Einträgen werden vom Essensplan nicht überschrieben.
- Mengen und Namen erzeugter Zutaten werden im Rezept bzw. Wochenplan geändert. Änderungen nur an diesen Titeln in der externen Liste werden wieder an den Essensplan angepasst.
- Wird eine weiterhin benötigte offene Zutat extern gelöscht, wird sie wieder angelegt. Dauerhaft entfernt wird sie durch eine Änderung des Rezeptes/Plans. Extern gelöschte erledigte Historie wird nicht wieder angelegt.

Die Zielliste muss `todo.add_item`, `todo.update_item`, `todo.remove_item` und `todo.get_items` unterstützen. Lokale To-do-Listen sind geeignet; andere Anbieter hängen von ihrer HA-Integration ab. Der Abgleich verwendet Eintrags-IDs und führt keine globale Löschung erledigter Einträge aus.

## Home Assistant einrichten

1. Lege über **Einstellungen → Geräte & Dienste → Integration hinzufügen → Lokale To-do-Liste** eine Liste an, beispielsweise **Essensplan & Einkauf**. Alternativ verwende eine vorhandene beschreibbare Liste.
2. Öffne **Einstellungen → Geräte & Dienste → Essensplan → Konfigurieren**, aktiviere **Einkaufsliste synchronisieren** und wähle diese Zielliste.
3. Speichere die Auswahl. Die Integration wird neu geladen; der gesamte HA-Server muss dafür nicht neu gestartet werden.
4. Prüfe die Zielliste und den Diagnosesensor **Essensplan Synchronisation**.

Die generierte **Essensplan Einkaufsliste** unterstützt bewusst weiterhin nur das Abhaken. Sie ist Quelle des Abgleichs und wird nicht als Ziel ausgewählt.

Der Abgleich reagiert auf Änderungen und prüft die Zielliste zusätzlich alle 30 Sekunden. Bei nicht erreichbaren Listen bleibt der lokale Essensplan benutzbar. Im Status steht dann `error`; beim nächsten erfolgreichen Durchlauf geht er auf `idle` zurück. `disabled` bedeutet: Abgleich ausgeschaltet oder kein Ziel konfiguriert. Das Diagnoseattribut `enabled` zeigt die Schalterstellung.

## Apple Erinnerungen auf dem iPhone

Die aktuelle HA-iOS-App enthält die Funktion **Reminders Sync / Erinnerungen synchronisieren**. Die Verfügbarkeit im installierten App-Build muss auf dem iPhone geprüft werden; experimentelle Funktionen können unter **Labs** liegen. Ein in der Quellcode-Hauptversion vorhandenes Feature bedeutet nicht automatisch, dass es in jeder App-Store-Version verfügbar ist.

1. Lege zum ersten Test auch in **Apple Erinnerungen** eine neue leere Liste an, beispielsweise **Essensplan & Einkauf**. Die oben angelegte HA-Liste und die Apple-Liste werden anschließend miteinander gekoppelt.
2. Öffne die Einstellungen der **Home-Assistant-App auf dem iPhone**, suche nach **Reminders Sync / Erinnerungen synchronisieren** und erlaube den benötigten Zugriff auf Erinnerungen. Diese Freigabe erfolgt auf dem iPhone; Essensplan selbst erhält keine Apple-Kontodaten.
3. Füge eine Kopplung hinzu und wähle die normale **HA-Zielliste** sowie die leere **Apple-Testliste**. Fehlt die neu angelegte HA-Liste, aktualisiere im Auswahlformular die Serverdaten über das Kreispfeil-Symbol und warte, bis die Liste erscheint.
4. Wähle **Beide Richtungen / Two-way**. Nur in Richtung Apple würde das Abhaken auf dem iPhone nicht zurückkommen.
5. Speichere die Kopplung; dadurch startet der erste Abgleich. Warte, bis die Zutaten in Apple Erinnerungen erscheinen. Bei Bedarf verwende **Jetzt synchronisieren** in der HA-App.
6. Prüfe mit einer Zutat: in Erinnerungen abhaken → in Essensplan erledigt; in Essensplan wieder öffnen → in Erinnerungen offen. Öffne für beide Schritte die HA-App und synchronisiere. Eine kurze Verzögerung allein bedeutet noch keinen Fehler.

Nur ein iPhone sollte dieselbe Listenpaarung verwalten. Nicht gleichzeitig weitere Kurzbefehle, eigene iCloud-Brücken oder eine zweite identische Kopplung aktivieren.

**Zeitverhalten:** Der iPhone-Teil läuft bei aktiver App, bei erkannten Erinnerungen-Änderungen und gegebenenfalls durch die Hintergrundaktualisierung. iOS entscheidet über deren Ausführung; eine feste Echtzeit-Synchronisation bei geschlossener App ist nicht garantiert. Zum gezielten Prüfen die HA-App öffnen und dort synchronisieren.

Ist die Funktion in deiner App nicht vorhanden, ist der HA-Teil trotzdem nutzbar. Dann muss zunächst die verfügbare Companion-Version bzw. eine separate Erinnerungen-Anbindung geklärt werden; diese Integration installiert oder aktiviert keine fremde iCloud-Erweiterung.

## Neustarts, Ausfälle und Abschalten

Zuordnungen zu erzeugten Einträgen werden getrennt von Rezepten gespeichert. Ein Neustart überträgt bestehende Zutaten dadurch nicht erneut. Listenwechsel behält die Zuordnungen der vorherigen Liste; andere Listen werden währenddessen nicht bearbeitet.

Vor dem Anlegen einer Zutat wird eine Übertragungsabsicht gespeichert. Wird eine Antwort unterbrochen, versucht der nächste Durchlauf den bereits erzeugten Eintrag zu erkennen. Unterstützt die Liste Notizen/Beschreibungen, wird dafür zusätzlich eine Quellenkennung in der Beschreibung verwendet. Diese Kennung enthält keine Zugangsdaten. Zusätzliche Einträge werden nie allein anhand eines gleichen Namens übernommen.

Bleibt unklar, ob eine Übertragung stattgefunden hat (`unconfirmed_addition`), oder sind mehrere Kandidaten vorhanden (`ambiguous_addition`), stoppt der Abgleich weitere Ergänzungen, statt blind Duplikate zu erzeugen. Die Liste muss in diesem Fall geprüft werden.

Über **Werkzeuge → Aktionen → Essensplan: Einkaufsliste synchronisieren** (`essensplan.sync_shopping_list`) kann jederzeit ein Abgleich angefordert werden. Nur wenn bei `unconfirmed_addition` geprüft wurde, dass die fehlende Zutat wirklich nicht in der Zielliste steht, darf **Unbestätigte Übertragung erneut senden** eingeschaltet werden. Der Abgleich sucht zuerst noch einmal nach dem vorhandenen Eintrag; mehrere Kandidaten werden auch dann nicht automatisch übernommen. Bei verzögert sichtbaren Cloud-Einträgen bleibt ein Duplikat-Risiko, daher erfolgt diese Wiederholung nur ausdrücklich.

Zum Abschalten unter **Essensplan → Konfigurieren** den Schalter **Einkaufsliste synchronisieren** ausschalten und speichern. Die Zielliste bleibt ausgewählt; vorhandene Einträge und ihre dauerhaften Zuordnungen bleiben erhalten. Auch ein manuell angeforderter Essensplan-Abgleich bleibt dann ausgeschaltet. Zum Fortsetzen denselben Schalter wieder einschalten und speichern. Ohne Zielliste lässt sich der Abgleich nicht einschalten. Bereits aktive Verbindungen aus Version 0.4.0 bleiben beim Update eingeschaltet; neue Einrichtungen beginnen ausgeschaltet.

Der Schalter steuert den Abgleich zwischen Essensplan und der HA-Zielliste. Eine Kopplung zwischen HA und Apple Erinnerungen wird separat in der iPhone-App verwaltet.

## Quellen zur Apple-Verbindung

- [HA-iOS: Konfiguration einer Listenpaarung](https://github.com/home-assistant/iOS/blob/main/Sources/App/Utilities/RemindersSync/RemindersSyncAddViewModel.swift)
- [HA-iOS: Synchronisationsablauf](https://github.com/home-assistant/iOS/blob/main/Sources/App/Utilities/RemindersSync/RemindersSyncManager.swift)
- [HA-iOS: Hintergrundaktualisierung](https://github.com/home-assistant/iOS/blob/main/Sources/App/Utilities/RemindersSync/RemindersSyncBackgroundRefresher.swift)
- [Home Assistant To-do](https://www.home-assistant.io/integrations/todo/)
