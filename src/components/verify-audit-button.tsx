'use client';

import { ActionForm, SubmitButton } from '@/components/ui/form';
import { verifyAuditAction } from '@/server/actions/admin';
import { Fingerprint } from 'lucide-react';

export function VerifyAuditButton() {
  return (
    <ActionForm action={verifyAuditAction} className="space-y-2">
      <SubmitButton variant="secondary" size="sm" pendingText="Verifying chain…">
        <Fingerprint aria-hidden /> Verify integrity now
      </SubmitButton>
    </ActionForm>
  );
}
