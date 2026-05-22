import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/get-user";
import { reviewSubmissionSchema } from "@/lib/bounties";

// PATCH /api/bounties/[id]/submissions/[sid] — creator approves/rejects
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id: bountyId, sid } = await params;
    const auth = await getAuthContext(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { user, supabase } = auth;

    const body = await request.json();
    const parsed = reviewSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Verify caller is the bounty creator
    const { data: bounty } = await (supabase as any)
      .from("bounties")
      .select("id, creator_id, title")
      .eq("id", bountyId)
      .single();
    if (!bounty) {
      return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    }
    if (bounty.creator_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: submission, error } = await (supabase as any)
      .from("bounty_submissions")
      .update({
        status: parsed.data.status,
        review_notes: parsed.data.review_notes || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", sid)
      .eq("bounty_id", bountyId)
      .select()
      .single();

    if (error || !submission) {
      return NextResponse.json(
        { error: error?.message || "Submission not found" },
        { status: 400 }
      );
    }

    // Notify submitter
    await supabase.from("notifications").insert({
      user_id: submission.submitter_id,
      type: "payment_received",
      title:
        parsed.data.status === "approved"
          ? "Bounty submission approved"
          : "Bounty submission rejected",
      body: `Your submission to "${bounty.title}" was ${parsed.data.status}.`,
      data: { bounty_id: bountyId, submission_id: sid },
    });

    return NextResponse.json({ data: submission });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
