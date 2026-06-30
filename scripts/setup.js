const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function run(cmd, cwd = root) {
  console.log('\n>', cwd === root ? cmd : `(in ${path.relative(root, cwd)}) ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

console.log('Figma Agent – one-time setup\n');

// 1. Install backend
run('npm install', path.join(root, 'backend'));

// 2. Install plugin
run('npm install', path.join(root, 'figma-plugin'));

// 3. Create .env from example if missing
const envPath = path.join(root, 'backend', '.env');
const envExample = path.join(root, 'backend', '.env.example');
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(envExample, envPath);
  console.log('\nCreated backend/.env from .env.example.');
  console.log('  → Open backend/.env and set your OPENAI_API_KEY.\n');
} else {
  console.log('\nbackend/.env already exists (skipped).\n');
}

// 4. Build plugin so it’s ready for Figma
run('npm run build', path.join(root, 'figma-plugin'));

console.log('\nSetup done.\n');
console.log('Next steps:');
console.log('  1. Edit backend/.env and add your OpenAI API key.');
console.log('  2. Run:  npm start');
console.log('  3. In Figma: Plugins → Development → Import plugin from manifest');
console.log('     → choose the "figma-plugin" folder in this project.\n');
