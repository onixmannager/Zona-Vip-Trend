const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname);

for (const file of files) {
  if (file.startsWith('src\\')) {
    const targetPath = file.replace(/\\/g, '/');
    const targetDir = path.dirname(targetPath);
    
    // Create directory if not exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Remove target if exists
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    
    // Rename
    fs.renameSync(file, targetPath);
    console.log('Moved', file, 'to', targetPath);
  }
}
