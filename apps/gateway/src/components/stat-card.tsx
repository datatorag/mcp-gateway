import { Card } from "@/components/ui/card";

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
    <Card className="gap-1 p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`font-display font-bold text-foreground tabular-nums ${
          size === "sm" ? "text-xl" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[10px] text-muted-foreground/70">{hint}</p>
      )}
    </Card>
  );
}
