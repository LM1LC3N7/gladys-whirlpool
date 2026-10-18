# Whirlpool 6th Sense pour Gladys Assistant

Affiche dans Gladys les appareils connectés de votre compte **Whirlpool**,
**Maytag** ou **KitchenAid** (applications « 6th Sense Live », Europe ou
États-Unis) : lave-linge, sèche-linge et fours en lecture seule, avec un
déclencheur de scène « Cycle terminé », et les climatiseurs derrière une
option.

> **API non officielle, jamais testée avec un vrai appareil ni un vrai
> compte.** L'intégration parle à l'API des applications, que Whirlpool ne
> documente pas et peut changer à tout moment. Elle a été écrite à partir de
> la bibliothèque whirlpool-sixth-sense (celle de l'intégration Home
> Assistant) et testée seulement avec des réponses inventées. Sans lien avec
> Whirlpool, Maytag ni KitchenAid.

## Ce que vous obtenez

Un appareil Gladys par appareil pris en charge :

| Appareil         | Fonctionnalités Gladys (toutes en lecture seule, sauf mention)                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Lave-linge       | État, Cycle, Phase (détection, remplissage, trempage, lavage, rinçage, essorage), Temps restant (min), Porte     |
| Sèche-linge      | État, Cycle, Phase (détection, vapeur, séchage, refroidissement), Temps restant (min), Porte                     |
| Four             | État du four (veille, préchauffage, cuisson), Température du four (°C), Porte du four ; idem pour le four du bas |
| Climatiseur (\*) | Marche/Arrêt (état), boutons Allumer et Éteindre, Mode, Consigne (16 à 30 °C), Température, Humidité             |

(\*) seulement avec l'option _Afficher les climatiseurs_ (désactivée par
défaut).

- **État** d'un lave-linge ou sèche-linge : en veille, réglage, départ
  différé, en marche, fin de cycle, en pause, terminé, annulé, erreur,
  coupure de courant, mode service, démarrage. La **phase** et le **temps
  restant** n'ont de sens que pendant un cycle (sinon « Aucune » et 0).
- **Porte** : capteur d'ouverture (ouverte / fermée).
- **Température du four** : une sonde, gardée hors de la moyenne de la
  pièce. Quand le four est éteint, Whirlpool envoie 0 : la dernière valeur
  reste affichée.
- Les réfrigérateurs, micro-ondes et appareils des comptes « AWS IoT » (les
  plus récents) ne sont pas encore affichés.

### Aucune commande des lave-linge, sèche-linge ni fours

L'intégration ne démarre, n'arrête ni ne règle **aucun** lave-linge,
sèche-linge ou four : rien n'est envoyé à ces appareils. Un four n'est
**jamais** mis en chauffe depuis Gladys. Aucune fonctionnalité n'est un
interrupteur : un « tout éteindre » de Gladys, d'un assistant vocal ou d'une
scène ne peut rien leur faire.

### Climatiseurs : désactivés par défaut

Avec l'option _Afficher les climatiseurs_, les climatiseurs sont affichés et
commandables : boutons **Allumer** et **Éteindre** (jamais un interrupteur),
**Mode** (6e Sens/auto, froid, **chaud**, ventilation), **Consigne** de 16 à
30 °C. Une valeur hors de ces bornes est refusée sans rien envoyer. Option
désactivée, ils ne sont ni lus ni commandables, et un climatiseur déjà
ajouté refuse les commandes.

## Déclencheur de scène « Cycle terminé »

Dans une scène, choisissez le déclencheur **Cycle de lave-linge ou
sèche-linge terminé**, avec un appareil (ou n'importe lequel) et un type (ou
n'importe lequel). Il part une fois par cycle, quand l'appareil passe d'un
cycle (en marche, fin de cycle, en pause ou différé) à « Terminé ». Variables
pour les actions : nom de l'appareil, type, cycle. Il est vu à la lecture
suivante : jusqu'à l'intervalle de rafraîchissement de retard (60 s par
défaut). Un cycle fini pendant un redémarrage de l'intégration n'est pas
signalé.

## Mise en place

1. Dans Gladys, installez l'intégration **Whirlpool 6th Sense** depuis le
   store.
2. Choisissez la **marque** (l'application que vous utilisez) et la
   **région** (Europe ou États-Unis ; Maytag n'existe qu'aux États-Unis),
   puis l'**e-mail** et le **mot de passe** de l'application. Enregistrez.
3. Ouvrez l'onglet **Découverte** et ajoutez les appareils.

Le champ du mot de passe est un champ `secret` : Gladys le garde dans sa
base (en clair, comme toute valeur de configuration, et dans ses
sauvegardes), ne le réaffiche jamais, et l'intégration ne l'envoie qu'au
cloud Whirlpool (`prod-api.whrcloud.eu` ou `api.whrcloud.com`).

Whirlpool n'envoie aucun code de vérification à la connexion :
l'intégration n'en demande jamais. Après la première connexion, elle
renouvelle sa session avec son jeton de renouvellement, par un minuteur,
avant la fin du jeton (le mot de passe n'est pas renvoyé). Si Whirlpool
refuse ce jeton, l'intégration se reconnecte **une fois** avec le mot de
passe ; refusé, elle s'arrête.

## Rafraîchissement

Chaque appareil est lu toutes les **60 secondes** par défaut (60 à 900,
_Intervalle de rafraîchissement_) : une requête par appareil. La liste des
appareils est relue toutes les 30 minutes (ou après un clic sur
« Rechercher » dans Découverte).

Une commande de climatiseur part tout de suite ; la valeur envoyée
s'affiche aussitôt et n'est pas défaite par une lecture un peu en retard
(20 secondes). Les commandes d'un même appareil passent l'une après l'autre.
Gladys attend 5 secondes : si le cloud est trop lent, la commande est
refusée **avant d'être envoyée**. Une commande restée sans réponse est
signalée « envoyée, sans confirmation » et l'état est relu 5 secondes après.

## En cas de problème

- **E-mail ou mot de passe refusé** : arrêt, même après un redémarrage.
  Vérifiez-les, ainsi que la marque et la région, puis enregistrez (ou
  cliquez sur _Tester la connexion_). Jamais de nouvel essai tout seul, pour
  ne pas verrouiller le compte.
- **Compte verrouillé** (HTTP 423, trop d'essais) : arrêt ; déverrouillez-le
  dans l'application, puis _Tester la connexion_.
- **Session refusée** juste après une nouvelle connexion : pause, puis un
  essai après 1 heure, 6 heures, puis toutes les 24 heures (gardé après un
  redémarrage). _Tester la connexion_ réessaie tout de suite.
- **Trop de requêtes (429)** : pause de 1 minute à 6 heures (le `Retry-After`
  du cloud, 10 minutes sans lui), pour les lectures, les commandes et le
  bouton, gardée après un redémarrage ou une reconnexion à Gladys.
- **Cloud injoignable (5xx, réseau)** : nouveaux essais après 1, 2, 5, 10,
  puis toutes les 15 minutes, jamais plus vite que l'intervalle.
- Un appareil qui ne répond pas, ou hors ligne pour Whirlpool, est marqué
  « injoignable » sur sa carte ; les autres continuent d'être lus.

## Limites

- API non officielle : Whirlpool peut la changer ou la bloquer.
- Pas de mises à jour en direct (le canal websocket des applications) : une
  lecture par intervalle.
- Aucune commande de lave-linge, sèche-linge ni four dans cette version.
- Un seul compte par Gladys.
- Jamais testée avec un vrai appareil ni un vrai compte : merci de signaler
  ce que vous voyez sur le
  [dépôt GitHub](https://github.com/LM1LC3N7/gladys-whirlpool/issues) (sans
  votre e-mail ni mot de passe).

## Vie privée

L'intégration garde dans `/data/whirlpool-state.json` (lisible par son seul
conteneur) : le jeton de renouvellement (le jeton d'accès reste en mémoire)
et l'identifiant de compte, le compte auquel ils appartiennent sous forme
d'empreinte de la marque, de la région et de l'e-mail, la fin d'une pause
429, et un arrêt (identifiants refusés, compte verrouillé, réponse
inattendue, session refusée et son prochain essai) lié à une empreinte
salée du compte et du mot de passe. Ni l'e-mail ni le mot de passe. Rien
n'est envoyé ailleurs qu'au cloud Whirlpool.
