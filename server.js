// scaled-ipfs-platform.mjs
import express from 'express';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import util from 'util';
const execAsync = util.promisify(exec);
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import AdmZip from 'adm-zip';

let user_folders = {};
let folder_contents = {}; 
let user_aliases = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});


let ipfsDaemon = null;

// Enhanced mapping systems
let dns_map = {};           // dns => { cid, owner, created, updated, type }
let user_directories = {};  // userId => { dns: [], files: { filename: cid } }
let cid_history = {};       // dns => [{ cid, timestamp, version }]
let file_ownership = {};    // filename => userId
let access_tokens = {};     // token => { userId, permissions, expires }
let user_folder_cid_history = {};  // alias => [{ cid, timestamp, websites: [] }]
let website_cid_mapping = {};      // dns => { current_folder_cid, path, creation_folder_cid }
let cid_redirects = {};           // old_cid => current_cid (for IPFS gateway redirects)
let user_credentials = {};


// async function createUserFolder(username) {
//   const folderDir = path.join(__dirname, 'temp', `user-${username}-${Date.now()}`);
//   fs.mkdirSync(folderDir, { recursive: true });
  
//   // Create initial folder structure
//   const welcomeFile = path.join(folderDir, 'welcome.txt');
//   fs.writeFileSync(welcomeFile, `Welcome to ${username}'s IPFS folder!\nCreated: ${new Date().toISOString()}\nQuota: 10MB`);
  
//   // Upload to IPFS
//   const result = await execPromise(`ipfs add -r .`, folderDir);
//   const lines = result.trim().split('\n');
//   const cid = lines[lines.length - 1].split(' ')[1];
  
//   // Initialize user folder data
//   user_folders[username] = {
//     cid,
//     quota_used: 1024, // welcome.txt size
//     quota_limit: 10 * 1024 * 1024, // 10MB
//     created: new Date().toISOString(),
//     updated: new Date().toISOString()
//   };
  
//   folder_contents[username] = {
//     files: { 'welcome.txt': { size: 1024, cid: cid, type: 'text' } },
//     websites: {}
//   };
  
//   // Cleanup
//   fs.rmSync(folderDir, { recursive: true, force: true });
  
//   return cid;
// }


async function createUserFolder(alias) {
  const folderDir = path.join(__dirname, 'temp', `user-${alias}-${Date.now()}`);
  fs.mkdirSync(folderDir, { recursive: true });
  
  // Create initial folder structure with more content
  const welcomeFile = path.join(folderDir, 'welcome.txt');
  const readmeFile = path.join(folderDir, 'README.md');
  
  // Create subdirectories
  fs.mkdirSync(path.join(folderDir, 'websites'), { recursive: true });
  fs.mkdirSync(path.join(folderDir, 'zipwebsites'), { recursive: true }); // ADD THIS
  fs.mkdirSync(path.join(folderDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(folderDir, 'media'), { recursive: true });
  
  // Welcome content
  fs.writeFileSync(welcomeFile, `Welcome to ${alias}'s IPFS folder!
Created: ${new Date().toISOString()}
Quota: 10MB
Alias: ${alias}

This is your personal IPFS storage space. You can:
- Host template websites in the 'websites' folder
- Host ZIP websites in the 'zipwebsites' folder
- Store files in the 'files' folder  
- Upload media in the 'media' folder

Happy building! 🚀`);

  // README with folder structure
  fs.writeFileSync(readmeFile, `# ${alias}'s IPFS Folder

## Structure
- \`websites/\` - Template-created websites
- \`zipwebsites/\` - ZIP-uploaded websites
- \`files/\` - Document storage
- \`media/\` - Images, videos, assets
- \`welcome.txt\` - Welcome message

## Usage
This folder is managed by the IPFS Portfolio Builder platform.
Each update creates a new CID while maintaining version history.

## Quota: 10MB
Use your space wisely!

---
Generated: ${new Date().toISOString()}
`);

  // Add a placeholder index.html for the folder
  const indexFile = path.join(folderDir, 'index.html');
  fs.writeFileSync(indexFile, `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${alias}'s IPFS Folder</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #2196F3; padding-bottom: 20px; margin-bottom: 30px; }
        .folder-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .folder-item { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .folder-icon { font-size: 3rem; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📁 ${alias}'s IPFS Folder</h1>
            <p>Personal storage space on the decentralized web</p>
        </div>
        
        <div class="folder-grid">
            <div class="folder-item">
                <div class="folder-icon">🎨</div>
                <h3>Template Sites</h3>
                <p>Your template-created websites</p>
            </div>
            <div class="folder-item">
                <div class="folder-icon">📦</div>
                <h3>ZIP Sites</h3>
                <p>Your ZIP-uploaded websites</p>
            </div>
            <div class="folder-item">
                <div class="folder-icon">📄</div>
                <h3>Files</h3>
                <p>Documents and data storage</p>
            </div>
            <div class="folder-item">
                <div class="folder-icon">🎭</div>
                <h3>Media</h3>
                <p>Images, videos, and assets</p>
            </div>
        </div>
        
        <div style="text-align: center; margin-top: 40px; color: #666;">
            <p>Created: ${new Date().toLocaleDateString()}</p>
            <p>Quota: 10MB available</p>
        </div>
    </div>
</body>
</html>`);

  // Upload to IPFS
  const result = await execPromise(`ipfs add -r .`, folderDir);
  const lines = result.trim().split('\n');
  const cid = lines[lines.length - 1].split(' ')[1];
  
  // Calculate initial size
  const initialSize = fs.readFileSync(welcomeFile).length + 
                     fs.readFileSync(readmeFile).length + 
                     fs.readFileSync(indexFile).length;
  
  // Initialize user folder data
  user_folders[alias] = {
    cid,
    quota_used: initialSize,
    quota_limit: 10 * 1024 * 1024, // 10MB
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    files_count: 3,
    websites_count: 0,
    zipwebsites_count: 0  // ADD THIS
  };
  
  // CRITICAL FIX: Initialize folder_contents properly
  folder_contents[alias] = {
    files: { 
      'welcome.txt': { size: fs.readFileSync(welcomeFile).length, type: 'text' },
      'README.md': { size: fs.readFileSync(readmeFile).length, type: 'markdown' },
      'index.html': { size: fs.readFileSync(indexFile).length, type: 'html' }
    },
    websites: {},      // Template websites
    zipwebsites: {}    // ZIP websites - ADD THIS
  };
  
  // Cleanup
  fs.rmSync(folderDir, { recursive: true, force: true });
  
  return cid;
}

async function calculateFolderSize(username) {
  let totalSize = 0;
  const contents = folder_contents[username];
  
  if (contents) {
    // Calculate file sizes
    Object.values(contents.files).forEach(file => {
      totalSize += file.size || 0;
    });
    
    // Calculate website sizes (estimated)
    Object.values(contents.websites).forEach(site => {
      totalSize += site.estimated_size || 0;
    });
  }
  
  return totalSize;
}

function checkQuota(username, additionalSize) {
  const folder = user_folders[username];
  if (!folder) return false;
  
  const currentUsed = folder.quota_used || 0;
  const limit = folder.quota_limit || (10 * 1024 * 1024);
  
  return (currentUsed + additionalSize) <= limit;
}

// async function updateUserFolder(username, newContent, contentType, contentSize) {
//   if (!user_folders[username]) {
//     throw new Error('User folder not found');
//   }
  
//   // Check quota
//   if (!checkQuota(username, contentSize)) {
//     const available = (user_folders[username].quota_limit - user_folders[username].quota_used) / 1024 / 1024;
//     throw new Error(`Quota exceeded. Available: ${available.toFixed(2)}MB`);
//   }
  
//   // Get current folder content
//   const currentCID = user_folders[username].cid;
//   const tempDir = path.join(__dirname, 'temp', `update-user-${username}-${Date.now()}`);
  
//   try {
//     console.log(`📂 Updating user folder for ${username}`);
//     console.log(`📦 Current CID: ${currentCID}`);
    
//     // Create temp directory
//     fs.mkdirSync(tempDir, { recursive: true });
    
//     // Download current folder - FIXED: handle IPFS get properly
//     console.log(`📥 Downloading current folder...`);
//     await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
    
//     // CRITICAL FIX: Find the actual content directory
//     let folderDir;
//     const tempContents = fs.readdirSync(tempDir);
//     console.log(`📋 Contents of temp dir:`, tempContents);
    
//     if (tempContents.includes(currentCID)) {
//       // Standard case: /temp/QmXXX/
//       folderDir = path.join(tempDir, currentCID);
//     } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
//       // Alternative case: /temp/some-other-name/
//       folderDir = path.join(tempDir, tempContents[0]);
//     } else {
//       // Content is directly in temp dir
//       folderDir = tempDir;
//     }
    
//     console.log(`📁 Using folder directory: ${folderDir}`);
    
//     // Verify the folder directory exists and check its contents
//     if (!fs.existsSync(folderDir)) {
//       console.error(`❌ Folder directory doesn't exist: ${folderDir}`);
//       console.error(`Available paths:`, tempContents);
//       throw new Error(`Downloaded folder not found at expected path: ${folderDir}`);
//     }
    
//     const existingItems = fs.readdirSync(folderDir);
//     console.log(`📋 Existing items in downloaded folder:`, existingItems);
    
//     // Ensure websites directory exists and check what's in it
//     const websitesDir = path.join(folderDir, 'websites');
//     if (!fs.existsSync(websitesDir)) {
//       console.log(`📁 Creating websites directory`);
//       fs.mkdirSync(websitesDir, { recursive: true });
//     } else {
//       const existingWebsites = fs.readdirSync(websitesDir);
//       console.log(`🌐 Existing websites in downloaded folder:`, existingWebsites);
//     }
    
//     // Add new content based on type
//     if (contentType === 'website') {
//       const websiteDir = path.join(folderDir, 'websites', newContent.dns);
//       console.log(`🌐 Creating new website: ${newContent.dns} at ${websiteDir}`);
      
//       // Create website directory
//       fs.mkdirSync(websiteDir, { recursive: true });
      
//       // Ensure data directory exists in website
//       const dataDir = path.join(websiteDir, 'data');
//       fs.mkdirSync(dataDir, { recursive: true });
      
//       // Copy website files
//       console.log(`📄 Adding files:`, Object.keys(newContent.files));
//       for (const [filename, content] of Object.entries(newContent.files)) {
//         const filePath = path.join(websiteDir, filename);
//         const fileDir = path.dirname(filePath);
//         fs.mkdirSync(fileDir, { recursive: true });
        
//         if (typeof content === 'string') {
//           fs.writeFileSync(filePath, content);
//         } else {
//           fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
//         }
//         console.log(`✅ Created file: ${filename}`);
//       }
      
//       // Create data.json for the website
//       const dataJsonPath = path.join(websiteDir, 'data', 'data.json');
//       if (!fs.existsSync(dataJsonPath)) {
//         const websiteData = {
//           template: newContent.template || 'user-created',
//           userData: newContent.userData || {},
//           owner: username,
//           created: new Date().toISOString(),
//           version: '1.0',
//           dns: newContent.dns,
//           type: 'user-folder-website',
//           folder_path: `websites/${newContent.dns}`
//         };
//         fs.writeFileSync(dataJsonPath, JSON.stringify(websiteData, null, 2));
//         console.log(`✅ Created data.json for ${newContent.dns}`);
//       }
      
//       // Update folder contents tracking
//       if (!folder_contents[username]) folder_contents[username] = { files: {}, websites: {} };
//       folder_contents[username].websites[newContent.dns] = {
//         estimated_size: contentSize,
//         files: Object.keys(newContent.files),
//         created: new Date().toISOString(),
//         has_data_json: true
//       };
      
//     } else if (contentType === 'file') {
//       // Ensure files directory exists
//       const filesDir = path.join(folderDir, 'files');
//       if (!fs.existsSync(filesDir)) {
//         fs.mkdirSync(filesDir, { recursive: true });
//       }
      
//       const filePath = path.join(folderDir, 'files', newContent.filename);
//       const fileDir = path.dirname(filePath);
//       fs.mkdirSync(fileDir, { recursive: true });
      
//       if (newContent.encoding === 'base64') {
//         fs.writeFileSync(filePath, Buffer.from(newContent.content, 'base64'));
//       } else {
//         fs.writeFileSync(filePath, newContent.content);
//       }
      
//       // Update folder contents tracking
//       if (!folder_contents[username]) folder_contents[username] = { files: {}, websites: {} };
//       folder_contents[username].files[newContent.filename] = {
//         size: contentSize,
//         type: newContent.type || 'unknown',
//         created: new Date().toISOString()
//       };
//     }
    
//     // VERIFY: Check final state before upload
//     const finalWebsitesDir = path.join(folderDir, 'websites');
//     if (fs.existsSync(finalWebsitesDir)) {
//       const finalWebsites = fs.readdirSync(finalWebsitesDir);
//       console.log(`🌐 Final websites before upload:`, finalWebsites);
      
//       // Verify each website has proper structure
//       finalWebsites.forEach(websiteName => {
//         const websitePath = path.join(finalWebsitesDir, websiteName);
//         if (fs.existsSync(websitePath) && fs.statSync(websitePath).isDirectory()) {
//           const websiteFiles = fs.readdirSync(websitePath);
//           console.log(`  📂 ${websiteName}:`, websiteFiles);
//         }
//       });
//     } else {
//       console.error(`❌ Websites directory missing before upload!`);
//     }
    
//     // Re-upload to IPFS
//     console.log(`📤 Re-uploading folder to IPFS from: ${folderDir}`);
//     const result = await execPromise(`ipfs add -r .`, folderDir);
//     const lines = result.trim().split('\n');
//     const newCID = lines[lines.length - 1].split(' ')[1];
    
//     console.log(`✅ New CID: ${newCID}`);
    
//     // Update tracking systems
//     const oldCID = user_folders[username].cid;
    
//     // 1. Update user folder data
//     user_folders[username].cid = newCID;
//     user_folders[username].quota_used += contentSize;
//     user_folders[username].updated = new Date().toISOString();
    
//     // 2. Track CID history
//     if (!user_folder_cid_history) user_folder_cid_history = {};
//     if (!user_folder_cid_history[username]) {
//       user_folder_cid_history[username] = [];
//     }
    
//     const currentWebsites = Object.keys(folder_contents[username].websites || {});
    
//     user_folder_cid_history[username].push({
//       cid: newCID,
//       previous_cid: oldCID,
//       timestamp: new Date().toISOString(),
//       action: contentType === 'website' ? `Added website: ${newContent.dns}` : `Added file: ${newContent.filename}`,
//       websites: [...currentWebsites],
//       version: user_folder_cid_history[username].length + 1
//     });
    
//     // 3. Create CID redirects
//     if (!cid_redirects) cid_redirects = {};
//     if (oldCID !== newCID) {
//       cid_redirects[oldCID] = newCID;
//     }
    
//     // 4. Update website CID mapping
//     if (!website_cid_mapping) website_cid_mapping = {};
//     currentWebsites.forEach(websiteDns => {
//       if (!website_cid_mapping[websiteDns]) {
//         website_cid_mapping[websiteDns] = {
//           creation_folder_cid: newCID,
//           path: `websites/${websiteDns}`
//         };
//       }
//       website_cid_mapping[websiteDns].current_folder_cid = newCID;
//       website_cid_mapping[websiteDns].last_updated = new Date().toISOString();
//     });
    
//     // Update counts
//     if (contentType === 'website') {
//       user_folders[username].websites_count = Object.keys(folder_contents[username].websites).length;
//     }
//     user_folders[username].files_count = Object.keys(folder_contents[username].files || {}).length;
    
//     // Cleanup
//     fs.rmSync(tempDir, { recursive: true, force: true });
    
//     console.log(`📦 Successfully updated ${username} folder: ${oldCID} → ${newCID}`);
//     console.log(`🌐 Total websites now: ${currentWebsites.length}`);
    
//     return { oldCID, newCID, quotaUsed: user_folders[username].quota_used };
    
//   } catch (err) {
//     console.error(`❌ Error updating user folder:`, err);
//     if (fs.existsSync(tempDir)) {
//       fs.rmSync(tempDir, { recursive: true, force: true });
//     }
//     throw err;
//   }
// }

// Persistent storage

async function updateUserFolder(username, newContent, contentType, contentSize) {
  if (!user_folders[username]) {
    throw new Error('User folder not found');
  }
  
  // Check quota
  if (!checkQuota(username, contentSize)) {
    const available = (user_folders[username].quota_limit - user_folders[username].quota_used) / 1024 / 1024;
    throw new Error(`Quota exceeded. Available: ${available.toFixed(2)}MB`);
  }
  
  // CRITICAL FIX: Initialize folder_contents if it doesn't exist
  if (!folder_contents[username]) {
    console.log(`🔧 Initializing folder_contents for ${username}`);
    folder_contents[username] = {
      files: {},
      websites: {},
      zipwebsites: {}
    };
  }
  
  // ADDITIONAL FIX: Ensure all required properties exist
  if (!folder_contents[username].files) {
    folder_contents[username].files = {};
  }
  if (!folder_contents[username].websites) {
    folder_contents[username].websites = {};
  }
  if (!folder_contents[username].zipwebsites) {
    folder_contents[username].zipwebsites = {};
  }
  
  console.log(`📊 Current folder_contents for ${username}:`, {
    files: Object.keys(folder_contents[username].files).length,
    websites: Object.keys(folder_contents[username].websites).length,
    zipwebsites: Object.keys(folder_contents[username].zipwebsites).length
  });
  
  // Get current folder content
  const currentCID = user_folders[username].cid;
  const tempDir = path.join(__dirname, 'temp', `update-user-${username}-${Date.now()}`);
  
  try {
    console.log(`📂 Updating user folder for ${username} (${contentType})`);
    console.log(`📦 Current CID: ${currentCID}`);
    
    // Create temp directory and download current folder
    fs.mkdirSync(tempDir, { recursive: true });
    await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
    
    // Find the actual content directory
    let folderDir;
    const tempContents = fs.readdirSync(tempDir);
    
    if (tempContents.includes(currentCID)) {
      folderDir = path.join(tempDir, currentCID);
    } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
      folderDir = path.join(tempDir, tempContents[0]);
    } else {
      folderDir = tempDir;
    }
    
    console.log(`📁 Using folder directory: ${folderDir}`);
    
    const existingItems = fs.readdirSync(folderDir);
    console.log(`📋 Existing items in downloaded folder:`, existingItems);
    
    // Ensure required directories exist
    const websitesDir = path.join(folderDir, 'websites');
    const zipWebsitesDir = path.join(folderDir, 'zipwebsites');
    const filesDir = path.join(folderDir, 'files');
    
    if (!fs.existsSync(websitesDir)) {
      fs.mkdirSync(websitesDir, { recursive: true });
      console.log(`📁 Created websites directory`);
    }
    
    if (!fs.existsSync(zipWebsitesDir)) {
      fs.mkdirSync(zipWebsitesDir, { recursive: true });
      console.log(`📁 Created zipwebsites directory`);
    }
    
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
      console.log(`📁 Created files directory`);
    }
    
    // Check existing content
    const existingWebsites = fs.existsSync(websitesDir) ? fs.readdirSync(websitesDir) : [];
    const existingZipWebsites = fs.existsSync(zipWebsitesDir) ? fs.readdirSync(zipWebsitesDir) : [];
    
    console.log(`🌐 Existing template websites:`, existingWebsites);
    console.log(`📦 Existing ZIP websites:`, existingZipWebsites);
    
    // Add new content based on type
    if (contentType === 'website') {
      // Template website goes to websites/
      const websiteDir = path.join(folderDir, 'websites', newContent.dns);
      console.log(`🌐 Creating template website: ${newContent.dns}`);
      
      fs.mkdirSync(websiteDir, { recursive: true });
      
      // Create website files
      for (const [filename, content] of Object.entries(newContent.files)) {
        const filePath = path.join(websiteDir, filename);
        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        
        if (typeof content === 'string') {
          fs.writeFileSync(filePath, content);
        } else {
          fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
        }
      }
      
      // Ensure data.json exists
      const dataJsonPath = path.join(websiteDir, 'data', 'data.json');
      if (!fs.existsSync(dataJsonPath)) {
        fs.mkdirSync(path.dirname(dataJsonPath), { recursive: true });
        const websiteData = {
          template: newContent.template || 'user-created',
          userData: newContent.userData || {},
          owner: username,
          created: new Date().toISOString(),
          version: '1.0',
          dns: newContent.dns,
          type: 'user-folder-website',
          folder_path: `websites/${newContent.dns}`
        };
        fs.writeFileSync(dataJsonPath, JSON.stringify(websiteData, null, 2));
      }
      
      // Update tracking - FIXED: folder_contents is now guaranteed to exist
      folder_contents[username].websites[newContent.dns] = {
        estimated_size: contentSize,
        files: Object.keys(newContent.files),
        created: new Date().toISOString(),
        has_data_json: true
      };
      
      console.log(`✅ Added website to tracking: ${newContent.dns}`);
      
    } else if (contentType === 'zipwebsite') {
      // ZIP website goes to zipwebsites/
      const zipWebsiteDir = path.join(folderDir, 'zipwebsites', newContent.dns);
      console.log(`📦 Creating ZIP website: ${newContent.dns} at ${zipWebsiteDir}`);
      
      fs.mkdirSync(zipWebsiteDir, { recursive: true });
      
      // Copy all extracted files
      function copyDirectory(src, dest) {
        if (!fs.existsSync(src)) {
          throw new Error(`Source directory does not exist: ${src}`);
        }
        
        const items = fs.readdirSync(src);
        for (const item of items) {
          const srcPath = path.join(src, item);
          const destPath = path.join(dest, item);
          
          if (fs.statSync(srcPath).isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyDirectory(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      }
      
      if (!fs.existsSync(newContent.extractedPath)) {
        throw new Error(`Extracted path does not exist: ${newContent.extractedPath}`);
      }
      
      copyDirectory(newContent.extractedPath, zipWebsiteDir);
      console.log(`✅ Copied ZIP content to zipwebsites/${newContent.dns}`);
      
      // Update tracking - FIXED: folder_contents is now guaranteed to exist
      folder_contents[username].zipwebsites[newContent.dns] = {
        estimated_size: contentSize,
        files: newContent.filesList || [],
        created: new Date().toISOString(),
        original_filename: newContent.originalFilename,
        file_count: newContent.fileCount
      };
      
      console.log(`✅ Added ZIP website to tracking: ${newContent.dns}`);
      
    } else if (contentType === 'file') {
      // Regular file goes to files/
      const filePath = path.join(folderDir, 'files', newContent.filename);
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      
      if (newContent.encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(newContent.content, 'base64'));
      } else {
        fs.writeFileSync(filePath, newContent.content);
      }
      
      // Update tracking - FIXED: folder_contents is now guaranteed to exist
      folder_contents[username].files[newContent.filename] = {
        size: contentSize,
        type: newContent.type || 'unknown',
        created: new Date().toISOString()
      };
      
      console.log(`✅ Added file to tracking: ${newContent.filename}`);
    }
    
    // Log final tracking state
    console.log(`📊 Final folder_contents for ${username}:`, {
      files: Object.keys(folder_contents[username].files).length,
      websites: Object.keys(folder_contents[username].websites).length,
      zipwebsites: Object.keys(folder_contents[username].zipwebsites).length
    });
    
    // Verify final structure
    const finalWebsites = fs.existsSync(websitesDir) ? fs.readdirSync(websitesDir) : [];
    const finalZipWebsites = fs.existsSync(zipWebsitesDir) ? fs.readdirSync(zipWebsitesDir) : [];
    
    console.log(`🌐 Final template websites:`, finalWebsites);
    console.log(`📦 Final ZIP websites:`, finalZipWebsites);
    
    // Re-upload to IPFS
    console.log(`📤 Re-uploading folder to IPFS from: ${folderDir}`);
    const result = await execPromise(`ipfs add -r .`, folderDir);
    const lines = result.trim().split('\n');
    const newCID = lines[lines.length - 1].split(' ')[1];
    
    console.log(`✅ New CID: ${newCID}`);
    
    // Update tracking systems
    const oldCID = user_folders[username].cid;
    
    // Update user folder data
    user_folders[username].cid = newCID;
    user_folders[username].quota_used += contentSize;
    user_folders[username].updated = new Date().toISOString();
    
    // Track CID history
    if (!user_folder_cid_history) user_folder_cid_history = {};
    if (!user_folder_cid_history[username]) user_folder_cid_history[username] = [];
    
    const currentWebsites = Object.keys(folder_contents[username].websites || {});
    const currentZipWebsites = Object.keys(folder_contents[username].zipwebsites || {});
    const allWebsites = [...currentWebsites, ...currentZipWebsites];
    
    user_folder_cid_history[username].push({
      cid: newCID,
      previous_cid: oldCID,
      timestamp: new Date().toISOString(),
      action: contentType === 'zipwebsite' ? `Added ZIP website: ${newContent.dns}` : 
              contentType === 'website' ? `Added template website: ${newContent.dns}` : 
              `Added file: ${newContent.filename}`,
      websites: currentWebsites,
      zipwebsites: currentZipWebsites,
      total_websites: allWebsites,
      version: user_folder_cid_history[username].length + 1
    });
    
    // Create CID redirects
    if (!cid_redirects) cid_redirects = {};
    if (oldCID !== newCID) {
      cid_redirects[oldCID] = newCID;
    }
    
    // Update website CID mapping
    if (!website_cid_mapping) website_cid_mapping = {};
    allWebsites.forEach(websiteDns => {
      if (!website_cid_mapping[websiteDns]) {
        const isZipWebsite = currentZipWebsites.includes(websiteDns);
        website_cid_mapping[websiteDns] = {
          creation_folder_cid: newCID,
          path: isZipWebsite ? `zipwebsites/${websiteDns}` : `websites/${websiteDns}`
        };
      }
      website_cid_mapping[websiteDns].current_folder_cid = newCID;
      website_cid_mapping[websiteDns].last_updated = new Date().toISOString();
    });
    
    // Update counts
    if (contentType === 'website') {
      user_folders[username].websites_count = Object.keys(folder_contents[username].websites).length;
    } else if (contentType === 'zipwebsite') {
      user_folders[username].zipwebsites_count = Object.keys(folder_contents[username].zipwebsites).length;
    }
    user_folders[username].files_count = Object.keys(folder_contents[username].files || {}).length;
    
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    console.log(`📦 Successfully updated ${username} folder: ${oldCID} → ${newCID}`);
    console.log(`🌐 Template websites: ${currentWebsites.length}, ZIP websites: ${currentZipWebsites.length}`);
    
    return { oldCID, newCID, quotaUsed: user_folders[username].quota_used };
    
  } catch (err) {
    console.error(`❌ Error updating user folder:`, err);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw err;
  }
}

const DATA_FILE = path.join(__dirname, 'platform-data.json');

// function saveData() {
//   const data = {
//     dns_map,
//     user_directories,
//     cid_history,
//     file_ownership,
//     access_tokens,
//     user_folders,
//     folder_contents,
//     user_aliases,
//     user_folder_cid_history,
//     website_cid_mapping,
//     cid_redirects,
//     user_credentials,  // ADD THIS
//     timestamp: new Date().toISOString()
//   };
//   fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
// }

function saveData() {
  const data = {
    dns_map,
    user_directories,
    cid_history,
    file_ownership,
    access_tokens,
    user_folders,
    folder_contents,        // Now includes zipwebsites tracking
    user_aliases,
    user_folder_cid_history,
    website_cid_mapping,
    cid_redirects,
    user_credentials,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE));
      dns_map = data.dns_map || {};
      user_directories = data.user_directories || {};
      cid_history = data.cid_history || {};
      file_ownership = data.file_ownership || {};
      access_tokens = data.access_tokens || {};
      user_folders = data.user_folders || {};
      folder_contents = data.folder_contents || {};
      user_aliases = data.user_aliases || {};
      user_folder_cid_history = data.user_folder_cid_history || {};
      website_cid_mapping = data.website_cid_mapping || {};
      cid_redirects = data.cid_redirects || {};
      user_credentials = data.user_credentials || {};  // ADD THIS
      console.log('📊 Data loaded from storage');
    }
  } catch (err) {
    console.error('❌ Failed to load data:', err.message);
  }
}

function validateUser(token) {
  const auth = access_tokens[token];
  if (!auth || auth.expires < Date.now()) {
    return null;
  }
  return {
    userId: auth.userId,
    alias: auth.alias,
    permissions: auth.permissions
  };
}

function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function execPromise(command, cwd = undefined) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function getIPFSTree(cid, depth = 0, maxDepth = 10) {
  if (depth > maxDepth) return cid;
  
  const tree = {};
  try {
    const result = await execAsync(`ipfs ls ${cid}`);
    const lines = result.stdout.trim().split('\n');
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      
      const fileCID = parts[0];
      const fileName = parts[2];
      
      try {
        const subTree = await getIPFSTree(fileCID, depth + 1, maxDepth);
        tree[fileName] = subTree;
      } catch (err) {
        tree[fileName] = fileCID;
      }
    }
    return tree;
  } catch (err) {
    return cid;
  }
}

function startIPFS() {
  return new Promise((resolve, reject) => {
    console.log("🧹 Running: ipfs repo gc");
    exec("ipfs repo gc", (gcErr) => {
      if (gcErr) console.warn("⚠️ GC warning:", gcErr.message);
      
      console.log("🚀 Starting IPFS daemon...");
      ipfsDaemon = spawn("ipfs", ["daemon"]);
      
      let started = false;
      ipfsDaemon.stdout.on('data', data => {
        const output = data.toString();
        console.log(`📡 IPFS: ${output}`);
        if (output.includes('Daemon is ready') && !started) {
          started = true;
          resolve();
        }
      });
      
      ipfsDaemon.stderr.on('data', data => {
        console.error(`❌ IPFS ERR: ${data.toString()}`);
      });
      
      // Fallback timeout
      setTimeout(() => {
        if (!started) {
          started = true;
          resolve();
        }
      }, 5000);
    });
  });
}

function stopIPFS() {
  return new Promise(resolve => {
    if (ipfsDaemon) {
      ipfsDaemon.kill('SIGINT');
      ipfsDaemon = null;
      setTimeout(resolve, 1000);
    } else {
      resolve();
    }
  });
}

// ========== Authentication Middleware ==========
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const userInfo = validateUser(token);  // Changed from 'auth' to 'userInfo'
  
  if (!userInfo) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.userId = userInfo.userId;
  req.userAlias = userInfo.alias;
  req.userPermissions = userInfo.permissions;
  next();
}


app.post('/auth/register', async (req, res) => {
  const { alias, password } = req.body;  // ADD password
  
  // Validate alias
  if (!alias || alias.length < 3) {
    return res.status(400).json({ error: 'Alias must be at least 3 characters long' });
  }
  
  // Validate password
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }
  
  // Check alias format
  const aliasRegex = /^[a-zA-Z0-9_-]+$/;
  if (!aliasRegex.test(alias)) {
    return res.status(400).json({ 
      error: 'Alias can only contain letters, numbers, hyphens, and underscores' 
    });
  }
  
  // Check if alias already exists
  if (user_folders[alias]) {
    return res.status(409).json({ 
      error: 'Alias already taken. Please choose a different one.' 
    });
  }
  
  try {
    // Generate user credentials
    const userId = generateUserId();
    const token = generateToken();
    
    // Hash password (simple hash - in production use bcrypt)
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    // Create user folder on IPFS
    const folderCID = await createUserFolder(alias);
    
    // Store authentication data WITH password hash
    access_tokens[token] = {
      userId,
      alias,
      permissions: ['read', 'write', 'upload'],
      expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
    };
    
    // Initialize user directory
    user_directories[userId] = { 
      alias,
      dns: [], 
      files: {} 
    };
    
    // Store user credentials with password
    if (!user_credentials) user_credentials = {};
    user_credentials[alias] = {
      userId,
      passwordHash: hashedPassword,
      created: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    // Initialize user folder mapping
    user_aliases[alias] = userId;
    
    saveData();
    
    res.json({
      success: true,
      userId,
      alias,
      token,
      userFolder: {
        cid: user_folders[alias].cid,
        quota_used: user_folders[alias].quota_used,
        quota_limit: user_folders[alias].quota_limit,
        quota_available: user_folders[alias].quota_limit - user_folders[alias].quota_used,
        gateway_url: `http://localhost:8080/ipfs/${user_folders[alias].cid}`,
        platform_url: `http://localhost:3000/user-folder/${alias}`
      },
      message: `Welcome ${alias}! Your IPFS folder has been created.`
    });
    
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ 
      error: 'Failed to create user account: ' + err.message 
    });
  }
});

app.post('/auth/login', async (req, res) => {
  const { alias, password } = req.body;
  
  if (!alias || !password) {
    return res.status(400).json({ error: 'Alias and password are required' });
  }
  
  try {
    // Check if user exists
    if (!user_credentials || !user_credentials[alias]) {
      return res.status(401).json({ error: 'Invalid alias or password' });
    }
    
    const userCreds = user_credentials[alias];
    
    // Verify password
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    if (userCreds.passwordHash !== hashedPassword) {
      return res.status(401).json({ error: 'Invalid alias or password' });
    }
    
    // Generate new token
    const token = generateToken();
    const userId = userCreds.userId;
    
    // Store new token
    access_tokens[token] = {
      userId,
      alias,
      permissions: ['read', 'write', 'upload'],
      expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
    };
    
    // Update last login
    user_credentials[alias].lastLogin = new Date().toISOString();
    
    saveData();
    
    // Get user folder info
    const userFolder = user_folders[alias];
    const folderContents = folder_contents[alias];
    const userSites = user_directories[userId]?.dns || [];
    
    res.json({
      success: true,
      userId,
      alias,
      token,
      userFolder: {
        cid: userFolder.cid,
        quota_used: userFolder.quota_used,
        quota_limit: userFolder.quota_limit,
        quota_available: userFolder.quota_limit - userFolder.quota_used,
        gateway_url: `http://localhost:8080/ipfs/${userFolder.cid}`,
        platform_url: `http://localhost:3000/user-folder/${alias}`
      },
      stats: {
        websites_count: userSites.length,
        total_files: Object.keys(folderContents?.files || {}).length,
        last_login: user_credentials[alias].lastLogin,
        member_since: user_credentials[alias].created
      },
      message: `Welcome back, ${alias}!`
    });
    
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ 
      error: 'Login failed: ' + err.message 
    });
  }
});

app.post('/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const alias = req.userAlias;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long' });
  }
  
  try {
    if (!user_credentials || !user_credentials[alias]) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify current password
    const currentHashed = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (user_credentials[alias].passwordHash !== currentHashed) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Update password
    const newHashed = crypto.createHash('sha256').update(newPassword).digest('hex');
    user_credentials[alias].passwordHash = newHashed;
    user_credentials[alias].passwordChanged = new Date().toISOString();
    
    saveData();
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
    
  } catch (err) {
    console.error('Password change error:', err);
    return res.status(500).json({ 
      error: 'Password change failed: ' + err.message 
    });
  }
});

app.post('/command', requireAuth, async (req, res) => {
  const { cmd, args = {} } = req.body;
  const userId = req.userId;

  try {
    switch (cmd) {
      case 'start-ipfs': {
        await stopIPFS();
        await startIPFS();
        return res.json({ status: 'IPFS restarted successfully' });
      }

      case 'upload-webapp': {
        const { files, dns, metadata = {} } = args;
        
        if (dns_map[dns] && dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'DNS name already taken by another user' });
        }

        // Create temporary directory
        const tempDir = path.join(__dirname, 'temp', `webapp-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        // Ensure data directory exists
        const dataDir = path.join(tempDir, 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        // Write all files
        for (const [filename, content] of Object.entries(files)) {
          const filePath = path.join(tempDir, filename);
          const fileDir = path.dirname(filePath);
          fs.mkdirSync(fileDir, { recursive: true });
          
          if (typeof content === 'string') {
            fs.writeFileSync(filePath, content);
          } else {
            fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
          }
          
          file_ownership[filename] = userId;
        }

        // IMPORTANT: Always create data.json file even if not provided
        const dataJsonPath = path.join(tempDir, 'data', 'data.json');
        if (!fs.existsSync(dataJsonPath)) {
          const defaultData = {
            template: metadata.template || 'custom',
            userData: metadata.userData || {},
            owner: userId,
            created: new Date().toISOString(),
            version: '1.0',
            dns: dns,
            type: 'webapp'
          };
          fs.writeFileSync(dataJsonPath, JSON.stringify(defaultData, null, 2));
        }

        // Add metadata
        const metaPath = path.join(tempDir, 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify({
          ...metadata,
          owner: userId,
          created: new Date().toISOString(),
          type: 'webapp',
          has_data_json: true
        }, null, 2));

        // Upload to IPFS
        const result = await execPromise(`ipfs add -r .`, tempDir);
        const lines = result.trim().split('\n');
        const cid = lines[lines.length - 1].split(' ')[1];

        // Update mappings
        const oldCID = dns_map[dns]?.cid;
        dns_map[dns] = {
          cid,
          owner: userId,
          created: dns_map[dns]?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
          type: 'webapp'
        };

        if (!cid_history[dns]) cid_history[dns] = [];
        cid_history[dns].push({
          cid,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1
        });

        if (!user_directories[userId].dns.includes(dns)) {
          user_directories[userId].dns.push(dns);
        }

        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        saveData();

        return res.json({ dns, cid, oldCID, version: cid_history[dns].length });
      }

      case 'upload-file': {
        const { filename, content, dns, encoding = 'utf8' } = args;
      
        if (!dns_map[dns]) {
          return res.status(404).json({ error: 'DNS not found' });
        }
        
        console.log(`🌐 Public file update: ${filename} on ${dns}`);
      
        // Get current webapp content
        const currentCID = dns_map[dns].cid;
        const tempDir = path.join(__dirname, 'temp', `update-${Date.now()}`);
        
        // Download current content
        await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
        const webappDir = path.join(tempDir, currentCID);
        
        // Update or add the file
        const filePath = path.join(webappDir, filename);
        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        
        if (encoding === 'base64') {
          fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
        } else {
          fs.writeFileSync(filePath, content);
        }
      
        // Re-upload to IPFS
        const result = await execPromise(`ipfs add -r .`, webappDir);
        const lines = result.trim().split('\n');
        const newCID = lines[lines.length - 1].split(' ')[1];
      
        // Update DNS mapping to new CID
        dns_map[dns].cid = newCID;
        dns_map[dns].updated = new Date().toISOString();
        
        // Track version history
        cid_history[dns].push({
          cid: newCID,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: `Updated file: ${filename}`
        });
      
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        saveData();
      
        return res.json({ 
          dns, 
          filename, 
          newCID, 
          oldCID: currentCID,
          version: cid_history[dns].length 
        });
      }

      case 'delete-file': {
        const { filename, dns } = args;
        
        if (!dns_map[dns] || dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'You do not own this DNS or it does not exist' });
        }

        if (file_ownership[filename] !== userId) {
          return res.status(403).json({ error: 'You do not own this file' });
        }

        // Similar process as upload-file but remove the file instead
        const currentCID = dns_map[dns].cid;
        const tempDir = path.join(__dirname, 'temp', `delete-${Date.now()}`);
        
        await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
        const webappDir = path.join(tempDir, currentCID);
        const filePath = path.join(webappDir, filename);
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        const result = await execPromise(`ipfs add -r .`, webappDir);
        const lines = result.trim().split('\n');
        const newCID = lines[lines.length - 1].split(' ')[1];

        dns_map[dns].cid = newCID;
        dns_map[dns].updated = new Date().toISOString();
        
        cid_history[dns].push({
          cid: newCID,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: `Deleted file: ${filename}`
        });

        delete user_directories[userId].files[filename];
        delete file_ownership[filename];

        fs.rmSync(tempDir, { recursive: true, force: true });
        saveData();

        return res.json({ dns, filename, newCID, deleted: true });
      }

      // case 'list-user-sites': {
      //   // Get user's sites from both old system and new folder system
      //   const userSites = user_directories[req.userId]?.dns || [];
      //   const allSites = [];
        
      //   console.log('Loading sites for user:', req.userId, 'alias:', req.userAlias);
        
      //   // Process all user sites
      //   userSites.forEach(dns => {
      //     const site = dns_map[dns];
      //     if (!site) return;
          
      //     if (site.type === 'user-folder-website' && site.user_folder === req.userAlias) {
      //       // User folder website - get current folder CID
      //       const currentFolderCID = user_folders[req.userAlias]?.cid;
      //       allSites.push({
      //         dns,
      //         cid: currentFolderCID, // Current folder CID
      //         type: site.type,
      //         created: site.created,
      //         updated: site.updated,
      //         owner: site.owner,
      //         versions: cid_history[dns]?.length || 1,
      //         in_user_folder: true,
      //         folder_path: site.folder_path,
      //         website_url: `https://uservault.trustgrid.com/ipfs/${currentFolderCID}/${site.folder_path}`,
      //         platform_url: `https://synqstorage.trustgrid.com/site/${dns}`
      //       });
      //     } else {
      //       // Traditional direct website
      //       allSites.push({
      //         dns,
      //         cid: site.cid,
      //         type: site.type,
      //         created: site.created,
      //         updated: site.updated,
      //         owner: site.owner,
      //         versions: cid_history[dns]?.length || 1,
      //         in_user_folder: false,
      //         website_url: `https://uservault.trustgrid.com/ipfs/${site.cid}`,
      //         platform_url: `https://synqstorage.trustgrid.com/site/${dns}`
      //       });
      //     }
      //   });
  
      //   console.log('Total sites found:', allSites.length);
        
      //   return res.json({ 
      //     sites: allSites, 
      //     total: allSites.length,
      //     user_alias: req.userAlias,
      //     folder_cid: user_folders[req.userAlias]?.cid
      //   });
      // }

      case 'list-user-sites': {
        try {
          const userId = req.userId;
          const userAlias = req.userAlias;
          
          console.log('Loading sites for user:', userId, 'alias:', userAlias);
          
          // Get user's sites from user directories
          const userSites = user_directories[userId]?.dns || [];
          console.log('User sites from directories:', userSites);
          
          const allSites = [];
          
          // Get current folder info
          const currentFolderCID = user_folders[userAlias]?.cid;
          const folderContents = folder_contents[userAlias] || { websites: {}, zipwebsites: {} };
          
          console.log('Current folder CID:', currentFolderCID);
          console.log('Folder contents:', {
            websites: Object.keys(folderContents.websites || {}),
            zipwebsites: Object.keys(folderContents.zipwebsites || {})
          });
          
          // Process all user sites and categorize them
          userSites.forEach(dns => {
            const site = dns_map[dns];
            if (!site) {
              console.log(`⚠️ Site ${dns} found in user directory but not in DNS mapping`);
              return;
            }
            
            console.log(`Processing site: ${dns}, type: ${site.type}`);
            
            // Determine site type and build site info
            let siteInfo = {
              dns,
              owner: site.owner,
              created: site.created,
              updated: site.updated,
              versions: cid_history[dns]?.length || 1
            };
            
            if (site.type === 'user-folder-website') {
              // Template website in user folder
              siteInfo = {
                ...siteInfo,
                type: 'template-website',
                cid: currentFolderCID,
                in_user_folder: true,
                folder_path: site.folder_path || `websites/${dns}`,
                website_url: `https://uservault.trustgrid.com/ipfs/${currentFolderCID}/websites/${dns}`,
                platform_url: `https://synqstorage.trustgrid.com/site/${dns}`,
                storage_location: 'User Folder (Template)',
                folder_info: folderContents.websites[dns] || null
              };
              
            } else if (site.type === 'user-folder-zipwebsite') {
              // ZIP website in user folder
              siteInfo = {
                ...siteInfo,
                type: 'zip-website',
                cid: currentFolderCID,
                in_user_folder: true,
                folder_path: site.folder_path || `zipwebsites/${dns}`,
                website_url: `https://uservault.trustgrid.com/ipfs/${currentFolderCID}/zipwebsites/${dns}`,
                platform_url: `https://synqstorage.trustgrid.com/site/${dns}`,
                storage_location: 'User Folder (ZIP)',
                original_filename: site.original_filename,
                file_count: site.file_count,
                folder_info: folderContents.zipwebsites[dns] || null
              };
              
            } else if (site.type === 'webapp-zip') {
              // Legacy direct ZIP website
              siteInfo = {
                ...siteInfo,
                type: 'legacy-zip',
                cid: site.cid,
                in_user_folder: false,
                website_url: `https://uservault.trustgrid.com/ipfs/${site.cid}`,
                platform_url: `https://synqstorage.trustgrid.com/site/${dns}`,
                storage_location: 'Direct IPFS',
                original_filename: site.original_filename,
                file_count: site.fileCount
              };
              
            } else {
              // Traditional direct website
              siteInfo = {
                ...siteInfo,
                type: 'direct-website',
                cid: site.cid,
                in_user_folder: false,
                website_url: `https://uservault.trustgrid.com/ipfs/${site.cid}`,
                platform_url: `https://synqstorage.trustgrid.com/site/${dns}`,
                storage_location: 'Direct IPFS'
              };
            }
            
            allSites.push(siteInfo);
          });
          
          // Sort sites by creation date (newest first)
          allSites.sort((a, b) => new Date(b.created) - new Date(a.created));
          
          // Generate summary statistics
          const summary = {
            total_sites: allSites.length,
            template_websites: allSites.filter(s => s.type === 'template-website').length,
            zip_websites: allSites.filter(s => s.type === 'zip-website').length,
            legacy_sites: allSites.filter(s => s.type === 'legacy-zip' || s.type === 'direct-website').length,
            in_user_folder: allSites.filter(s => s.in_user_folder).length,
            direct_ipfs: allSites.filter(s => !s.in_user_folder).length
          };
          
          console.log('Site summary:', summary);
          
          return res.json({ 
            sites: allSites, 
            total: allSites.length,
            summary,
            user_info: {
              user_id: userId,
              alias: userAlias,
              folder_cid: currentFolderCID
            },
            folder_structure: {
              websites: Object.keys(folderContents.websites || {}),
              zipwebsites: Object.keys(folderContents.zipwebsites || {}),
              files: Object.keys(folderContents.files || {})
            }
          });
          
        } catch (err) {
          console.error('Error listing user sites:', err);
          return res.status(500).json({ error: 'Failed to list sites: ' + err.message });
        }
      }

      case 'get-site-history': {
        const { dns } = args;
        
        if (!dns_map[dns] || dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        return res.json({
          dns,
          current: dns_map[dns],
          history: cid_history[dns] || []
        });
      }

      case 'rollback-version': {
        const { dns, version } = args;
        
        if (!dns_map[dns] || dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const history = cid_history[dns];
        if (!history || version < 1 || version > history.length) {
          return res.status(400).json({ error: 'Invalid version' });
        }

        const targetVersion = history[version - 1];
        dns_map[dns].cid = targetVersion.cid;
        dns_map[dns].updated = new Date().toISOString();
        
        cid_history[dns].push({
          cid: targetVersion.cid,
          timestamp: new Date().toISOString(),
          version: history.length + 1,
          action: `Rolled back to version ${version}`
        });

        saveData();
        return res.json({ dns, rolledBackTo: version, newCID: targetVersion.cid });
      }

      case 'create-user-folder': {
        const { username } = args;
        
        if (!username || username.length < 3) {
          return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }
        
        if (user_folders[username]) {
          return res.status(400).json({ error: 'User folder already exists' });
        }
        
        try {
          const cid = await createUserFolder(username);
          saveData();
          
          return res.json({
            username,
            cid,
            quota_limit: '10MB',
            quota_used: '1KB',
            gateway_url: `http://localhost:8080/ipfs/${cid}`,
            message: 'User folder created successfully'
          });
        } catch (err) {
          return res.status(500).json({ error: 'Failed to create user folder: ' + err.message });
        }
      }

      case 'get-user-folder': {
        const { username } = args;
        
        if (!user_folders[username]) {
          return res.status(404).json({ error: 'User folder not found' });
        }
        
        const folder = user_folders[username];
        const contents = folder_contents[username];
        
        return res.json({
          username,
          cid: folder.cid,
          quota_used: folder.quota_used,
          quota_limit: folder.quota_limit,
          quota_available: folder.quota_limit - folder.quota_used,
          quota_percentage: ((folder.quota_used / folder.quota_limit) * 100).toFixed(2),
          created: folder.created,
          updated: folder.updated,
          contents: contents,
          gateway_url: `http://localhost:8080/ipfs/${folder.cid}`
        });
      }

      // case 'get-user-folder-info': {
      //   if (!req.userAlias || !user_folders[req.userAlias]) {
      //     return res.status(404).json({ error: 'User folder not found' });
      //   }
        
      //   const folder = user_folders[req.userAlias];
      //   const contents = folder_contents[req.userAlias] || { files: {}, websites: {} };
        
      //   return res.json({
      //     alias: req.userAlias,
      //     folder: {
      //       cid: folder.cid,
      //       quota_used: folder.quota_used,
      //       quota_limit: folder.quota_limit,
      //       quota_available: folder.quota_limit - folder.quota_used,
      //       quota_percentage: ((folder.quota_used / folder.quota_limit) * 100).toFixed(2),
      //       created: folder.created,
      //       updated: folder.updated
      //     },
      //     contents: {
      //       files: contents.files,
      //       websites: contents.websites,
      //       files_count: Object.keys(contents.files).length,
      //       websites_count: Object.keys(contents.websites).length
      //     },
      //     gateway_url: `http://localhost:8080/ipfs/${folder.cid}`,
      //     platform_url: `http://localhost:3000/user-folder/${req.userAlias}`
      //   });
      // }

      case 'get-user-folder-info': {
        if (!req.userAlias || !user_folders[req.userAlias]) {
          return res.status(404).json({ error: 'User folder not found' });
        }
        
        try {
          const alias = req.userAlias;
          const folder = user_folders[alias];
          const contents = folder_contents[alias] || { files: {}, websites: {}, zipwebsites: {} };
          
          // Calculate actual storage usage
          let actualQuotaUsed = 0;
          
          // Count files
          Object.values(contents.files || {}).forEach(file => {
            actualQuotaUsed += file.size || 0;
          });
          
          // Count template websites (estimate)
          Object.values(contents.websites || {}).forEach(website => {
            actualQuotaUsed += website.estimated_size || 0;
          });
          
          // Count ZIP websites (estimate)
          Object.values(contents.zipwebsites || {}).forEach(zipwebsite => {
            actualQuotaUsed += zipwebsite.estimated_size || 0;
          });
          
          // Update the actual quota if it's different
          if (Math.abs(folder.quota_used - actualQuotaUsed) > 1024) { // More than 1KB difference
            folder.quota_used = actualQuotaUsed;
            user_folders[alias].quota_used = actualQuotaUsed;
            console.log(`🔧 Updated quota for ${alias}: ${actualQuotaUsed} bytes`);
          }
          
          // Get counts
          const filesCount = Object.keys(contents.files || {}).length;
          const websitesCount = Object.keys(contents.websites || {}).length;
          const zipWebsitesCount = Object.keys(contents.zipwebsites || {}).length;
          const totalWebsites = websitesCount + zipWebsitesCount;
          
          // Update folder counts
          user_folders[alias].files_count = filesCount;
          user_folders[alias].websites_count = websitesCount;
          user_folders[alias].zipwebsites_count = zipWebsitesCount;
          
          return res.json({
            alias,
            folder: {
              cid: folder.cid,
              quota_used: folder.quota_used,
              quota_limit: folder.quota_limit,
              quota_available: folder.quota_limit - folder.quota_used,
              quota_percentage: ((folder.quota_used / folder.quota_limit) * 100).toFixed(2),
              created: folder.created,
              updated: folder.updated
            },
            contents: {
              files: contents.files || {},
              websites: contents.websites || {},
              zipwebsites: contents.zipwebsites || {},
              files_count: filesCount,
              websites_count: websitesCount,
              zipwebsites_count: zipWebsitesCount,
              total_websites: totalWebsites
            },
            summary: {
              total_items: filesCount + totalWebsites,
              template_websites: websitesCount,
              zip_websites: zipWebsitesCount,
              regular_files: filesCount,
              storage_used_mb: (folder.quota_used / 1024 / 1024).toFixed(2),
              storage_available_mb: ((folder.quota_limit - folder.quota_used) / 1024 / 1024).toFixed(2)
            },
            urls: {
              gateway_url: `https://uservault.trustgrid.com/ipfs/${folder.cid}`,
              platform_url: `https://synqstorage.trustgrid.com/user-folder/${alias}`,
              websites_folder: `https://uservault.trustgrid.com/ipfs/${folder.cid}/websites`,
              zipwebsites_folder: `https://uservault.trustgrid.com/ipfs/${folder.cid}/zipwebsites`,
              files_folder: `https://uservault.trustgrid.com/ipfs/${folder.cid}/files`
            }
          });
          
        } catch (err) {
          console.error('Error getting user folder info:', err);
          return res.status(500).json({ error: 'Failed to get folder info: ' + err.message });
        }
      }

      case 'upload-to-user-folder': {
        const { username, type, content } = args;
        
        // Verify user owns this folder
        if (username !== req.userAlias) {
          return res.status(403).json({ error: 'Access denied to this folder' });
        }
        
        if (!user_folders[username]) {
          return res.status(404).json({ error: 'User folder not found. Please contact support.' });
        }
        
        // Estimate content size
        let contentSize = 0;
        if (type === 'website') {
          Object.values(content.files).forEach(fileContent => {
            contentSize += typeof fileContent === 'string' ? 
              Buffer.byteLength(fileContent, 'utf8') : 
              Buffer.byteLength(fileContent, 'base64');
          });
        }
        
        try {
          const result = await updateUserFolder(username, content, type, contentSize);
          
          // Handle website DNS mapping with proper tracking
          if (type === 'website' && content.dns) {
            const websitePath = `websites/${content.dns}`;
            
            // Store DNS mapping with user folder reference
            dns_map[content.dns] = {
              type: 'user-folder-website',
              user_folder: username,
              folder_path: websitePath,
              owner: req.userId,
              created: dns_map[content.dns]?.created || new Date().toISOString(),
              updated: new Date().toISOString()
            };
            
            // Add to cid history with proper tracking
            if (!cid_history[content.dns]) cid_history[content.dns] = [];
            cid_history[content.dns].push({
              folder_cid: result.newCID,
              previous_folder_cid: result.oldCID,
              timestamp: new Date().toISOString(),
              version: cid_history[content.dns].length + 1,
              action: 'Created/Updated in user folder',
              path: websitePath
            });
            
            // Add to user directory
            if (!user_directories[req.userId].dns.includes(content.dns)) {
              user_directories[req.userId].dns.push(content.dns);
            }
            
            console.log(`✅ Website ${content.dns} created in folder ${username}`);
            console.log(`📂 Current folder CID: ${result.newCID}`);
            console.log(`🔗 Website URL: https://uservault.trustgrid.com/ipfs/${result.newCID}/${websitePath}`);
          }
          
          saveData();
          
          return res.json({
            username,
            type,
            oldCID: result.oldCID,
            newCID: result.newCID,
            quota_used: result.quotaUsed,
            quota_available: user_folders[username].quota_limit - result.quotaUsed,
            website_url: type === 'website' ? 
              `https://uservault.trustgrid.com/ipfs/${result.newCID}/websites/${content.dns}` : null,
            folder_url: `https://uservault.trustgrid.com/ipfs/${result.newCID}`,
            cid_redirects_count: Object.keys(cid_redirects).length,
            message: `${type} uploaded to user folder successfully`
          });
          
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      case 'edit-user-folder-website': {
        const { dns, content } = args;
        
        const site = dns_map[dns];
        if (!site || site.type !== 'user-folder-website') {
          return res.status(404).json({ error: 'User folder website not found' });
        }
        
        if (site.user_folder !== req.userAlias) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        try {
          // Get current folder
          const currentFolderCID = user_folders[req.userAlias].cid;
          const tempDir = path.join(__dirname, 'temp', `edit-${req.userAlias}-${Date.now()}`);
          
          // Download current folder
          await execPromise(`ipfs get ${currentFolderCID} -o ${tempDir}`);
          const folderDir = path.join(tempDir, currentFolderCID);
          
          // Update the specific website's data.json
          const websiteDir = path.join(folderDir, site.folder_path);
          const dataJsonPath = path.join(websiteDir, 'data', 'data.json');
          
          // Ensure data directory exists
          fs.mkdirSync(path.dirname(dataJsonPath), { recursive: true });
          
          // Write updated content
          fs.writeFileSync(dataJsonPath, content);
          
          // Re-upload folder
          const result = await execPromise(`ipfs add -r .`, folderDir);
          const lines = result.trim().split('\n');
          const newFolderCID = lines[lines.length - 1].split(' ')[1];
          
          // Update user folder CID
          user_folders[req.userAlias].cid = newFolderCID;
          user_folders[req.userAlias].updated = new Date().toISOString();
          
          // Update DNS mapping with new folder CID reference
          dns_map[dns].current_folder_cid = newFolderCID;
          dns_map[dns].updated = new Date().toISOString();
          
          // Add to history
          cid_history[dns].push({
            folder_cid: newFolderCID,
            timestamp: new Date().toISOString(),
            version: cid_history[dns].length + 1,
            action: 'Data edited',
            path: site.folder_path
          });
          
          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });
          saveData();
          
          return res.json({
            dns,
            newFolderCID,
            website_url: `https://uservault.trustgrid.com/ipfs/${newFolderCID}/${site.folder_path}`,
            message: 'Website data updated successfully'
          });
          
        } catch (err) {
          return res.status(500).json({ error: 'Failed to update website: ' + err.message });
        }
      }

      case 'edit-website-data': {
        const { dns, dataContent } = args;
        
        if (!dns || !dataContent) {
          return res.status(400).json({ error: 'DNS and data content are required' });
        }
        
        // Check if website exists and user owns it
        const site = dns_map[dns];
        if (!site) {
          return res.status(404).json({ error: 'Website not found' });
        }
        
        if (site.type === 'user-folder-website' && site.user_folder !== req.userAlias) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        if (site.owner !== req.userId) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        try {
          console.log(`✏️ Editing data for website: ${dns}`);
          
          // Validate JSON content
          try {
            JSON.parse(dataContent);
          } catch (err) {
            return res.status(400).json({ error: 'Invalid JSON format' });
          }
          
          if (site.type === 'user-folder-website') {
            // Handle user folder website
            const username = site.user_folder;
            const currentCID = user_folders[username].cid;
            const tempDir = path.join(__dirname, 'temp', `edit-${username}-${Date.now()}`);
            
            try {
              // Download current folder
              fs.mkdirSync(tempDir, { recursive: true });
              await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
              
              // Find the actual content directory
              let folderDir;
              const tempContents = fs.readdirSync(tempDir);
              
              if (tempContents.includes(currentCID)) {
                folderDir = path.join(tempDir, currentCID);
              } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
                folderDir = path.join(tempDir, tempContents[0]);
              } else {
                folderDir = tempDir;
              }
              
              // Find the specific website directory
              const websiteDir = path.join(folderDir, 'websites', dns);
              if (!fs.existsSync(websiteDir)) {
                throw new Error(`Website directory not found: websites/${dns}`);
              }
              
              // Check what files exist in the website
              const existingFiles = [];
              function scanWebsiteFiles(dir, relativePath = '') {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                  const itemPath = path.join(dir, item);
                  const relPath = path.join(relativePath, item).replace(/\\/g, '/');
                  
                  if (fs.statSync(itemPath).isDirectory()) {
                    scanWebsiteFiles(itemPath, relPath);
                  } else {
                    existingFiles.push(relPath);
                  }
                }
              }
              
              scanWebsiteFiles(websiteDir);
              console.log(`📄 Existing files in website:`, existingFiles);
              
              // Update ONLY the data.json file
              const dataJsonPath = path.join(websiteDir, 'data', 'data.json');
              if (!fs.existsSync(path.dirname(dataJsonPath))) {
                fs.mkdirSync(path.dirname(dataJsonPath), { recursive: true });
              }
              
              // Write updated data.json
              fs.writeFileSync(dataJsonPath, dataContent);
              console.log(`✅ Updated data.json for ${dns}`);
              
              // Verify all files still exist after edit
              const filesAfterEdit = [];
              scanWebsiteFiles(websiteDir);
              console.log(`📄 Files after edit:`, filesAfterEdit);
              
              // Re-upload entire folder
              console.log(`📤 Re-uploading folder after data edit...`);
              const result = await execPromise(`ipfs add -r .`, folderDir);
              const lines = result.trim().split('\n');
              const newCID = lines[lines.length - 1].split(' ')[1];
              
              // Update user folder CID
              const oldCID = user_folders[username].cid;
              user_folders[username].cid = newCID;
              user_folders[username].updated = new Date().toISOString();
              
              // Update website CID mapping
              if (website_cid_mapping && website_cid_mapping[dns]) {
                website_cid_mapping[dns].current_folder_cid = newCID;
                website_cid_mapping[dns].last_updated = new Date().toISOString();
              }
              
              // Add to history
              if (!user_folder_cid_history) user_folder_cid_history = {};
              if (!user_folder_cid_history[username]) user_folder_cid_history[username] = [];
              
              user_folder_cid_history[username].push({
                cid: newCID,
                previous_cid: oldCID,
                timestamp: new Date().toISOString(),
                action: `Edited data for website: ${dns}`,
                websites: Object.keys(folder_contents[username]?.websites || {}),
                version: user_folder_cid_history[username].length + 1
              });
              
              // Update CID redirects
              if (!cid_redirects) cid_redirects = {};
              cid_redirects[oldCID] = newCID;
              
              // Cleanup
              fs.rmSync(tempDir, { recursive: true, force: true });
              saveData();
              
              return res.json({
                success: true,
                dns,
                old_folder_cid: oldCID,
                new_folder_cid: newCID,
                website_url: `https://uservault.trustgrid.com/ipfs/${newCID}/websites/${dns}`,
                existing_files_preserved: existingFiles,
                message: 'Website data updated successfully - all files preserved'
              });
              
            } catch (err) {
              if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
              }
              throw err;
            }
            
          } else {
            // Handle direct IPFS website (traditional)
            const currentCID = site.cid;
            const tempDir = path.join(__dirname, 'temp', `edit-direct-${Date.now()}`);
            
            try {
              // Download current website
              fs.mkdirSync(tempDir, { recursive: true });
              await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
              
              // Find the actual content directory
              let websiteDir;
              const tempContents = fs.readdirSync(tempDir);
              
              if (tempContents.includes(currentCID)) {
                websiteDir = path.join(tempDir, currentCID);
              } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
                websiteDir = path.join(tempDir, tempContents[0]);
              } else {
                websiteDir = tempDir;
              }
              
              // Check existing files
              const existingFiles = [];
              function scanFiles(dir, relativePath = '') {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                  const itemPath = path.join(dir, item);
                  const relPath = path.join(relativePath, item).replace(/\\/g, '/');
                  
                  if (fs.statSync(itemPath).isDirectory()) {
                    scanFiles(itemPath, relPath);
                  } else {
                    existingFiles.push(relPath);
                  }
                }
              }
              
              scanFiles(websiteDir);
              console.log(`📄 Existing files in direct website:`, existingFiles);
              
              // Update data.json
              const dataJsonPath = path.join(websiteDir, 'data', 'data.json');
              if (!fs.existsSync(path.dirname(dataJsonPath))) {
                fs.mkdirSync(path.dirname(dataJsonPath), { recursive: true });
              }
              
              fs.writeFileSync(dataJsonPath, dataContent);
              console.log(`✅ Updated data.json for direct website ${dns}`);
              
              // Re-upload website
              const result = await execPromise(`ipfs add -r .`, websiteDir);
              const lines = result.trim().split('\n');
              const newCID = lines[lines.length - 1].split(' ')[1];
              
              // Update DNS mapping
              const oldCID = site.cid;
              dns_map[dns].cid = newCID;
              dns_map[dns].updated = new Date().toISOString();
              
              // Add to history
              if (!cid_history[dns]) cid_history[dns] = [];
              cid_history[dns].push({
                cid: newCID,
                timestamp: new Date().toISOString(),
                version: cid_history[dns].length + 1,
                action: 'Data edited'
              });
              
              // Cleanup
              fs.rmSync(tempDir, { recursive: true, force: true });
              saveData();
              
              return res.json({
                success: true,
                dns,
                old_cid: oldCID,
                new_cid: newCID,
                website_url: `https://uservault.trustgrid.com/ipfs/${newCID}`,
                existing_files_preserved: existingFiles,
                message: 'Direct website data updated successfully'
              });
              
            } catch (err) {
              if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
              }
              throw err;
            }
          }
          
        } catch (err) {
          console.error(`❌ Error editing website data:`, err);
          return res.status(500).json({ error: 'Failed to edit website: ' + err.message });
        }
      }

      case 'get-website-data': {
        const { dns } = args;
        
        if (!dns) {
          return res.status(400).json({ error: 'DNS required' });
        }
        
        const site = dns_map[dns];
        if (!site) {
          return res.status(404).json({ error: 'Website not found' });
        }
        
        try {
          let dataContent = null;
          let websiteInfo = {};
          
          if (site.type === 'user-folder-website' && site.user_folder) {
            // Get data from user folder website
            const currentFolderCID = user_folders[site.user_folder]?.cid;
            if (!currentFolderCID) {
              throw new Error('User folder not found');
            }
            
            const dataPath = `websites/${dns}/data/data.json`;
            
            try {
              const response = await fetch(`http://localhost:8080/ipfs/${currentFolderCID}/${dataPath}`);
              if (response.ok) {
                dataContent = await response.text();
              }
            } catch (err) {
              console.log('Could not fetch data.json, creating default...');
            }
            
            websiteInfo = {
              type: 'user-folder-website',
              folder_cid: currentFolderCID,
              path: `websites/${dns}`,
              website_url: `https://uservault.trustgrid.com/ipfs/${currentFolderCID}/websites/${dns}`,
              user_folder: site.user_folder
            };
            
          } else {
            // Get data from direct website
            try {
              const response = await fetch(`http://localhost:8080/ipfs/${site.cid}/data/data.json`);
              if (response.ok) {
                dataContent = await response.text();
              }
            } catch (err) {
              console.log('Could not fetch data.json, creating default...');
            }
            
            websiteInfo = {
              type: 'direct-website',
              cid: site.cid,
              website_url: `https://uservault.trustgrid.com/ipfs/${site.cid}`
            };
          }
          
          // If no data.json found, create default structure
          if (!dataContent) {
            const defaultData = {
              template: 'unknown',
              userData: {
                siteName: dns.split('.')[0],
                fullName: 'Website Owner',
                title: 'Creator',
                email: 'owner@example.com',
                bio: 'This is my website on IPFS.'
              },
              owner: req.userAlias || 'unknown',
              created: site.created || new Date().toISOString(),
              updated: new Date().toISOString(),
              version: '1.0',
              dns: dns,
              type: site.type || 'website',
              note: 'This data structure was created for editing. You can modify any values.'
            };
            dataContent = JSON.stringify(defaultData, null, 2);
          }
          
          return res.json({
            dns,
            dataContent,
            websiteInfo,
            canEdit: site.owner === req.userId || site.user_folder === req.userAlias,
            message: 'Website data loaded successfully'
          });
          
        } catch (err) {
          console.error('Error getting website data:', err);
          return res.status(500).json({ error: 'Failed to get website data: ' + err.message });
        }
      }

      // case 'rebuild-user-folder': {
      //   const { username } = args;
        
      //   if (username !== req.userAlias) {
      //     return res.status(403).json({ error: 'Access denied' });
      //   }
        
      //   try {
      //     console.log(`🔨 Rebuilding folder for ${username}`);
          
      //     const currentCID = user_folders[username].cid;
      //     const tempDir = path.join(__dirname, 'temp', `rebuild-${username}-${Date.now()}`);
          
      //     // Download and check actual structure
      //     fs.mkdirSync(tempDir, { recursive: true });
      //     await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
          
      //     // Find the actual content directory (same logic as updateUserFolder)
      //     let folderDir;
      //     const tempContents = fs.readdirSync(tempDir);
          
      //     if (tempContents.includes(currentCID)) {
      //       folderDir = path.join(tempDir, currentCID);
      //     } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
      //       folderDir = path.join(tempDir, tempContents[0]);
      //     } else {
      //       folderDir = tempDir;
      //     }
          
      //     // Check what actually exists
      //     const folderContents = fs.readdirSync(folderDir);
      //     console.log(`📋 Actual folder contents:`, folderContents);
          
      //     let actualWebsites = [];
      //     const websitesDir = path.join(folderDir, 'websites');
      //     if (fs.existsSync(websitesDir)) {
      //       actualWebsites = fs.readdirSync(websitesDir).filter(item => 
      //         fs.statSync(path.join(websitesDir, item)).isDirectory()
      //       );
      //     }
          
      //     // Get tracked websites
      //     const trackedWebsites = Object.keys(folder_contents[username]?.websites || {});
          
      //     // Compare
      //     const missing = trackedWebsites.filter(dns => !actualWebsites.includes(dns));
      //     const untracked = actualWebsites.filter(dns => !trackedWebsites.includes(dns));
          
      //     // Cleanup
      //     fs.rmSync(tempDir, { recursive: true, force: true });
          
      //     return res.json({
      //       username,
      //       current_cid: currentCID,
      //       folder_contents: folderContents,
      //       tracked_websites: trackedWebsites,
      //       actual_websites: actualWebsites,
      //       missing_from_ipfs: missing,
      //       untracked_in_system: untracked,
      //       status: missing.length === 0 ? 'All websites exist in IPFS' : 'Some websites missing',
      //       test_urls: actualWebsites.map(dns => ({
      //         dns,
      //         url: `https://uservault.trustgrid.com/ipfs/${currentCID}/websites/${dns}`,
      //         platform_url: `https://synqstorage.trustgrid.com/site/${dns}`
      //       }))
      //     });
          
      //   } catch (err) {
      //     return res.status(500).json({ error: 'Rebuild check failed: ' + err.message });
      //   }
      // }

      case 'rebuild-user-folder': {
        const { username } = args;
        
        if (username !== req.userAlias) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        try {
          console.log(`🔨 Rebuilding folder check for ${username}`);
          
          const currentCID = user_folders[username].cid;
          const tempDir = path.join(__dirname, 'temp', `rebuild-${username}-${Date.now()}`);
          
          // Download and check actual structure
          fs.mkdirSync(tempDir, { recursive: true });
          await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
          
          // Find the actual content directory
          let folderDir;
          const tempContents = fs.readdirSync(tempDir);
          
          if (tempContents.includes(currentCID)) {
            folderDir = path.join(tempDir, currentCID);
          } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
            folderDir = path.join(tempDir, tempContents[0]);
          } else {
            folderDir = tempDir;
          }
          
          // Check what actually exists
          const folderContents = fs.readdirSync(folderDir);
          console.log(`📋 Actual folder contents:`, folderContents);
          
          // Check websites directories
          let actualTemplateWebsites = [];
          let actualZipWebsites = [];
          
          const websitesDir = path.join(folderDir, 'websites');
          if (fs.existsSync(websitesDir)) {
            actualTemplateWebsites = fs.readdirSync(websitesDir).filter(item => 
              fs.statSync(path.join(websitesDir, item)).isDirectory()
            );
          }
          
          const zipWebsitesDir = path.join(folderDir, 'zipwebsites');
          if (fs.existsSync(zipWebsitesDir)) {
            actualZipWebsites = fs.readdirSync(zipWebsitesDir).filter(item => 
              fs.statSync(path.join(zipWebsitesDir, item)).isDirectory()
            );
          }
          
          // Get tracked websites
          const trackedContents = folder_contents[username] || { websites: {}, zipwebsites: {} };
          const trackedTemplateWebsites = Object.keys(trackedContents.websites || {});
          const trackedZipWebsites = Object.keys(trackedContents.zipwebsites || {});
          
          // Compare tracking vs reality
          const templateMissing = trackedTemplateWebsites.filter(dns => !actualTemplateWebsites.includes(dns));
          const templateUntracked = actualTemplateWebsites.filter(dns => !trackedTemplateWebsites.includes(dns));
          
          const zipMissing = trackedZipWebsites.filter(dns => !actualZipWebsites.includes(dns));
          const zipUntracked = actualZipWebsites.filter(dns => !trackedZipWebsites.includes(dns));
          
          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });
          
          return res.json({
            username,
            current_cid: currentCID,
            folder_contents: folderContents,
            template_websites: {
              tracked: trackedTemplateWebsites,
              actual: actualTemplateWebsites,
              missing_from_ipfs: templateMissing,
              untracked_in_system: templateUntracked
            },
            zip_websites: {
              tracked: trackedZipWebsites,
              actual: actualZipWebsites,
              missing_from_ipfs: zipMissing,
              untracked_in_system: zipUntracked
            },
            status: (templateMissing.length === 0 && zipMissing.length === 0) ? 
              'All websites exist in IPFS' : 'Some websites missing',
            test_urls: {
              template_sites: actualTemplateWebsites.map(dns => ({
                dns,
                url: `https://uservault.trustgrid.com/ipfs/${currentCID}/websites/${dns}`,
                platform_url: `https://synqstorage.trustgrid.com/site/${dns}`
              })),
              zip_sites: actualZipWebsites.map(dns => ({
                dns,
                url: `https://uservault.trustgrid.com/ipfs/${currentCID}/zipwebsites/${dns}`,
                platform_url: `https://synqstorage.trustgrid.com/site/${dns}`
              }))
            }
          });
          
        } catch (err) {
          return res.status(500).json({ error: 'Rebuild check failed: ' + err.message });
        }
      }

      case 'debug-cid-tracking': {
        const { username } = args;
        
        if (!username) {
          // Show all CID tracking info
          return res.json({
            total_redirects: Object.keys(cid_redirects).length,
            tracked_users: Object.keys(user_folder_cid_history).length,
            tracked_websites: Object.keys(website_cid_mapping).length,
            sample_redirects: Object.entries(cid_redirects).slice(0, 5),
            all_users: Object.keys(user_folder_cid_history)
          });
        }
        
        // Show specific user's CID tracking
        const folderHistory = user_folder_cid_history[username] || [];
        const userWebsites = Object.entries(website_cid_mapping).filter(([dns, info]) => 
          dns.endsWith(`.${username}`)
        );
        
        return res.json({
          username,
          current_folder_cid: user_folders[username]?.cid,
          folder_history: folderHistory,
          websites: userWebsites,
          redirects: Object.entries(cid_redirects).filter(([oldCid, newCid]) => 
            folderHistory.some(h => h.cid === newCid)
          )
        });
      }

      case 'debug-folder-structure': {
        const { alias, cid } = args;
        
        if (!alias && !cid) {
          return res.status(400).json({ error: 'Provide either alias or cid' });
        }
        
        try {
          let targetCID;
          let targetAlias;
          
          if (alias) {
            targetAlias = alias;
            targetCID = user_folders[alias]?.cid;
            if (!targetCID) {
              return res.status(404).json({ error: `No folder found for alias: ${alias}` });
            }
          } else {
            targetCID = cid;
            targetAlias = 'unknown';
          }
          
          console.log(`🔍 Debugging folder structure for ${targetAlias} (CID: ${targetCID})`);
          
          // Get IPFS tree structure
          const tree = await getIPFSTree(targetCID, 0, 3); // Max 3 levels deep
          
          // Also try direct IPFS ls command
          let lsOutput = '';
          try {
            const lsResult = await execAsync(`ipfs ls -v ${targetCID}`);
            lsOutput = lsResult.stdout;
          } catch (err) {
            lsOutput = `Error: ${err.message}`;
          }
          
          // Get our internal tracking data
          const folderData = user_folders[targetAlias] || null;
          const contentsData = folder_contents[targetAlias] || null;
          const historyData = user_folder_cid_history ? user_folder_cid_history[targetAlias] : null;
          
          return res.json({
            alias: targetAlias,
            cid: targetCID,
            ipfs_tree: tree,
            ipfs_ls_output: lsOutput,
            internal_folder_data: folderData,
            internal_contents: contentsData,
            cid_history: historyData,
            gateway_url: `https://uservault.trustgrid.com/ipfs/${targetCID}`,
            debug_urls: {
              browse_folder: `https://uservault.trustgrid.com/ipfs/${targetCID}`,
              websites_folder: `https://uservault.trustgrid.com/ipfs/${targetCID}/websites`,
              files_folder: `https://uservault.trustgrid.com/ipfs/${targetCID}/files`
            }
          });
          
        } catch (err) {
          return res.status(500).json({ 
            error: 'Failed to debug folder structure',
            details: err.message 
          });
        }
      }

      case 'debug-website-path': {
        const { dns } = args;
        
        if (!dns) {
          return res.status(400).json({ error: 'Provide dns name' });
        }
        
        try {
          // Get DNS mapping
          const site = dns_map[dns];
          if (!site) {
            return res.status(404).json({ error: `DNS ${dns} not found in mapping` });
          }
          
          console.log(`🔍 Debugging website path for ${dns}`);
          
          let debugInfo = {
            dns: dns,
            dns_mapping: site,
            expected_path: null,
            current_folder_cid: null,
            test_urls: []
          };
          
          if (site.type === 'user-folder-website' && site.user_folder) {
            const alias = site.user_folder;
            const currentCID = user_folders[alias]?.cid;
            const expectedPath = site.folder_path || `websites/${dns}`;
            
            debugInfo.expected_path = expectedPath;
            debugInfo.current_folder_cid = currentCID;
            debugInfo.alias = alias;
            
            // Test various URL patterns
            const testUrls = [
              `https://uservault.trustgrid.com/ipfs/${currentCID}`,
              `https://uservault.trustgrid.com/ipfs/${currentCID}/websites`,
              `https://uservault.trustgrid.com/ipfs/${currentCID}/websites/${dns}`,
              `https://uservault.trustgrid.com/ipfs/${currentCID}/${expectedPath}`,
              `https://uservault.trustgrid.com/ipfs/${currentCID}/${expectedPath}/index.html`
            ];
            
            debugInfo.test_urls = testUrls;
            
            // Check if website exists in folder contents
            const contents = folder_contents[alias];
            debugInfo.folder_contents = contents;
            debugInfo.website_in_contents = contents?.websites?.[dns] || null;
            
            // Try to get folder structure at website path
            try {
              const websiteTree = await getIPFSTree(currentCID);
              debugInfo.folder_tree = websiteTree;
              
              // Check if websites folder exists
              if (websiteTree.websites) {
                debugInfo.websites_folder_exists = true;
                debugInfo.websites_in_folder = Object.keys(websiteTree.websites);
                
                // Check if specific website exists
                if (websiteTree.websites[dns]) {
                  debugInfo.website_folder_exists = true;
                  debugInfo.website_contents = websiteTree.websites[dns];
                } else {
                  debugInfo.website_folder_exists = false;
                }
              } else {
                debugInfo.websites_folder_exists = false;
              }
              
            } catch (err) {
              debugInfo.tree_error = err.message;
            }
            
          } else {
            // Direct IPFS website
            debugInfo.type = 'direct_ipfs';
            debugInfo.direct_cid = site.cid;
            debugInfo.test_urls = [
              `https://uservault.trustgrid.com/ipfs/${site.cid}`,
              `https://uservault.trustgrid.com/ipfs/${site.cid}/index.html`
            ];
          }
          
          return res.json(debugInfo);
          
        } catch (err) {
          return res.status(500).json({ 
            error: 'Failed to debug website path',
            details: err.message 
          });
        }
      }

      case 'debug-all-user-data': {
        const { alias } = args;
        
        if (alias && alias !== req.userAlias) {
          return res.status(403).json({ error: 'Can only debug your own data' });
        }
        
        const targetAlias = alias || req.userAlias;
        
        return res.json({
          alias: targetAlias,
          user_id: req.userId,
          user_folders_entry: user_folders[targetAlias] || null,
          folder_contents_entry: folder_contents[targetAlias] || null,
          user_aliases_entry: user_aliases[targetAlias] || null,
          user_directories_entry: user_directories[req.userId] || null,
          cid_history: user_folder_cid_history ? user_folder_cid_history[targetAlias] : null,
          website_mappings: website_cid_mapping ? 
            Object.fromEntries(
              Object.entries(website_cid_mapping).filter(([dns, info]) => dns.endsWith(`.${targetAlias}`))
            ) : null,
          dns_mappings: Object.fromEntries(
            Object.entries(dns_map).filter(([dns, site]) => 
              site.user_folder === targetAlias || site.owner === req.userId
            )
          ),
          available_redirects: cid_redirects ? 
            Object.fromEntries(
              Object.entries(cid_redirects).filter(([oldCid, newCid]) => 
                user_folders[targetAlias]?.cid === newCid
              )
            ) : null
        });
      }

      case 'test-ipfs-access': {
        const { cid, path = '' } = args;
        
        if (!cid) {
          return res.status(400).json({ error: 'Provide CID to test' });
        }
        
        try {
          console.log(`🧪 Testing IPFS access: ${cid}/${path}`);
          
          // Test local IPFS access
          const localURL = `http://localhost:8080/ipfs/${cid}/${path}`;
          const productionURL = `https://uservault.trustgrid.com/ipfs/${cid}/${path}`;
          
          let localResult = null;
          let productionResult = null;
          
          // Test local access
          try {
            const localResponse = await fetch(localURL, { 
              method: 'HEAD',
              timeout: 5000 
            });
            localResult = {
              status: localResponse.status,
              statusText: localResponse.statusText,
              accessible: localResponse.ok
            };
          } catch (err) {
            localResult = {
              error: err.message,
              accessible: false
            };
          }
          
          // Test production access
          try {
            const prodResponse = await fetch(productionURL, { 
              method: 'HEAD',
              timeout: 5000 
            });
            productionResult = {
              status: prodResponse.status,
              statusText: prodResponse.statusText,
              accessible: prodResponse.ok
            };
          } catch (err) {
            productionResult = {
              error: err.message,
              accessible: false
            };
          }
          
          return res.json({
            cid,
            path,
            local_url: localURL,
            production_url: productionURL,
            local_result: localResult,
            production_result: productionResult,
            recommendations: {
              use_local_if_accessible: localResult.accessible,
              use_production_if_accessible: productionResult.accessible,
              try_without_path: path ? `Test with empty path: ${cid}` : null
            }
          });
          
        } catch (err) {
          return res.status(500).json({ 
            error: 'Failed to test IPFS access',
            details: err.message 
          });
        }
      }

      case 'delete-website': {
        const { dns, username } = args;
        
        if (!dns) {
          return res.status(400).json({ error: 'DNS name required' });
        }
        
        const targetUsername = username || req.userAlias;
        
        if (targetUsername !== req.userAlias) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        try {
          console.log(`🗑️ Deleting website: ${dns} from ${targetUsername}`);
          
          const currentCID = user_folders[targetUsername].cid;
          const tempDir = path.join(__dirname, 'temp', `delete-${targetUsername}-${Date.now()}`);
          
          // Download current folder
          fs.mkdirSync(tempDir, { recursive: true });
          await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
          
          // Find the actual content directory
          let folderDir;
          const tempContents = fs.readdirSync(tempDir);
          
          if (tempContents.includes(currentCID)) {
            folderDir = path.join(tempDir, currentCID);
          } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
            folderDir = path.join(tempDir, tempContents[0]);
          } else {
            folderDir = tempDir;
          }
          
          console.log(`📁 Working with folder: ${folderDir}`);
          
          let deleted = false;
          const deletedFrom = [];
          
          // Check and delete from root (old structure)
          const rootWebsitePath = path.join(folderDir, dns);
          if (fs.existsSync(rootWebsitePath)) {
            fs.rmSync(rootWebsitePath, { recursive: true, force: true });
            deleted = true;
            deletedFrom.push('root');
            console.log(`✅ Deleted ${dns} from root`);
          }
          
          // Check and delete from websites/ folder (new structure)
          const websitesWebsitePath = path.join(folderDir, 'websites', dns);
          if (fs.existsSync(websitesWebsitePath)) {
            fs.rmSync(websitesWebsitePath, { recursive: true, force: true });
            deleted = true;
            deletedFrom.push('websites folder');
            console.log(`✅ Deleted ${dns} from websites/`);
          }
          
          if (!deleted) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return res.status(404).json({ 
              error: 'Website not found in folder structure',
              dns: dns,
              checked_paths: [rootWebsitePath, websitesWebsitePath]
            });
          }
          
          // Re-upload to IPFS
          console.log(`📤 Re-uploading folder after deletion...`);
          const result = await execPromise(`ipfs add -r .`, folderDir);
          const lines = result.trim().split('\n');
          const newCID = lines[lines.length - 1].split(' ')[1];
          
          // Update tracking systems
          const oldCID = user_folders[targetUsername].cid;
          
          // Update user folder
          user_folders[targetUsername].cid = newCID;
          user_folders[targetUsername].updated = new Date().toISOString();
          
          // Remove from tracking
          if (folder_contents[targetUsername]?.websites?.[dns]) {
            delete folder_contents[targetUsername].websites[dns];
          }
          
          // Remove from DNS mapping
          if (dns_map[dns]) {
            delete dns_map[dns];
          }
          
          // Remove from user directories
          if (user_directories[req.userId]?.dns) {
            const index = user_directories[req.userId].dns.indexOf(dns);
            if (index > -1) {
              user_directories[req.userId].dns.splice(index, 1);
            }
          }
          
          // Remove from website CID mapping
          if (website_cid_mapping?.[dns]) {
            delete website_cid_mapping[dns];
          }
          
          // Add to history
          if (!user_folder_cid_history) user_folder_cid_history = {};
          if (!user_folder_cid_history[targetUsername]) user_folder_cid_history[targetUsername] = [];
          
          user_folder_cid_history[targetUsername].push({
            cid: newCID,
            previous_cid: oldCID,
            timestamp: new Date().toISOString(),
            action: `Deleted website: ${dns}`,
            websites: Object.keys(folder_contents[targetUsername]?.websites || {}),
            version: user_folder_cid_history[targetUsername].length + 1
          });
          
          // Update CID redirects
          if (!cid_redirects) cid_redirects = {};
          cid_redirects[oldCID] = newCID;
          
          // Update counts
          user_folders[targetUsername].websites_count = Object.keys(folder_contents[targetUsername]?.websites || {}).length;
          
          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });
          saveData();
          
          console.log(`✅ Successfully deleted ${dns}`);
          
          return res.json({
            deleted: true,
            dns: dns,
            deleted_from: deletedFrom,
            old_cid: oldCID,
            new_cid: newCID,
            remaining_websites: Object.keys(folder_contents[targetUsername]?.websites || {}),
            message: `Website ${dns} deleted successfully`
          });
          
        } catch (err) {
          console.error(`❌ Error deleting website:`, err);
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
          return res.status(500).json({ error: 'Failed to delete website: ' + err.message });
        }
      }

      case 'delete-all-websites': {
        const { username, confirm } = args;
        
        if (confirm !== 'DELETE_ALL_WEBSITES') {
          return res.status(400).json({ 
            error: 'Confirmation required',
            required_confirm: 'DELETE_ALL_WEBSITES',
            warning: 'This will delete ALL websites permanently!'
          });
        }
        
        const targetUsername = username || req.userAlias;
        
        if (targetUsername !== req.userAlias) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        try {
          console.log(`🗑️💥 DELETING ALL WEBSITES for ${targetUsername}`);
          
          const currentCID = user_folders[targetUsername].cid;
          const tempDir = path.join(__dirname, 'temp', `delete-all-${targetUsername}-${Date.now()}`);
          
          // Download current folder
          fs.mkdirSync(tempDir, { recursive: true });
          await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
          
          // Find the actual content directory
          let folderDir;
          const tempContents = fs.readdirSync(tempDir);
          
          if (tempContents.includes(currentCID)) {
            folderDir = path.join(tempDir, currentCID);
          } else if (tempContents.length === 1 && fs.statSync(path.join(tempDir, tempContents[0])).isDirectory()) {
            folderDir = path.join(tempDir, tempContents[0]);
          } else {
            folderDir = tempDir;
          }
          
          console.log(`📁 Working with folder: ${folderDir}`);
          
          const deletedWebsites = [];
          const trackedWebsites = Object.keys(folder_contents[targetUsername]?.websites || {});
          
          // Delete all tracked websites from both root and websites/ folder
          const folderContents = fs.readdirSync(folderDir);
          
          // Delete from root (old structure websites)
          folderContents.forEach(item => {
            const itemPath = path.join(folderDir, item);
            // Check if it's a website directory (ends with .username)
            if (fs.statSync(itemPath).isDirectory() && item.includes('.') && item.endsWith(`.${targetUsername}`)) {
              fs.rmSync(itemPath, { recursive: true, force: true });
              deletedWebsites.push(`${item} (from root)`);
              console.log(`✅ Deleted ${item} from root`);
            }
          });
          
          // Delete entire websites/ folder (new structure)
          const websitesDir = path.join(folderDir, 'websites');
          if (fs.existsSync(websitesDir)) {
            const websitesInFolder = fs.readdirSync(websitesDir);
            websitesInFolder.forEach(website => {
              deletedWebsites.push(`${website} (from websites/)`);
            });
            fs.rmSync(websitesDir, { recursive: true, force: true });
            console.log(`✅ Deleted entire websites/ folder`);
          }
          
          // Recreate empty websites/ folder for future use
          fs.mkdirSync(path.join(folderDir, 'websites'), { recursive: true });
          
          // Re-upload to IPFS
          console.log(`📤 Re-uploading clean folder...`);
          const result = await execPromise(`ipfs add -r .`, folderDir);
          const lines = result.trim().split('\n');
          const newCID = lines[lines.length - 1].split(' ')[1];
          
          // Clear ALL tracking data
          const oldCID = user_folders[targetUsername].cid;
          
          // Update user folder
          user_folders[targetUsername].cid = newCID;
          user_folders[targetUsername].updated = new Date().toISOString();
          user_folders[targetUsername].websites_count = 0;
          
          // Clear folder contents
          if (folder_contents[targetUsername]) {
            folder_contents[targetUsername].websites = {};
          }
          
          // Remove all DNS mappings for this user
          const userDnsList = user_directories[req.userId]?.dns || [];
          userDnsList.forEach(dns => {
            if (dns_map[dns]) {
              delete dns_map[dns];
            }
            if (website_cid_mapping?.[dns]) {
              delete website_cid_mapping[dns];
            }
          });
          
          // Clear user directories
          if (user_directories[req.userId]) {
            user_directories[req.userId].dns = [];
          }
          
          // Add to history
          if (!user_folder_cid_history) user_folder_cid_history = {};
          if (!user_folder_cid_history[targetUsername]) user_folder_cid_history[targetUsername] = [];
          
          user_folder_cid_history[targetUsername].push({
            cid: newCID,
            previous_cid: oldCID,
            timestamp: new Date().toISOString(),
            action: 'DELETED ALL WEBSITES',
            websites: [],
            deleted_websites: deletedWebsites,
            version: user_folder_cid_history[targetUsername].length + 1
          });
          
          // Update CID redirects
          if (!cid_redirects) cid_redirects = {};
          cid_redirects[oldCID] = newCID;
          
          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });
          saveData();
          
          console.log(`✅ Successfully deleted ALL websites for ${targetUsername}`);
          
          return res.json({
            deleted_all: true,
            username: targetUsername,
            deleted_websites: deletedWebsites,
            deleted_count: deletedWebsites.length,
            old_cid: oldCID,
            new_cid: newCID,
            clean_folder_url: `https://uservault.trustgrid.com/ipfs/${newCID}`,
            message: `All websites deleted successfully. Folder is now clean.`
          });
          
        } catch (err) {
          console.error(`❌ Error deleting all websites:`, err);
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
          return res.status(500).json({ error: 'Failed to delete all websites: ' + err.message });
        }
      }

      default:
        return res.status(400).json({ error: 'Unknown command' });
    }
  } catch (err) {
    console.error('❌ Command error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ========== File Upload Endpoint ==========
// app.post('/upload-files', requireAuth, upload.array('files'), async (req, res) => {
//   const { dns } = req.body;
//   const userId = req.userId;
  
//   try {
//     if (!dns_map[dns] || dns_map[dns].owner !== userId) {
//       return res.status(403).json({ error: 'Access denied' });
//     }

//     const uploadedFiles = [];
//     for (const file of req.files) {
//       const content = fs.readFileSync(file.path);
      
//       // Add individual file to IPFS
//       const tempFile = path.join(__dirname, 'temp', file.originalname);
//       fs.mkdirSync(path.dirname(tempFile), { recursive: true });
//       fs.writeFileSync(tempFile, content);
      
//       const result = await execPromise(`ipfs add ${tempFile}`);
//       const fileCID = result.trim().split(' ')[1];
      
//       uploadedFiles.push({
//         filename: file.originalname,
//         cid: fileCID,
//         size: file.size
//       });
      
//       user_directories[userId].files[file.originalname] = fileCID;
//       file_ownership[file.originalname] = userId;
      
//       // Cleanup
//       fs.unlinkSync(file.path);
//       fs.unlinkSync(tempFile);
//     }

//     saveData();
//     res.json({ uploadedFiles, count: uploadedFiles.length });
//   } catch (err) {
//     console.error('Upload error:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

app.post('/upload-files', requireAuth, upload.array('files'), async (req, res) => {
    const { dns } = req.body;
    const userId = req.userId;
    
    try {
      // Check if DNS exists (but don't check ownership - it's public!)
      if (!dns_map[dns]) {
        return res.status(404).json({ error: 'DNS not found' });
      }
  
      console.log(`🌐 Public update: User ${userId} updating ${dns}`);
  
      // Get current website content
      const currentCID = dns_map[dns].cid;
      const tempDir = path.join(__dirname, 'temp', `update-files-${Date.now()}`);
      
      // Download current website
      await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
      const webappDir = path.join(tempDir, currentCID);
      
      const uploadedFiles = [];
      
      // Process each uploaded file
      for (const file of req.files) {
        const content = fs.readFileSync(file.path);
        
        // Update file in website structure
        const filePath = path.join(webappDir, file.originalname);
        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(filePath, content);
        
        uploadedFiles.push({
          filename: file.originalname,
          size: file.size,
          updated: true
        });
        
        // Cleanup uploaded file
        fs.unlinkSync(file.path);
      }
  
      // Re-upload entire website to IPFS
      const result = await execPromise(`ipfs add -r .`, webappDir);
      const lines = result.trim().split('\n');
      const newCID = lines[lines.length - 1].split(' ')[1];
  
      // Update DNS mapping (keep original owner)
      dns_map[dns].cid = newCID;
      dns_map[dns].updated = new Date().toISOString();
      
      // Add to history
      cid_history[dns].push({
        cid: newCID,
        timestamp: new Date().toISOString(),
        version: cid_history[dns].length + 1,
        action: `Public update: ${uploadedFiles.length} files by user ${userId}`
      });
  
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
      saveData();
  
      res.json({ 
        uploadedFiles, 
        count: uploadedFiles.length,
        newCID,
        oldCID: currentCID,
        dns,
        version: cid_history[dns].length,
        message: 'Public website updated successfully'
      });
      
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

// ========== ZIP Upload Endpoint ==========
// app.post('/upload-zip', requireAuth, upload.single('zipfile'), async (req, res) => {
//     const { dns, metadata } = req.body;
//     const userId = req.userId;
    
//     try {
//       if (!req.file) {
//         return res.status(400).json({ error: 'No ZIP file uploaded' });
//       }
  
//       if (dns_map[dns] && dns_map[dns].owner !== userId) {
//         return res.status(403).json({ error: 'DNS name already taken by another user' });
//       }
  
//       console.log("📦 Processing ZIP upload for DNS:", dns);
//       console.log("📁 Original file:", req.file.originalname, "Size:", req.file.size);
  
//       // Read the uploaded ZIP file
//       const zipData = fs.readFileSync(req.file.path);
      
//       // Create temporary directory
//       const tempDir = path.join(__dirname, 'temp', `webapp-zip-${Date.now()}`);
//       fs.mkdirSync(tempDir, { recursive: true });
  
//       try {
//         // Write ZIP data to temp file
//         const zipPath = path.join(tempDir, 'upload.zip');
//         fs.writeFileSync(zipPath, zipData);
//         console.log("💾 ZIP written to:", zipPath);
  
//         // Extract ZIP
//         const zip = new AdmZip(zipPath);
//         const extractPath = path.join(tempDir, 'extracted');
//         zip.extractAllTo(extractPath, true);
//         console.log("📂 ZIP extracted to:", extractPath);
  
//         // Check what was extracted
//         const extractedContents = fs.readdirSync(extractPath);
//         let contentDir = extractPath;

//         const validDirs = extractedContents.filter(item => 
//             !item.startsWith('.') && 
//             !item.startsWith('__MACOSX') &&
//             fs.statSync(path.join(extractPath, item)).isDirectory()
//           );
          
//           const validFiles = extractedContents.filter(item => 
//             !item.startsWith('.') && 
//             !item.startsWith('__MACOSX') &&
//             fs.statSync(path.join(extractPath, item)).isFile()
//           );
          
//           console.log("📁 Valid directories found:", validDirs);
//           console.log("📄 Valid files found:", validFiles);
          
//         console.log("📁 Valid directories found:", validDirs);
//         console.log("📄 Valid files found:", validFiles);

//         if (validFiles.length === 0 && validDirs.length === 1) {
//             contentDir = path.join(extractPath, validDirs[0]);
//             console.log("🎯 Using nested directory as content root:", contentDir);
//           } else {
//             console.log("🎯 Using extract path as content root:", contentDir);
//         }
        
  
//         // List all items in content directory
//         const contentItems = fs.readdirSync(contentDir);
//         console.log("📄 Items in content directory:", contentItems);
  
//         // Track all files for ownership
//         const allFiles = [];
//         function collectFiles(dir, relativePath = '') {
//           console.log(`🔍 Scanning directory: ${dir} (relative: ${relativePath})`);
//           const items = fs.readdirSync(dir);
          
//           for (const item of items) {
//             if (item.startsWith('.') || item.startsWith('__MACOSX')) {
//               console.log(`⏭️ Skipping system file/folder: ${item}`);
//               continue;
//             }
            
//             const fullPath = path.join(dir, item);
//             const relPath = path.join(relativePath, item).replace(/\\/g, '/');
//             const stats = fs.statSync(fullPath);
            
//             if (stats.isDirectory()) {
//               console.log(`📁 Found directory: ${item} -> ${relPath}`);
//               collectFiles(fullPath, relPath);
//             } else {
//               console.log(`📄 Found file: ${item} -> ${relPath} (${stats.size} bytes)`);
//               allFiles.push(relPath);
//               file_ownership[relPath] = userId;
//             }
//           }
//         }
        
//         collectFiles(contentDir);
//         console.log("✅ Total files collected:", allFiles.length);
//         console.log("📋 File list:", allFiles);
  
//         // Add metadata file
//         const metaPath = path.join(contentDir, 'meta.json');
//         fs.writeFileSync(metaPath, JSON.stringify({
//           ...(metadata ? JSON.parse(metadata) : {}),
//           owner: userId,
//           created: new Date().toISOString(),
//           type: 'webapp-zip',
//           fileCount: allFiles.length,
//           structure: allFiles
//         }, null, 2));
  
//         console.log("🚀 Uploading to IPFS from:", contentDir);
        
//         // Upload to IPFS
//         const result = await execPromise(`ipfs add -r .`, contentDir);
//         console.log("📡 IPFS add result:", result);
        
//         const lines = result.trim().split('\n');
//         const cid = lines[lines.length - 1].split(' ')[1];
//         console.log("🎉 Final CID:", cid);
  
//         // Update mappings
//         const oldCID = dns_map[dns]?.cid;
//         dns_map[dns] = {
//           cid,
//           owner: userId,
//           created: dns_map[dns]?.created || new Date().toISOString(),
//           updated: new Date().toISOString(),
//           type: 'webapp-zip',
//           fileCount: allFiles.length
//         };
  
//         if (!cid_history[dns]) cid_history[dns] = [];
//         cid_history[dns].push({
//           cid,
//           timestamp: new Date().toISOString(),
//           version: cid_history[dns].length + 1,
//           action: 'ZIP upload',
//           fileCount: allFiles.length
//         });
  
//         if (!user_directories[userId].dns.includes(dns)) {
//           user_directories[userId].dns.push(dns);
//         }
  
//         // Cleanup
//         fs.rmSync(tempDir, { recursive: true, force: true });
//         fs.unlinkSync(req.file.path);
//         saveData();
  
//         return res.json({ 
//           dns, 
//           cid, 
//           oldCID, 
//           version: cid_history[dns].length,
//           fileCount: allFiles.length,
//           structure: allFiles
//         });
  
//       } catch (err) {
//         console.error("❌ ZIP processing error:", err);
//         if (fs.existsSync(tempDir)) {
//           fs.rmSync(tempDir, { recursive: true, force: true });
//         }
//         throw err;
//       }
      
//     } catch (err) {
//       console.error('❌ ZIP upload error:', err);
//       if (req.file && fs.existsSync(req.file.path)) {
//         fs.unlinkSync(req.file.path);
//       }
//       res.status(500).json({ error: err.message });
//     }
//   });


app.post('/upload-zip', requireAuth, upload.single('zipfile'), async (req, res) => {
    const { dns, metadata } = req.body;
    const userId = req.userId;
    const userAlias = req.userAlias;
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No ZIP file uploaded' });
      }
      
      if (!userAlias) {
        return res.status(400).json({ error: 'User alias not found. Please re-login.' });
      }
  
      // Check for existing website conflicts
      const existingSite = dns_map[dns];
      if (existingSite && existingSite.owner !== userId) {
        return res.status(403).json({ error: 'DNS name already taken by another user' });
      }
  
      console.log("📦 Processing ZIP upload for user folder:", userAlias);
      console.log("📁 Original file:", req.file.originalname, "Size:", req.file.size);
  
      // Read and extract ZIP file
      const zipData = fs.readFileSync(req.file.path);
      const tempDir = path.join(__dirname, 'temp', `zip-extract-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
  
      try {
        // Write and extract ZIP
        const zipPath = path.join(tempDir, 'upload.zip');
        fs.writeFileSync(zipPath, zipData);
        
        const zip = new AdmZip(zipPath);
        const extractPath = path.join(tempDir, 'extracted');
        zip.extractAllTo(extractPath, true);
        
        // Find content directory
        const extractedContents = fs.readdirSync(extractPath);
        let contentDir = extractPath;

        const validDirs = extractedContents.filter(item => 
            !item.startsWith('.') && 
            !item.startsWith('__MACOSX') &&
            fs.statSync(path.join(extractPath, item)).isDirectory()
        );
          
        const validFiles = extractedContents.filter(item => 
          !item.startsWith('.') && 
          !item.startsWith('__MACOSX') &&
          fs.statSync(path.join(extractPath, item)).isFile()
        );

        if (validFiles.length === 0 && validDirs.length === 1) {
            contentDir = path.join(extractPath, validDirs[0]);
        }
        
        // Collect all files
        const allFiles = [];
        function collectFiles(dir, relativePath = '') {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            if (item.startsWith('.') || item.startsWith('__MACOSX')) continue;
            
            const fullPath = path.join(dir, item);
            const relPath = path.join(relativePath, item).replace(/\\/g, '/');
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory()) {
              collectFiles(fullPath, relPath);
            } else {
              allFiles.push(relPath);
            }
          }
        }
        
        collectFiles(contentDir);
        console.log("✅ Total files collected:", allFiles.length);
        
        // Add data.json for edit compatibility
        const dataDir = path.join(contentDir, 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        
        const dataJsonPath = path.join(dataDir, 'data.json');
        if (!fs.existsSync(dataJsonPath)) {
          const websiteData = {
            template: 'zip-upload',
            userData: {
              siteName: dns.split('.')[0],
              uploadedFile: req.file.originalname,
              fileCount: allFiles.length
            },
            owner: userAlias,
            created: existingSite?.created || new Date().toISOString(),
            updated: new Date().toISOString(),
            version: existingSite ? ((cid_history[dns]?.length || 0) + 1) : 1,
            dns: dns,
            type: 'zip-website',
            folder_path: `zipwebsites/${dns}`,
            upload_info: {
              original_filename: req.file.originalname,
              file_size: req.file.size,
              extracted_files: allFiles.length
            }
          };
          fs.writeFileSync(dataJsonPath, JSON.stringify(websiteData, null, 2));
          allFiles.push('data/data.json');
        }
        
        // Calculate content size
        let contentSize = 0;
        function calculateSize(dir) {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const itemPath = path.join(dir, item);
            const stats = fs.statSync(itemPath);
            if (stats.isDirectory()) {
              calculateSize(itemPath);
            } else {
              contentSize += stats.size;
            }
          }
        }
        calculateSize(contentDir);
        
        // Add to user folder using updateUserFolder
        const zipContent = {
          dns: dns,
          extractedPath: contentDir,
          filesList: allFiles,
          fileCount: allFiles.length,
          originalFilename: req.file.originalname
        };
        
        const result = await updateUserFolder(userAlias, zipContent, 'zipwebsite', contentSize);
        
        // Update DNS mapping for ZIP website in user folder
        dns_map[dns] = {
          type: 'user-folder-zipwebsite',
          user_folder: userAlias,
          folder_path: `zipwebsites/${dns}`,
          owner: userId,
          created: existingSite?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
          original_filename: req.file.originalname,
          file_count: allFiles.length
        };
        
        // Add to cid history
        if (!cid_history[dns]) cid_history[dns] = [];
        cid_history[dns].push({
          folder_cid: result.newCID,
          previous_folder_cid: result.oldCID,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: existingSite ? 'ZIP update in user folder' : 'ZIP upload to user folder',
          path: `zipwebsites/${dns}`,
          file_count: allFiles.length
        });
        
        // Add to user directory
        if (!user_directories[userId].dns.includes(dns)) {
          user_directories[userId].dns.push(dns);
        }
        
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(req.file.path);
        saveData();
        
        return res.json({ 
          success: true,
          dns, 
          folder_cid: result.newCID,
          old_folder_cid: result.oldCID,
          version: cid_history[dns].length,
          fileCount: allFiles.length,
          structure: allFiles,
          is_update: !!existingSite,
          website_url: `https://uservault.trustgrid.com/ipfs/${result.newCID}/zipwebsites/${dns}`,
          folder_url: `https://uservault.trustgrid.com/ipfs/${result.newCID}`,
          platform_url: `https://synqstorage.trustgrid.com/site/${dns}`,
          type: 'user-folder-zipwebsite',
          quota_used: result.quotaUsed,
          quota_available: user_folders[userAlias].quota_limit - result.quotaUsed,
          message: existingSite ? 
            `ZIP website updated in your folder (v${cid_history[dns].length})` : 
            'ZIP website added to your folder successfully'
        });
        
      } catch (err) {
        console.error("❌ ZIP processing error:", err);
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        throw err;
      }
      
    } catch (err) {
      console.error('❌ ZIP upload error:', err);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: err.message });
    }
});



// app.get('/site/:dns', async (req, res) => {
//   const dns = req.params.dns;
//   const site = dns_map[dns];
  
//   if (!site) {
//     return res.status(404).send(`
//       <!DOCTYPE html>
//       <html>
//       <head><title>Site Not Found</title></head>
//       <body>
//         <h1>🌐 Site Not Found</h1>
//         <p>The site <strong>${dns}</strong> does not exist on this platform.</p>
//         <a href="https://synqstorage.trustgrid.com:3000/">← Back to Platform</a>
//       </body>
//       </html>
//     `);
//   }
  
//   if (site.type === 'user-folder-website' && site.user_folder) {
//     // Get current folder CID using our tracking system
//     let currentFolderCID = user_folders[site.user_folder]?.cid;
    
//     // Double-check with website CID mapping
//     if (website_cid_mapping && website_cid_mapping[dns]) {
//       currentFolderCID = website_cid_mapping[dns].current_folder_cid;
//     }
    
//     if (!currentFolderCID) {
//       return res.status(404).send('User folder not found');
//     }
    
//     // Build the correct URL
//     const websiteURL = `https://uservault.trustgrid.com:8080/ipfs/${currentFolderCID}/${site.folder_path}`;
//     console.log(`🔗 Redirecting ${dns} to current CID: ${currentFolderCID}`);
//     return res.redirect(websiteURL);
//   } else {
//     // Traditional direct IPFS website - check for redirects
//     let targetCID = site.cid;
//     if (cid_redirects && cid_redirects[site.cid]) {
//       targetCID = cid_redirects[site.cid];
//       console.log(`🔄 Direct site CID redirect: ${site.cid} → ${targetCID}`);
//     }
//     return res.redirect(`https://uservault.trustgrid.com:8080/ipfs/${targetCID}`);
//   }
// });

app.get('/site/:dns', async (req, res) => {
  const dns = req.params.dns;
  const site = dns_map[dns];
  
  if (!site) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Site Not Found</title></head>
      <body>
        <h1>🌐 Site Not Found</h1>
        <p>The site <strong>${dns}</strong> does not exist on this platform.</p>
        <a href="https://synqstorage.trustgrid.com/">← Back to Platform</a>
      </body>
      </html>
    `);
  }
  
  if (site.type === 'user-folder-website' || site.type === 'user-folder-zipwebsite') {
    // Get current folder CID
    const currentFolderCID = user_folders[site.user_folder]?.cid;
    
    // Double-check with website CID mapping
    if (website_cid_mapping && website_cid_mapping[dns]) {
      currentFolderCID = website_cid_mapping[dns].current_folder_cid;
    }
    
    if (!currentFolderCID) {
      return res.status(404).send('User folder not found');
    }
    
    // Build the correct URL based on type
    const folderPath = site.type === 'user-folder-zipwebsite' ? 
      `zipwebsites/${dns}` : 
      `websites/${dns}`;
      
    const websiteURL = `https://uservault.trustgrid.com/ipfs/${currentFolderCID}/${folderPath}`;
    console.log(`🔗 Redirecting ${dns} (${site.type}) to: ${websiteURL}`);
    return res.redirect(websiteURL);
  } else {
    // Traditional direct IPFS website
    return res.redirect(`https://uservault.trustgrid.com/ipfs/${site.cid}`);
  }
});


app.get('/resolve-dns/:dns', async (req, res) => {
  const dns = req.params.dns;
  const site = dns_map[dns];
  
  if (!site) {
    return res.status(404).json({ error: 'DNS not found' });
  }
  
  try {
    const tree = await getIPFSTree(site.cid);
    
    // If it's a web request (browser), return HTML
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>DNS Info: ${dns}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
            .header { border-bottom: 2px solid #3498db; padding-bottom: 20px; margin-bottom: 30px; }
            .header h1 { color: #2c3e50; margin: 0; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
            .info-card { background: #f8f9fa; padding: 20px; border-radius: 8px; }
            .info-card h3 { margin: 0 0 10px 0; color: #2c3e50; }
            .info-card p { margin: 5px 0; color: #666; }
            .cid { font-family: monospace; background: #e9ecef; padding: 10px; border-radius: 5px; word-break: break-all; }
            .actions { margin-top: 30px; }
            .btn { background: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-right: 10px; display: inline-block; }
            .btn:hover { background: #2980b9; }
            .tree { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px; }
            .tree pre { margin: 0; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🌐 ${dns}</h1>
              <p>IPFS Site Information</p>
            </div>
            
            <div class="info-grid">
              <div class="info-card">
                <h3>📦 Current CID</h3>
                <div class="cid">${site.cid}</div>
              </div>
              <div class="info-card">
                <h3>📊 Site Details</h3>
                <p><strong>Type:</strong> ${site.type}</p>
                <p><strong>Versions:</strong> ${cid_history[dns]?.length || 1}</p>
                <p><strong>Created:</strong> ${new Date(site.created).toLocaleDateString()}</p>
                <p><strong>Updated:</strong> ${new Date(site.updated).toLocaleDateString()}</p>
              </div>
            </div>
            
            <div class="actions">
              <a href="http://localhost:8080/ipfs/${site.cid}" class="btn">🔗 View Site</a>
              <a href="http://localhost:3000/resolve-dns/${dns}?format=json" class="btn">📋 JSON Data</a>
              <a href="http://localhost:3000/" class="btn">🏠 Platform Home</a>
            </div>
            
            <div class="tree">
              <h3>📁 File Structure</h3>
              <pre>${JSON.stringify(tree, null, 2)}</pre>
            </div>
          </div>
        </body>
        </html>
      `);
    }
    
    // Otherwise return JSON
    return res.json({ 
      dns,
      ...site,
      tree,
      versions: cid_history[dns]?.length || 0,
      gateway_url: `http://localhost:8080/ipfs/${site.cid}`,
      platform_url: `http://localhost:3000/site/${dns}`
    });
  } catch (err) {
    console.error('❌ DNS resolution error:', err);
    return res.status(500).json({ error: 'Failed to fetch IPFS tree' });
  }
});

app.get('/user-folders', (req, res) => {
  const folders = Object.keys(user_folders).map(username => ({
    username,
    cid: user_folders[username].cid,
    quota_used: user_folders[username].quota_used,
    quota_limit: user_folders[username].quota_limit,
    created: user_folders[username].created,
    file_count: Object.keys(folder_contents[username]?.files || {}).length,
    website_count: Object.keys(folder_contents[username]?.websites || {}).length,
    gateway_url: `http://localhost:8080/ipfs/${user_folders[username].cid}`
  }));
  
  res.json({ folders, total: folders.length });
});

// Add route to browse user folder
app.get('/user-folder/:username', (req, res) => {
  const username = req.params.username;
  
  if (!user_folders[username]) {
    return res.status(404).json({ error: 'User folder not found' });
  }
  
  const folder = user_folders[username];
  const contents = folder_contents[username];
  
  // If browser request, return HTML
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>User Folder: ${username}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
          .container { max-width: 900px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
          .header { text-align: center; border-bottom: 2px solid #3498db; padding-bottom: 20px; margin-bottom: 30px; }
          .quota-bar { background: #ecf0f1; height: 20px; border-radius: 10px; overflow: hidden; margin: 20px 0; }
          .quota-fill { background: #3498db; height: 100%; transition: width 0.3s; }
          .quota-full { background: #e74c3c; }
          .section { margin: 30px 0; }
          .item { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; }
          .btn { background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px; display: inline-block; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📁 ${username}'s Folder</h1>
            <p><strong>CID:</strong> <code>${folder.cid}</code></p>
            <div class="quota-bar">
              <div class="quota-fill ${folder.quota_used / folder.quota_limit > 0.9 ? 'quota-full' : ''}" 
                   style="width: ${(folder.quota_used / folder.quota_limit * 100)}%"></div>
            </div>
            <p><strong>Storage:</strong> ${(folder.quota_used / 1024 / 1024).toFixed(2)}MB / ${(folder.quota_limit / 1024 / 1024).toFixed(0)}MB 
               (${((folder.quota_used / folder.quota_limit) * 100).toFixed(1)}% used)</p>
          </div>
          
          <div class="section">
            <h3>📄 Files (${Object.keys(contents.files).length})</h3>
            ${Object.entries(contents.files).map(([filename, info]) => `
              <div class="item">
                <strong>${filename}</strong> - ${(info.size / 1024).toFixed(2)}KB
                <span style="color: #666; margin-left: 10px;">${info.type}</span>
              </div>
            `).join('')}
          </div>
          
          <div class="section">
            <h3>🌐 Websites (${Object.keys(contents.websites).length})</h3>
            ${Object.entries(contents.websites).map(([dns, info]) => `
              <div class="item">
                <strong>${dns}</strong> - ${(info.estimated_size / 1024).toFixed(2)}KB
                <br><small>Files: ${info.files.join(', ')}</small>
              </div>
            `).join('')}
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <a href="http://localhost:8080/ipfs/${folder.cid}" class="btn">🔗 Browse Folder</a>
            <a href="http://localhost:3000/" class="btn">🏠 Platform Home</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
  
  // JSON response
  res.json({
    username,
    folder,
    contents,
    gateway_url: `http://localhost:8080/ipfs/${folder.cid}`
  });
});

app.get('/auth/check-alias/:alias', (req, res) => {
  const alias = req.params.alias;
  
  // Validate format
  const aliasRegex = /^[a-zA-Z0-9_-]+$/;
  if (!aliasRegex.test(alias) || alias.length < 3) {
    return res.json({ 
      available: false, 
      reason: 'Invalid format. Use 3+ characters, letters, numbers, hyphens, and underscores only.' 
    });
  }
  
  // Check availability
  const available = !user_folders[alias];
  
  res.json({ 
    alias,
    available,
    reason: available ? 'Alias is available!' : 'Alias already taken.'
  });
});

app.get('/auth/check-user/:alias', (req, res) => {
  const alias = req.params.alias;
  
  const exists = !!(user_credentials && user_credentials[alias]);
  
  res.json({ 
    alias,
    exists,
    message: exists ? 'User found' : 'User not found'
  });
});

app.get('/users', (req, res) => {
  const users = Object.entries(user_aliases).map(([alias, userId]) => ({
    alias,
    folder_cid: user_folders[alias]?.cid,
    websites_count: user_directories[userId]?.dns.length || 0,
    created: user_folders[alias]?.created,
    profile_url: `http://localhost:3000/user/${alias}`
  }));
  
  res.json({ users, total: users.length });
});

app.get('/stats', (req, res) => {
  const totalUsers = Object.keys(user_aliases).length;
  const totalStorage = Object.values(user_folders).reduce((sum, folder) => sum + folder.quota_used, 0);
  
  res.json({
    totalSites: Object.keys(dns_map).length,
    totalUsers,
    totalAliases: totalUsers,
    totalFiles: Object.keys(file_ownership).length,
    totalStorage: `${(totalStorage / 1024 / 1024).toFixed(2)}MB`,
    activeTokens: Object.keys(access_tokens).filter(token => 
      access_tokens[token].expires > Date.now()
    ).length,
    averageStoragePerUser: totalUsers > 0 ? `${(totalStorage / totalUsers / 1024).toFixed(2)}KB` : '0KB'
  });
});

app.post('/resolve-ipfs', async (req, res) => {
  let { cid, filePath = '' } = req.body;
  
  console.log(`📡 Resolve request: CID=${cid}, Path=${filePath}`);
  
  // IMPORTANT: Check if this is an old CID that needs redirecting
  if (cid_redirects && cid_redirects[cid]) {
    const currentCID = cid_redirects[cid];
    console.log(`🔄 CID Redirect: ${cid} → ${currentCID}`);
    cid = currentCID; // Use the current CID
  }
  
  // Special handling for user folder websites
  if (filePath.includes('websites/') && filePath.includes('data/data.json')) {
    // This is a request for website data in a user folder
    const pathParts = filePath.split('/');
    const websiteIndex = pathParts.indexOf('websites');
    
    if (websiteIndex >= 0 && pathParts.length > websiteIndex + 2) {
      const websiteName = pathParts[websiteIndex + 1];
      
      // Check if this website exists in website CID mapping
      if (website_cid_mapping && website_cid_mapping[websiteName]) {
        const currentFolderCID = website_cid_mapping[websiteName].current_folder_cid;
        if (currentFolderCID) {
          cid = currentFolderCID;
          console.log(`📂 Using current folder CID for ${websiteName}: ${currentFolderCID}`);
        }
      }
    }
  }
  
  const fileURL = `http://localhost:8080/ipfs/${cid}/${filePath}`;
  console.log("🔗 Proxying:", fileURL);
  
  try {
    const response = await fetch(fileURL);
    const contentType = response.headers.get('content-type') || 'text/plain';
    res.setHeader('Content-Type', contentType);
    
    if (contentType.startsWith('text/') || contentType.includes('json')) {
      const data = await response.text();
      res.send(data);
    } else {
      const buffer = await response.buffer();
      res.send(buffer);
    }
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    res.status(500).send('Fetch error: ' + err.message);
  }
});


// ========== Server Startup ==========
loadData();

function debugAuth(req, res, next) {
  console.log('=== AUTH DEBUG ===');
  console.log('Headers:', req.headers.authorization);
  console.log('Token exists:', !!req.headers.authorization);
  console.log('Access tokens keys:', Object.keys(access_tokens));
  console.log('User aliases:', user_aliases);
  console.log('==================');
  next();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🌐 IPFS Web Platform running on http://localhost:${PORT}`);
  console.log(`📊 Loaded ${Object.keys(dns_map).length} sites, ${Object.keys(user_directories).length} users`);
  
  try {
    await startIPFS();
    console.log('✅ IPFS daemon started successfully');
  } catch (err) {
    console.error('❌ Failed to start IPFS daemon:', err.message);
  }
});
