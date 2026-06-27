/**
 * Package extension for Chrome Web Store upload.
 * Run with: node package-extension.js
 * Creates a clean zip file excluding dev files.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSION_DIR = __dirname;
const OUTPUT_ZIP = path.join(__dirname, '..', 'meeting-copilot-extension.zip');

// Files and directories to exclude from the zip
const EXCLUDE = [
  'node_modules',
  '.git',
  '.DS_Store',
  'package.json',
  'package-lock.json',
  'icons/generate-icons.js',
  'icons/node_modules',
  'icons/package.json',
  'icons/package-lock.json',
  'STORE_LISTING.md',
  'README.md',
  '.gitignore'
];

function shouldExclude(filePath) {
  const relativePath = path.relative(EXTENSION_DIR, filePath);
  const parts = relativePath.split(path.sep);
  
  for (const exclude of EXCLUDE) {
    if (parts.includes(exclude)) return true;
    if (relativePath.startsWith(exclude)) return true;
  }
  return false;
}

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      if (!shouldExclude(filePath)) {
        fileList.push(filePath);
      }
    }
  }
  
  return fileList;
}

try {
  console.log('Packaging extension for Chrome Web Store...');
  
  // Get all files to include
  const files = getAllFiles(EXTENSION_DIR);
  console.log(`Found ${files.length} files to package`);
  
  // Create zip using PowerShell (Windows)
  const tempDir = path.join(__dirname, 'temp_package');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });
  
  // Copy files to temp directory
  for (const file of files) {
    const relativePath = path.relative(EXTENSION_DIR, file);
    const destPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(file, destPath);
  }
  
  // Create zip
  console.log('Creating zip file...');
  const zipCommand = `Compress-Archive -Path "${tempDir}\\*" -DestinationPath "${OUTPUT_ZIP}" -Force`;
  execSync(zipCommand, { shell: 'powershell.exe' });
  
  // Cleanup temp directory
  fs.rmSync(tempDir, { recursive: true, force: true });
  
  console.log(`✓ Extension packaged successfully: ${OUTPUT_ZIP}`);
  console.log(`Size: ${(fs.statSync(OUTPUT_ZIP).size / 1024).toFixed(2)} KB`);
  console.log('\nUpload this file to the Chrome Web Store Developer Dashboard.');
  
} catch (error) {
  console.error('Error packaging extension:', error.message);
  process.exit(1);
}
