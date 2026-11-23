import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/misc';
import { ReportForm } from '@/components/incidents/report-form';
import { requirePermission } from '@/server/auth/dal';
import { config } from '@/server/config';
import { toDateTimeInput } from '@/lib/format';
import { ORG_NAME } from '@/lib/constants';

export const metadata: Metadata = { title: 'Report an incident' };

export default async function NewIncidentPage() {
  await requirePermission('incident.create');
  return (
    <>
      <PageHeader
        title="Report a security incident"
        description={`Tell us what you noticed. The report goes straight to the ${ORG_NAME} security team, who will keep you updated on its progress.`}
      />
      <ReportForm defaultDetectedAt={toDateTimeInput(new Date().toISOString())} regulator={config.compliance.regulatorName} />
    </>
  );
}
