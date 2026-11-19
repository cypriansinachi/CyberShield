/**
 * Offline audit-trail verification: recomputes the HMAC hash chain and exits
 * non-zero if any entry was modified, removed or re-ordered.
 *   npm run audit:verify
 */
import './load-env';
import { verifyAuditChain } from '@/server/audit';

async function main() {
  const r = await verifyAuditChain();
  if (r.ok) {
    console.log(`✔ Audit chain intact: ${r.checked} entries verified.`);
    console.log(`  head hash: ${r.headHash ?? '(empty log)'}`);
    process.exit(0);
  }
  console.error(`✘ Audit chain BROKEN at entry #${r.brokenAt}: ${r.reason}`);
  console.error(`  ${r.checked} entries verified before the break.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
