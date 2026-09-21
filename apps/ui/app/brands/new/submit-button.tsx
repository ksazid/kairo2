"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Analysing website and building Brand Brain…" : "Analyse website and build Brand Brain"}
    </button>
  );
}
