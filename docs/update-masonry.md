# Update: Mauerwerk-Raster (Masonry) + volle Breite im Bot-Dashboard – Notizen für den Koordinator

## Was (DE, kurz)
- **Volle Breite**: `main` war auf 1240 px begrenzt (bei 1920 px nur 65 % genutzt) → jetzt volle Fensterbreite.
- **Karten nebeneinander im Mauerwerk**: Der Reiter-Inhalt (`#pane`) ist ein Raster (`minmax(560px, 1fr)`): ab ca. 1700 px zwei Spalten, darunter wie bisher eine. Ein kleines eigenes Mauerwerk-Skript (in `dashboard.html`, da die Seite eine einzelne Datei ist; CSP erlaubt Inline) setzt je Karte `grid-row-end: span N` → keine Lücken unter kürzeren Karten. Speichern-Leisten und andere Nicht-Karten gehen über die volle Breite; in „Extras“ steht die Speichern-Leiste jetzt am Ende (vorher zwischen den Karten).
- Server-Kacheln (`.grid`) und Kennzahlen (`.stats`) bleiben gleich hohe Kacheln.

## English changelog text
- **Dashboard:** uses the full window width; on wide screens the settings cards sit side by side in a gap-free masonry layout.

## Geänderte Dateien
- `dashboard.html` (CSS + Skript, Extras: Reihenfolge Speichern-Leiste). Keine neuen UI-Texte. Tests `npm test` 18/18.

## Geprüfte Seiten (Playwright, Attrappen-Discord-API, Testserver „GhostNode“)
42 Ansichten (Serverliste, Start + alle 12 Reiter: Übersicht, Musik, Extras, Willkommen, Levels, Rangliste, Moderation, AutoMod, Rollen & Tickets, Befehle, Giveaways & Umfragen, Sonstiges) × 1366 / 1920 / 420 px.

| Ansicht | Raster | vorher | nachher |
|---|---|---|---|
| start | div.stats | 1366:36 1920:36 420:36 | 1366:36 1920:36 420:36 |
| 📊_Übersicht | div.stats | 1366:36 1920:36 420:36 | 1366:36 1920:36 420:36 |

Karten-Lücken: keine (die einzigen Messwerte sind die Kennzahl-Kacheln `.stats`, bewusst unverändert). Breite: vorher `main` 1240 px (90 % bei 1366, 65 % bei 1920) in allen 28 Desktop-Ansichten → nachher 0 Ansichten unter 95 %.
Screenshots: /tmp/claude-0/-home-user/31e02857-c6ba-52f5-92db-f58542b7414f/scratchpad/masonry/shots/bot-before-1920-start.png ↔ bot-after-1920-start.png, bot-after-1920-__Extras.png u. a.
