// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, command errors, feature
// names, state labels), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts?.[language] ?? texts?.en;

const both = (en, fr) => ({ en, fr });

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  state: both('State', 'État'),
  cycle: both('Cycle', 'Cycle'),
  phase: both('Phase', 'Phase'),
  remaining: both('Time remaining', 'Temps restant'),
  door: both('Door', 'Porte'),
  upperState: both('Oven state', 'État du four'),
  upperTemperature: both('Oven temperature', 'Température du four'),
  upperDoor: both('Oven door', 'Porte du four'),
  lowerState: both('Lower oven state', 'État du four du bas'),
  lowerTemperature: both('Lower oven temperature', 'Température du four du bas'),
  lowerDoor: both('Lower oven door', 'Porte du four du bas'),
  power: both('On/Off (state)', 'Marche/Arrêt (état)'),
  powerOn: both('Turn on', 'Allumer'),
  powerOff: both('Turn off', 'Éteindre'),
  mode: both('Mode', 'Mode'),
  target: both('Setpoint', 'Consigne'),
  temperature: both('Temperature', 'Température'),
  humidity: both('Humidity', 'Humidité'),
};

/** Labels of the text/select states. */
export const STATE_LABELS = {
  standby: both('Standby', 'En veille'),
  setting: both('Setting up', 'Réglage'),
  delayed: both('Delayed start', 'Départ différé'),
  running: both('Running', 'En marche'),
  finishing: both('Finishing', 'Fin de cycle'),
  paused: both('Paused', 'En pause'),
  complete: both('Complete', 'Terminé'),
  cancelled: both('Cancelled', 'Annulé'),
  error: both('Error', 'Erreur'),
  power_failure: both('Power failure', 'Coupure de courant'),
  service: both('Service mode', 'Mode service'),
  starting: both('Starting', 'Démarrage'),
  unknown: both('Unknown', 'Inconnu'),
  preheating: both('Preheating', 'Préchauffage'),
  cooking: both('Cooking', 'Cuisson'),
};

export const PHASE_LABELS = {
  none: both('None', 'Aucune'),
  sensing: both('Sensing', 'Détection'),
  filling: both('Filling', 'Remplissage'),
  soaking: both('Soaking', 'Trempage'),
  washing: both('Washing', 'Lavage'),
  rinsing: both('Rinsing', 'Rinçage'),
  spinning: both('Spinning', 'Essorage'),
  steaming: both('Steaming', 'Vapeur'),
  drying: both('Drying', 'Séchage'),
  cooling: both('Cooling down', 'Refroidissement'),
};

export const CYCLE_LABELS = {
  regular: both('Regular', 'Normal'),
  heavy_duty: both('Heavy duty', 'Intensif'),
  denim: both('Denim', 'Jean'),
  delicates: both('Delicates', 'Délicat'),
  wrinkle_control: both('Wrinkle control', 'Anti-froissage'),
  bulky_items: both('Bulky items', 'Volumineux'),
  quick_dry: both('Quick dry', 'Séchage rapide'),
  sanitize: both('Sanitize', 'Hygiène'),
  steam_refresh: both('Steam refresh', 'Rafraîchir à la vapeur'),
  timed_dry: both('Timed dry', 'Séchage minuté'),
  colors_brights: both('Colors', 'Couleurs'),
  towels: both('Towels', 'Serviettes'),
  whites: both('Whites', 'Blanc'),
  normal: both('Normal', 'Normal'),
  number: (n) => both(`Cycle ${n}`, `Cycle ${n}`),
};

export const KIND_LABELS = {
  washer: both('washer', 'lave-linge'),
  dryer: both('dryer', 'sèche-linge'),
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

export const T = {
  noCredentials: both(
    'Enter the e-mail and the password of your account (the ones of the Whirlpool, Maytag or KitchenAid app).',
    "Saisissez l'e-mail et le mot de passe de votre compte (ceux de l'application Whirlpool, Maytag ou KitchenAid).",
  ),
  noClient: both(
    'Maytag has no app in Europe: choose the "United States" region, or another brand.',
    "Maytag n'a pas d'application en Europe : choisissez la région « États-Unis » ou une autre marque.",
  ),
  connecting: both('Signing in to the Whirlpool cloud…', 'Connexion au cloud Whirlpool…'),
  connected: (count, supported) =>
    both(
      `Connected: ${supported} appliance(s) Gladys can show (out of ${count}). Open Discovery to add them.`,
      `Connecté : ${supported} appareil(s) que Gladys peut afficher (sur ${count}). Ouvrez Découverte pour les ajouter.`,
    ),
  refused: both(
    'The e-mail or the password was refused: check them, and the brand and region, in the configuration. The integration waits for a change (or the test button).',
    "L'e-mail ou le mot de passe a été refusé : vérifiez-les, ainsi que la marque et la région, dans la configuration. L'intégration attend une modification (ou le bouton de test).",
  ),
  locked: both(
    'The account is locked (too many sign-in attempts). Unlock it in the app, then click "Test the connection". The integration does not try again by itself.',
    "Le compte est verrouillé (trop d'essais de connexion). Déverrouillez-le dans l'application, puis cliquez sur « Tester la connexion ». L'intégration ne réessaie pas d'elle-même.",
  ),
  loginRejected: both(
    'The sign-in gave an unexpected answer: the integration may need an update. It waits for the test button.',
    "La connexion a donné une réponse inattendue : l'intégration a peut-être besoin d'une mise à jour. Elle attend le bouton de test.",
  ),
  sessionRefused: (wait) =>
    both(
      `The session was refused again right after a new sign-in. Next try in ${wait.en} (or click "Test the connection").`,
      `La session a encore été refusée juste après une nouvelle connexion. Prochain essai dans ${wait.fr} (ou cliquez sur « Tester la connexion »).`,
    ),
  rateLimited: (wait) =>
    both(`Too many requests: paused for ${wait.en}.`, `Trop de requêtes : pause de ${wait.fr}.`),
  unreachable: (reason, wait) =>
    both(
      `The Whirlpool cloud cannot be reached (${reason}). Next try in ${wait.en}.`,
      `Le cloud Whirlpool est injoignable (${reason}). Prochain essai dans ${wait.fr}.`,
    ),
  busy: both(
    'A read is in progress, try again in a few seconds.',
    'Une lecture est en cours, réessayez dans quelques secondes.',
  ),
  test: {
    cooldown: both('Tested less than 30 seconds ago.', 'Testé il y a moins de 30 secondes.'),
  },
};

/** Command errors, shown by Gladys under the device. */
export const COMMAND = {
  unknown: 'This feature cannot be commanded.',
  refused: 'Value refused: not one this appliance accepts.',
  pressOnly: 'This is a button: only the value 1 (press) is accepted.',
  airconOff:
    'Air conditioners are off in the configuration ("Show the air conditioners"): nothing was sent.',
  blocked: 'Not connected to the Whirlpool cloud: nothing was sent. See the integration status.',
  paused: 'The integration is paused (too many requests): nothing was sent.',
  late: 'The Whirlpool cloud is too slow right now: nothing was sent, try again.',
  offline: 'The appliance is offline for the Whirlpool cloud: nothing was sent.',
  unconfirmed:
    'Sent, without confirmation from the Whirlpool cloud: check the state in a few seconds.',
};
