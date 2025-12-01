'use client';

type Props = {
  name?: string | null;
  src?: string | null; // URL (http...) d'une image publique
  size?: number;       // px
};

function initials(name?: string | null) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const ini = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return ini.toUpperCase() || name.slice(0, 2).toUpperCase();
}

export default function Avatar({ name, src, size = 36 }: Props) {
  const style: React.CSSProperties = {
    width: size, height: size,
    borderRadius: '9999px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#e5e7eb', color: '#374151', fontWeight: 700, fontSize: 12,
    overflow: 'hidden',
  };

  if (src && /^https?:\/\//i.test(src)) {
    return (
      <img
        src={src}
        alt={name || 'avatar'}
        style={style}
      />
    );
  }

  return <div style={style}>{initials(name)}</div>;
}


