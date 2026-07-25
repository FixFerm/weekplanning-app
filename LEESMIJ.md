# weekplanning-site

Dit is de telefoon-versie van de weekplanning: alleen het programma, geen gegevens van
Erik. Zet deze map met GitHub Desktop in een GitHub-map en koppel hem aan Vercel
(zelfde werkwijze als `onderweg-site`). Er is niets te bouwen: het zijn gewone
bestanden.

Bijwerken na een verandering in de app: opnieuw kopiëren met

    rm -rf weekplanning-site && cp -R weekplanning-app/web weekplanning-site

en daarna vercel.json, version.txt en dit bestand er weer bij zetten (of het scriptje
`weekplanning-app/maak-site.sh` gebruiken).

Controleren of de nieuwe versie is aangekomen: open `<adres>/version.txt`.
