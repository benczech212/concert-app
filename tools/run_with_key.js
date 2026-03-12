const { execSync } = require('child_process');
try {
  let key = execSync('npx @dotenvx/dotenvx get GEMINI_API_KEY').toString().trim();
  // It's returning a literal unescaped string so let's encode it just in case
  execSync(`sed -i "s|GEMINI_API_KEY=.*|GEMINI_API_KEY=\\"${key}\\"|g" .env.plain`);
} catch (e) {
  console.error(e);
}
