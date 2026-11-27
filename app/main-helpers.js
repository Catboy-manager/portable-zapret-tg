function shouldElevate(isAdmin, argv) {
  if (isAdmin) return false;
  return !argv.some((arg) => arg === '--elevated');
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildElevateCommand(execPath, args) {
  const file = psQuote(execPath);
  const argList = args.map(psQuote).join(',');
  return `Start-Process -FilePath ${file} -ArgumentList ${argList} -Verb RunAs`;
}

module.exports = { shouldElevate, buildElevateCommand, psQuote };
