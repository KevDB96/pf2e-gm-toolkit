// Lazy, cached loader for the bundled reference data.

let creaturesPromise = null;

/** Resolves to the creature array, or [] if the data file is missing or malformed. */
export function creatures() {
  if (!creaturesPromise) {
    creaturesPromise = fetch('data/creatures.json')
      .then(r => r.json())
      .then(j => j.creatures || [])
      .catch(err => {
        console.warn('Could not load creature data', err);
        return [];
      });
  }
  return creaturesPromise;
}
