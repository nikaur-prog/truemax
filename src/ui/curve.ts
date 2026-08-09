// Population bell curve SVG with the subject's dot animating into position.
export function curveSVG(pct: number, soft = false): string {
  let path = "M0,84 ";
  for (let x = 0; x <= 300; x += 4) {
    const z = (x - 150) / 46;
    const y = 84 - Math.exp((-z * z) / 2) * 70;
    path += `L${x},${y} `;
  }
  path += "L300,84 Z";
  const px = Math.max(8, Math.min(292, (pct / 100) * 300));
  const pz = (px - 150) / 46;
  const py = 84 - Math.exp((-pz * pz) / 2) * 70;
  return `<svg viewBox="0 0 300 92" width="100%">
    <path d="${path}" fill="${soft ? "#E4F0EC" : "#EFEDE7"}" stroke="#CBC9C2" stroke-width="1"/>
    <line x1="150" y1="14" x2="150" y2="84" stroke="#DDDBD4" stroke-width="1" stroke-dasharray="2 4"/>
    <line x1="${px}" y1="${py}" x2="${px}" y2="84" stroke="#0E7A68" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="${px}" cy="${py}" r="0" fill="#0E7A68"><animate attributeName="r" to="5.5" dur=".5s" begin=".25s" fill="freeze"/></circle>
    <text x="150" y="10" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#A9ABA6">MEDIAN</text>
  </svg>`;
}
