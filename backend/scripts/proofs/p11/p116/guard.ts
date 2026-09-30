import { matchableValue } from '../../vidyasetu/api/src/fraud/fraud-match';
for (const [f, v] of [['bank_account', ''], ['bank_account', ' - '], ['bank_account', 'N/A'], ['bank_account', 'NOT AVAILABLE'], ['bank_account', 'SBIN0004455'], ['bank_account', '12345678'], ['bank_account', '123456789'], ['caste_cert_number', 'NIL'], ['caste_cert_number', 'PENDING-01'], ['caste_cert_number', 'JH-1234']] as const)
  console.log(`  ${f.padEnd(18)} ${JSON.stringify(v).padEnd(18)} -> ${JSON.stringify(matchableValue(f, v))}`);
