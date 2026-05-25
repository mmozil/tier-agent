interface Props {
  nome: string;
  size?: number;
  className?: string;
}

const PALETTE = ["#003083", "#0050D5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({ nome, size = 32, className }: Props) {
  const bg = colorFor(nome || "?");
  return (
    <div
      className={`rounded-full text-white flex items-center justify-center font-medium select-none flex-shrink-0 ${className || ""}`}
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.4 }}
    >
      {initials(nome || "?")}
    </div>
  );
}
