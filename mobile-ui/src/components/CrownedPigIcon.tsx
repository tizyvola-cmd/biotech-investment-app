/** Maialino con corona — stesso spirito del Piggy Bank desktop. */
export function CrownedPigIcon({ size = 40 }: { size?: number }) {
  return (
    <span
      className="crowned-pig-icon"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="crowned-pig-crown">👑</span>
      <span className="crowned-pig-face">🐷</span>
    </span>
  );
}
