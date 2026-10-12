import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/page-shell";
import { SavedLoginsSection } from "@/components/settings/saved-logins";

export const Route = createFileRoute("/_authed/settings/passwords")({
  component: PasswordsPage,
});

/** 旧入口仍可访问；导航里已并入「账号与密码」。 */
function PasswordsPage() {
  return (
    <PageShell title={"密码"}>
      <SavedLoginsSection />
    </PageShell>
  );
}
