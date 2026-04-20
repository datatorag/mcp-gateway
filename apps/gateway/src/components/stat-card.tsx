export function StatCard({
  label,
  value,
  hint,
  size = "md",
}: {
  label: string;
  value: string;
  hint?: string;
  size?: "md" | "sm";
}) {
  return (
    <div className="rounded-xl border border-border p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display font-bold text-foreground ${
          size === "sm" ? "text-xl" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[10px] text-muted-foreground/70">{hint}</p>
      )}
    </div>
  );
}
