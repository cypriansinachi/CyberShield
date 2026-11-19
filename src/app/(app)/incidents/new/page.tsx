import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/misc';
import { ReportForm } from '@/components/incidents/report-form';
import { requirePermission } from '@/server/auth/dal';
import { config } from '@/server/config';
import { toDateTimeInput } from '@/lib/format';

export const metadata: Metadata = { title: 'Report an incident' };

export default async function NewIncidentPage() {
  const user = await requirePermission('incident.create');
  return (
    <>
      <PageHeader
        title="Report a security incident"
        description="Tell us what happened. The report goes straight to the security team, who will keep you updated on its progress."
      />
      <ReportForm defaultDetectedAt={toDateTimeInput(new Date().toISOString())} defaultDepartment={user.department ?? ''} regulator={config.compliance.regulatorName} />
    </>
  );
}
