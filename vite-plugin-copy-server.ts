import { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

export function copyServerPlugin(): Plugin {
  return {
    name: 'copy-server',
    buildStart() {
      // Copy server files to dist-electron during build
      const srcDir = path.join(__dirname, 'electron', 'main', 'server');
      const destDir = path.join(__dirname, 'dist-electron', 'main', 'server');
      
      // Create destination directory
      fs.mkdirSync(destDir, { recursive: true });
      
      // Function to copy directory recursively
      function copyRecursive(src: string, dest: string) {
        const exists = fs.existsSync(src);
        const stats = exists && fs.statSync(src);
        const isDirectory = exists && stats.isDirectory();
        
        if (isDirectory) {
          fs.mkdirSync(dest, { recursive: true });
          fs.readdirSync(src).forEach((childItemName) => {
            copyRecursive(
              path.join(src, childItemName),
              path.join(dest, childItemName)
            );
          });
        } else {
          fs.copyFileSync(src, dest);
        }
      }
      
      console.log('Copying server files...');
      copyRecursive(srcDir, destDir);
      console.log('Server files copied successfully!');
    }
  };
}