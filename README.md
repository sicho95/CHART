# CHART

**Chronology & History of Alerts, Reporting and Tracking**

CHART est une PWA offline-first de suivi d'incidents projet/application. Elle permet de déclarer un incident, historiser les événements, figer des points intermédiaires, suivre les décisions, clôturer avec rapport et consulter une timeline globale.

## Fonctionnalités V1

- Gestion multi-projets et contacts projet
- Déclaration rapide d'incident
- Fiche incident avec timeline chronologique
- Points intermédiaires brouillon / figé
- Clôture avec rapport imprimable
- Timeline globale avec filtres et indicateurs
- Import / export JSON complet
- Pièces jointes locales dans IndexedDB
- PWA statique avec cache offline
- Thème clair / sombre

## Lancement local

```bash
python3 -m http.server 4174 --bind 127.0.0.1
```

Puis ouvrir `http://127.0.0.1:4174/`.

## Stockage

- IndexedDB: données métier, rapports et pièces jointes
- localStorage: préférences et état d'interface
- Cache Storage: shell applicatif PWA
