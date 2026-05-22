import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/layout/Header";
import { ArrowLeft } from "lucide-react";
import { BountyForm } from "./BountyForm";

export const metadata = {
  title: "Post a bounty | ugig.net",
  description: "Post a bounty with a structured submission form",
};

export default async function NewBountyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/bounties/new");
  }

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/bounties"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            All bounties
          </Link>

          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">Post a bounty</h1>
            <p className="text-muted-foreground">
              Define the submission form. Submitters will answer it; you
              approve or reject each one and pay approved submissions.
            </p>
          </div>

          <BountyForm />
        </div>
      </main>
    </>
  );
}
