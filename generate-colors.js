const colors = [];
const steps = 36;
for (let i = 0; i < steps; i++) {
  const hue = Math.round(i * (360 / steps));
  colors.push(`  - name: "Hue ${hue}°"\n    hex: "hsl(${hue}, 100%, 50%)"`);
}
console.log(colors.join('\n'));
