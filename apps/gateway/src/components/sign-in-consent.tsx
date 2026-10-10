import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The agreement a visitor makes by signing in, said where they sign in.
 *
 * It lived on the login page. With calls to action starting sign-in
 * directly, that page is no longer on the way, so the sentence moves to the
 * buttons and to the first screen after sign-in. One component, so the words
 * and the two links cannot differ between places.
 */
export function SignInConsent({
  className,
  verb = "continuing",
}: {
  className?: string;
  /** "continuing" beside a button; "using DataToRAG" once signed in. */
  verb?: "continuing" | "signing in" | "using DataToRAG";
}) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-sign-in-consent="">
      By {verb} you agree to our{" "}
      <Link className="underline underline-offset-2 hover:opacity-80" href="/terms">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link className="underline underline-offset-2 hover:opacity-80" href="/privacy">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
