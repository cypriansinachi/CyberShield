import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { CreateUserForm } from '@/components/admin-forms';
import { requirePermission } from '@/server/auth/dal';

export const metadata: Metadata = { title: 'Add user' };

export default async function NewUserPage() {
  await requirePermission('user.manage');
  return (
    <>
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Users & roles
      </Link>
      <PageHeader title="Add a user" description="A one-time temporary password is generated. The user must change it at first sign-in." />
      <Card className="max-w-3xl">
        <CardHeader title="Account details" description="The account starts as a Customer. Give it a role afterwards from the account page." />
        <CardBody>
          <CreateUserForm />
        </CardBody>
      </Card>
    </>
  );
}
