// The version a release built by GitHub Actions gets: package.json's version when it is new, or
// else the next patch after the newest release tag. Prints it.
//   node scripts/release-version.js            (reads package.json and `git tag`)
const { execSync } = require('child_process');
const { compare } = require('../src/main/updater');

function nextVersion(pkg, tags) {
  const versions = tags.map((t) => t.trim().replace(/^v/i, '')).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (versions.every((v) => compare(pkg, v) > 0)) return pkg; // newer than every release: use it as it is
  const top = [pkg, ...versions].sort(compare).pop();
  const [a, b, c] = top.split('.').map(Number);
  return `${a}.${b}.${c + 1}`;
}

module.exports = { nextVersion };

if (require.main === module) {
  const pkg = require('../package.json').version;
  const tags = execSync('git tag --list v*', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  process.stdout.write(nextVersion(pkg, tags));
}
