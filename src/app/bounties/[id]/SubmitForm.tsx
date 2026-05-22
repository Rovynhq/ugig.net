"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

interface Question {
  id: string;
  type: "short_text" | "long_text" | "multiple_choice";
  label: string;
  required: boolean;
  options?: string[];
}

interface SubmitFormProps {
  bountyId: string;
  questions: Question[];
}

export function SubmitForm({ bountyId, questions }: SubmitFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const setValue = (id: string, v: string) => {
    setValues((cur) => ({ ...cur, [id]: v }));
  };

  const submit = async () => {
    setError(null);
    const answers = questions
      .map((q) => ({
        question_id: q.id,
        value: values[q.id] ?? "",
      }))
      .filter((a) => a.value !== "" || questions.find((q) => q.id === a.question_id)?.required);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/bounties/${bountyId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to submit");
        return;
      }
      setSuccess(true);
      setTimeout(() => router.refresh(), 800);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="p-6 border border-green-500/20 bg-green-500/5 rounded-lg text-center">
        <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
        <p className="font-medium mb-1">Submission received</p>
        <p className="text-sm text-muted-foreground">
          The bounty creator will review and notify you of the decision.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {questions.map((q, idx) => (
        <div key={q.id} className="space-y-2">
          <label className="text-sm font-medium">
            {idx + 1}. {q.label}
            {q.required && <span className="text-destructive ml-1">*</span>}
          </label>
          {q.type === "short_text" && (
            <input
              type="text"
              value={values[q.id] || ""}
              onChange={(e) => setValue(q.id, e.target.value)}
              className="w-full border rounded-md px-3 py-2 bg-background"
              maxLength={500}
            />
          )}
          {q.type === "long_text" && (
            <textarea
              value={values[q.id] || ""}
              onChange={(e) => setValue(q.id, e.target.value)}
              rows={4}
              className="w-full border rounded-md px-3 py-2 bg-background resize-y"
              maxLength={5000}
            />
          )}
          {q.type === "multiple_choice" && (
            <div className="space-y-1.5">
              {(q.options || []).map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-accent cursor-pointer text-sm"
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={opt}
                    checked={values[q.id] === opt}
                    onChange={(e) => setValue(q.id, e.target.value)}
                  />
                  {opt}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
          {error}
        </div>
      )}

      <Button onClick={submit} disabled={submitting} className="w-full gap-2">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Submit
      </Button>
    </div>
  );
}
