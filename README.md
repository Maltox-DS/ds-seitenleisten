# DS – Seitenleisten & Angriffs-Alarm

Tampermonkey-Skript für **Die Stämme**.

## Funktionen

- **Seitenleisten:** Die Leisten aus der Dorfübersicht (Deine Truppen, Produktion, Bauschleife, Einheiten, Account-Manager) werden auf allen anderen Seiten links und rechts neben dem Spielbereich angezeigt. Jede Leiste lässt sich ein- und ausklappen, Countdowns laufen live weiter.
- **Angriffs-Alarm:** Bei eingehenden Angriffen erscheint unten ein großer roter Balken. Mit ✕ lässt er sich wegklicken und taucht wieder auf, sobald neue Angriffe dazukommen.

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) im Browser installieren.
2. **[Hier klicken zum Installieren](https://github.com/Maltox-DS/ds-seitenleisten/raw/main/ds-seitenleisten.user.js)** und in Tampermonkey auf „Installieren“ klicken.
3. Im Spiel einmal die **Dorfübersicht** öffnen, damit die Leisten gespeichert werden.

Updates kommen automatisch über Tampermonkey.

## Hinweise

- Das Skript schickt **keine zusätzlichen Anfragen** an den Server. Die Leisten zeigen den Stand deines letzten Besuchs der Dorfübersicht (pro Dorf gespeichert).
- Der Angriffs-Balken liest nur den Angriffszähler, den das Spiel ohnehin im Header anzeigt.
- Einstellungen (welche Leiste links/rechts, Breite, Alarm an/aus) stehen oben im Skript im `CONFIG`-Block.
