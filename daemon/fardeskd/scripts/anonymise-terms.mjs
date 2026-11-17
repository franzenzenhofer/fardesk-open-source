// The private word lists of the transcript anonymiser. They name real people, hosts and folders, so they never
// live in git: the file is ~/.config/fardesk/anonymise-terms.json (or the path in FARDESK_ANONYMISE_TERMS).
// Shape: { forbiddenSubstrings, neutralProjects, folderPrefixes, commonWords }, each an array of strings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['forbiddenSubstrings', 'neutralProjects', 'folderPrefixes', 'commonWords'];

export function termsPath() {
  return process.env.FARDESK_ANONYMISE_TERMS ?? path.join(os.homedir(), '.config', 'fardesk', 'anonymise-terms.json');
}

export function loadTerms(file = termsPath()) {
  if (!fs.existsSync(file)) {
    throw new Error(`The anonymiser needs its private terms file, and ${file} does not exist. Create it with the keys ${KEYS.join(', ')} (arrays of strings); see daemon/fardeskd/test/fixtures/transcripts/INDEX.md.`);
  }
  const terms = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of KEYS) {
    if (!Array.isArray(terms[key]) || !terms[key].every((x) => typeof x === 'string')) {
      throw new Error(`${file}: "${key}" must be an array of strings`);
    }
  }
  if (terms.neutralProjects.length === 0) throw new Error(`${file}: "neutralProjects" must not be empty`);
  return terms;
}
