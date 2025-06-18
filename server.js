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

// function saveData() {
//   const data = {
//     dns_map,
//     user_directories,
//     cid_history,
//     file_ownership,
//     access_tokens,
//     user_folders,        // ADD THIS
//     folder_contents,     // ADD THIS
//     timestamp: new Date().toISOString()
//   };
//   fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
// }

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
  fs.mkdirSync(path.join(folderDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(folderDir, 'media'), { recursive: true });
  
  // Welcome content
  fs.writeFileSync(welcomeFile, `Welcome to ${alias}'s IPFS folder!
Created: ${new Date().toISOString()}
Quota: 10MB
Alias: ${alias}

This is your personal IPFS storage space. You can:
- Host websites in the 'websites' folder
- Store files in the 'files' folder  
- Upload media in the 'media' folder

Happy building! 🚀`);

  // README with folder structure
  fs.writeFileSync(readmeFile, `# ${alias}'s IPFS Folder

## Structure
- \`websites/\` - Your deployed websites
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
                <div class="folder-icon">🌐</div>
                <h3>Websites</h3>
                <p>Your deployed web applications</p>
            </div>
            <div class="folder-item">
                <div class="folder-icon">📄</div>
                <h3>Files</h3>
                <p>Documents and data storage</p>
            </div>
            <div class="folder-item">
                <div class="folder-icon">🎨</div>
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
    websites_count: 0
  };
  
  folder_contents[alias] = {
    files: { 
      'welcome.txt': { size: fs.readFileSync(welcomeFile).length, type: 'text' },
      'README.md': { size: fs.readFileSync(readmeFile).length, type: 'markdown' },
      'index.html': { size: fs.readFileSync(indexFile).length, type: 'html' }
    },
    websites: {}
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

async function updateUserFolder(username, newContent, contentType, contentSize) {
  if (!user_folders[username]) {
    throw new Error('User folder not found');
  }
  
  // Check quota
  if (!checkQuota(username, contentSize)) {
    const available = (user_folders[username].quota_limit - user_folders[username].quota_used) / 1024 / 1024;
    throw new Error(`Quota exceeded. Available: ${available.toFixed(2)}MB`);
  }
  
  // Get current folder content
  const currentCID = user_folders[username].cid;
  const tempDir = path.join(__dirname, 'temp', `update-user-${username}-${Date.now()}`);
  
  try {
    // Download current folder
    await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
    const folderDir = path.join(tempDir, currentCID);
    
    // Track what websites exist before update
    const websitesBefore = [];
    if (folder_contents[username] && folder_contents[username].websites) {
      websitesBefore.push(...Object.keys(folder_contents[username].websites));
    }
    
    // Add new content based on type
    if (contentType === 'website') {
      const websiteDir = path.join(folderDir, 'websites', newContent.dns);
      fs.mkdirSync(websiteDir, { recursive: true });
      
      // Ensure data directory exists in website
      const dataDir = path.join(websiteDir, 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      
      // Copy website files
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
      
      // Create data.json for the website
      const dataJsonPath = path.join(websiteDir, 'data', 'data.json');
      if (!fs.existsSync(dataJsonPath)) {
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
      
      // Update folder contents tracking
      if (!folder_contents[username]) folder_contents[username] = { files: {}, websites: {} };
      folder_contents[username].websites[newContent.dns] = {
        estimated_size: contentSize,
        files: Object.keys(newContent.files),
        created: new Date().toISOString(),
        has_data_json: true
      };
      
    } else if (contentType === 'file') {
      const filePath = path.join(folderDir, 'files', newContent.filename);
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      
      if (newContent.encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(newContent.content, 'base64'));
      } else {
        fs.writeFileSync(filePath, newContent.content);
      }
      
      // Update folder contents tracking
      if (!folder_contents[username]) folder_contents[username] = { files: {}, websites: {} };
      folder_contents[username].files[newContent.filename] = {
        size: contentSize,
        type: newContent.type || 'unknown',
        created: new Date().toISOString()
      };
    }
    
    // Re-upload to IPFS
    const result = await execPromise(`ipfs add -r .`, folderDir);
    const lines = result.trim().split('\n');
    const newCID = lines[lines.length - 1].split(' ')[1];
    
    // CRITICAL: Update CID tracking system
    const oldCID = user_folders[username].cid;
    
    // 1. Update user folder data
    user_folders[username].cid = newCID;
    user_folders[username].quota_used += contentSize;
    user_folders[username].updated = new Date().toISOString();
    
    // 2. Track CID history for this user folder
    if (!user_folder_cid_history[username]) {
      user_folder_cid_history[username] = [];
    }
    
    // Get current websites list
    const currentWebsites = Object.keys(folder_contents[username].websites || {});
    
    user_folder_cid_history[username].push({
      cid: newCID,
      previous_cid: oldCID,
      timestamp: new Date().toISOString(),
      action: contentType === 'website' ? `Added website: ${newContent.dns}` : `Added file: ${newContent.filename}`,
      websites: [...currentWebsites], // All websites in this CID
      version: user_folder_cid_history[username].length + 1
    });
    
    // 3. Create CID redirect mapping (old CID -> new CID)
    if (oldCID !== newCID) {
      cid_redirects[oldCID] = newCID;
      
      // Also create redirects for all previous CIDs of this user
      user_folder_cid_history[username].forEach(entry => {
        if (entry.cid !== newCID) {
          cid_redirects[entry.cid] = newCID;
        }
      });
    }
    
    // 4. Update website CID mapping for all websites in this folder
    currentWebsites.forEach(websiteDns => {
      if (!website_cid_mapping[websiteDns]) {
        website_cid_mapping[websiteDns] = {
          creation_folder_cid: newCID,
          path: `websites/${websiteDns}`
        };
      }
      // Always update current CID
      website_cid_mapping[websiteDns].current_folder_cid = newCID;
      website_cid_mapping[websiteDns].last_updated = new Date().toISOString();
    });
    
    // Update counts
    if (contentType === 'website') {
      user_folders[username].websites_count = Object.keys(folder_contents[username].websites).length;
    }
    user_folders[username].files_count = Object.keys(folder_contents[username].files).length;
    
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    console.log(`📦 Updated ${username} folder: ${oldCID} → ${newCID}`);
    console.log(`🔗 Created redirects for ${Object.keys(cid_redirects).length} old CIDs`);
    
    return { oldCID, newCID, quotaUsed: user_folders[username].quota_used };
    
  } catch (err) {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw err;
  }
}

// Persistent storage
const DATA_FILE = path.join(__dirname, 'platform-data.json');

// ========== Data Persistence ==========
// function saveData() {
//   const data = {
//     dns_map,
//     user_directories,
//     cid_history,
//     file_ownership,
//     access_tokens,
//     timestamp: new Date().toISOString()
//   };
//   fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
// }

// function saveData() {
//   const data = {
//     dns_map,
//     user_directories,
//     cid_history,
//     file_ownership,
//     access_tokens,
//     user_folders,
//     folder_contents,
//     user_aliases,  // ADD THIS
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
    folder_contents,
    user_aliases,
    user_folder_cid_history,    // ADD
    website_cid_mapping,        // ADD
    cid_redirects,             // ADD
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


function getUserByAlias(alias) {
  const userId = user_aliases[alias];
  if (!userId) return null;
  
  return {
    userId,
    alias,
    folder: user_folders[alias],
    contents: folder_contents[alias],
    directory: user_directories[userId]
  };
}

// function loadData() {
//   try {
//     if (fs.existsSync(DATA_FILE)) {
//       const data = JSON.parse(fs.readFileSync(DATA_FILE));
//       dns_map = data.dns_map || {};
//       user_directories = data.user_directories || {};
//       cid_history = data.cid_history || {};
//       file_ownership = data.file_ownership || {};
//       access_tokens = data.access_tokens || {};
//       user_folders = data.user_folders || {};
//       folder_contents = data.folder_contents || {};
//       user_aliases = data.user_aliases || {};  // ADD THIS
//       console.log('📊 Data loaded from storage');
//     }
//   } catch (err) {
//     console.error('❌ Failed to load data:', err.message);
//   }
// }

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
      user_folder_cid_history = data.user_folder_cid_history || {};    // ADD
      website_cid_mapping = data.website_cid_mapping || {};            // ADD
      cid_redirects = data.cid_redirects || {};                       // ADD
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





// ========== Helper Functions ==========
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

// ========== Core Command Handlers ==========
// app.post('/auth/register', (req, res) => {
//   const userId = generateUserId();
//   const token = generateToken();
  
//   access_tokens[token] = {
//     userId,
//     permissions: ['read', 'write', 'upload'],
//     expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
//   };
  
//   user_directories[userId] = { dns: [], files: {} };
//   saveData();
  
//   res.json({ userId, token, message: 'User registered successfully' });
// });

app.post('/auth/register', async (req, res) => {
  const { alias } = req.body;
  
  // Validate alias
  if (!alias || alias.length < 3) {
    return res.status(400).json({ error: 'Alias must be at least 3 characters long' });
  }
  
  // Check alias format (alphanumeric, hyphens, underscores only)
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
    
    // Create user folder on IPFS
    const folderCID = await createUserFolder(alias);
    
    // Store authentication data
    access_tokens[token] = {
      userId,
      alias,  // Add alias to token data
      permissions: ['read', 'write', 'upload'],
      expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
    };
    
    // Initialize user directory
    user_directories[userId] = { 
      alias,
      dns: [], 
      files: {} 
    };
    
    // Initialize user folder mapping (alias -> userId)
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

      case 'list-user-sites': {
        // Get user's sites from both old system and new folder system
        const userSites = user_directories[req.userId]?.dns || [];
        const allSites = [];
        
        console.log('Loading sites for user:', req.userId, 'alias:', req.userAlias);
        
        // Process all user sites
        userSites.forEach(dns => {
          const site = dns_map[dns];
          if (!site) return;
          
          if (site.type === 'user-folder-website' && site.user_folder === req.userAlias) {
            // User folder website - get current folder CID
            const currentFolderCID = user_folders[req.userAlias]?.cid;
            allSites.push({
              dns,
              cid: currentFolderCID, // Current folder CID
              type: site.type,
              created: site.created,
              updated: site.updated,
              owner: site.owner,
              versions: cid_history[dns]?.length || 1,
              in_user_folder: true,
              folder_path: site.folder_path,
              website_url: `https://uservault.trustgrid.com:8080/ipfs/${currentFolderCID}/${site.folder_path}`,
              platform_url: `https://synqstorage.trustgrid.com:3000/site/${dns}`
            });
          } else {
            // Traditional direct website
            allSites.push({
              dns,
              cid: site.cid,
              type: site.type,
              created: site.created,
              updated: site.updated,
              owner: site.owner,
              versions: cid_history[dns]?.length || 1,
              in_user_folder: false,
              website_url: `https://uservault.trustgrid.com:8080/ipfs/${site.cid}`,
              platform_url: `https://synqstorage.trustgrid.com:3000/site/${dns}`
            });
          }
        });
  
        console.log('Total sites found:', allSites.length);
        
        return res.json({ 
          sites: allSites, 
          total: allSites.length,
          user_alias: req.userAlias,
          folder_cid: user_folders[req.userAlias]?.cid
        });
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

      case 'get-user-folder-info': {
        if (!req.userAlias || !user_folders[req.userAlias]) {
          return res.status(404).json({ error: 'User folder not found' });
        }
        
        const folder = user_folders[req.userAlias];
        const contents = folder_contents[req.userAlias] || { files: {}, websites: {} };
        
        return res.json({
          alias: req.userAlias,
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
            files: contents.files,
            websites: contents.websites,
            files_count: Object.keys(contents.files).length,
            websites_count: Object.keys(contents.websites).length
          },
          gateway_url: `http://localhost:8080/ipfs/${folder.cid}`,
          platform_url: `http://localhost:3000/user-folder/${req.userAlias}`
        });
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
            console.log(`🔗 Website URL: https://uservault.trustgrid.com:8080/ipfs/${result.newCID}/${websitePath}`);
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
              `https://uservault.trustgrid.com:8080/ipfs/${result.newCID}/websites/${content.dns}` : null,
            folder_url: `https://uservault.trustgrid.com:8080/ipfs/${result.newCID}`,
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
            website_url: `https://uservault.trustgrid.com:8080/ipfs/${newFolderCID}/${site.folder_path}`,
            message: 'Website data updated successfully'
          });
          
        } catch (err) {
          return res.status(500).json({ error: 'Failed to update website: ' + err.message });
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
app.post('/upload-zip', requireAuth, upload.single('zipfile'), async (req, res) => {
    const { dns, metadata } = req.body;
    const userId = req.userId;
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No ZIP file uploaded' });
      }
  
      if (dns_map[dns] && dns_map[dns].owner !== userId) {
        return res.status(403).json({ error: 'DNS name already taken by another user' });
      }
  
      console.log("📦 Processing ZIP upload for DNS:", dns);
      console.log("📁 Original file:", req.file.originalname, "Size:", req.file.size);
  
      // Read the uploaded ZIP file
      const zipData = fs.readFileSync(req.file.path);
      
      // Create temporary directory
      const tempDir = path.join(__dirname, 'temp', `webapp-zip-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
  
      try {
        // Write ZIP data to temp file
        const zipPath = path.join(tempDir, 'upload.zip');
        fs.writeFileSync(zipPath, zipData);
        console.log("💾 ZIP written to:", zipPath);
  
        // Extract ZIP
        const zip = new AdmZip(zipPath);
        const extractPath = path.join(tempDir, 'extracted');
        zip.extractAllTo(extractPath, true);
        console.log("📂 ZIP extracted to:", extractPath);
  
        // Check what was extracted
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
          
          console.log("📁 Valid directories found:", validDirs);
          console.log("📄 Valid files found:", validFiles);
          
        console.log("📁 Valid directories found:", validDirs);
        console.log("📄 Valid files found:", validFiles);

        if (validFiles.length === 0 && validDirs.length === 1) {
            contentDir = path.join(extractPath, validDirs[0]);
            console.log("🎯 Using nested directory as content root:", contentDir);
          } else {
            console.log("🎯 Using extract path as content root:", contentDir);
        }
        
  
        // List all items in content directory
        const contentItems = fs.readdirSync(contentDir);
        console.log("📄 Items in content directory:", contentItems);
  
        // Track all files for ownership
        const allFiles = [];
        function collectFiles(dir, relativePath = '') {
          console.log(`🔍 Scanning directory: ${dir} (relative: ${relativePath})`);
          const items = fs.readdirSync(dir);
          
          for (const item of items) {
            if (item.startsWith('.') || item.startsWith('__MACOSX')) {
              console.log(`⏭️ Skipping system file/folder: ${item}`);
              continue;
            }
            
            const fullPath = path.join(dir, item);
            const relPath = path.join(relativePath, item).replace(/\\/g, '/');
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory()) {
              console.log(`📁 Found directory: ${item} -> ${relPath}`);
              collectFiles(fullPath, relPath);
            } else {
              console.log(`📄 Found file: ${item} -> ${relPath} (${stats.size} bytes)`);
              allFiles.push(relPath);
              file_ownership[relPath] = userId;
            }
          }
        }
        
        collectFiles(contentDir);
        console.log("✅ Total files collected:", allFiles.length);
        console.log("📋 File list:", allFiles);
  
        // Add metadata file
        const metaPath = path.join(contentDir, 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify({
          ...(metadata ? JSON.parse(metadata) : {}),
          owner: userId,
          created: new Date().toISOString(),
          type: 'webapp-zip',
          fileCount: allFiles.length,
          structure: allFiles
        }, null, 2));
  
        console.log("🚀 Uploading to IPFS from:", contentDir);
        
        // Upload to IPFS
        const result = await execPromise(`ipfs add -r .`, contentDir);
        console.log("📡 IPFS add result:", result);
        
        const lines = result.trim().split('\n');
        const cid = lines[lines.length - 1].split(' ')[1];
        console.log("🎉 Final CID:", cid);
  
        // Update mappings
        const oldCID = dns_map[dns]?.cid;
        dns_map[dns] = {
          cid,
          owner: userId,
          created: dns_map[dns]?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
          type: 'webapp-zip',
          fileCount: allFiles.length
        };
  
        if (!cid_history[dns]) cid_history[dns] = [];
        cid_history[dns].push({
          cid,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: 'ZIP upload',
          fileCount: allFiles.length
        });
  
        if (!user_directories[userId].dns.includes(dns)) {
          user_directories[userId].dns.push(dns);
        }
  
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(req.file.path);
        saveData();
  
        return res.json({ 
          dns, 
          cid, 
          oldCID, 
          version: cid_history[dns].length,
          fileCount: allFiles.length,
          structure: allFiles
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

// ========== Content Resolution ==========
app.post('/resolve-ipfs', async (req, res) => {
  let { cid, filePath = '' } = req.body;
  
  // Special handling for user folder websites
  if (filePath.includes('websites/') && filePath.includes('data/data.json')) {
    // This is a request for website data in a user folder
    const pathParts = filePath.split('/');
    const websiteIndex = pathParts.indexOf('websites');
    
    if (websiteIndex >= 0 && pathParts.length > websiteIndex + 2) {
      const websiteName = pathParts[websiteIndex + 1];
      
      // Check if this website exists in DNS mapping
      const site = Object.values(dns_map).find(s => 
        s.type === 'user-folder-website' && 
        s.folder_path === `websites/${websiteName}`
      );
      
      if (site) {
        // Get current folder CID
        const currentFolderCID = user_folders[site.user_folder]?.cid;
        if (currentFolderCID) {
          cid = currentFolderCID;
          console.log(`Redirecting to current folder CID: ${currentFolderCID} for path: ${filePath}`);
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
        <a href="https://synqstorage.trustgrid.com:3000/">← Back to Platform</a>
      </body>
      </html>
    `);
  }
  
  if (site.type === 'user-folder-website' && site.user_folder) {
    // Get current folder CID using our tracking system
    let currentFolderCID = user_folders[site.user_folder]?.cid;
    
    // Double-check with website CID mapping
    if (website_cid_mapping[dns]) {
      currentFolderCID = website_cid_mapping[dns].current_folder_cid;
    }
    
    if (!currentFolderCID) {
      return res.status(404).send('User folder not found');
    }
    
    // Build the correct URL
    const websiteURL = `https://uservault.trustgrid.com:8080/ipfs/${currentFolderCID}/${site.folder_path}`;
    console.log(`🔗 Redirecting ${dns} to current CID: ${currentFolderCID}`);
    return res.redirect(websiteURL);
  } else {
    // Traditional direct IPFS website
    return res.redirect(`https://uservault.trustgrid.com:8080/ipfs/${site.cid}`);
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

app.get('/user/:alias', (req, res) => {
  const alias = req.params.alias;
  const user = getUserByAlias(alias);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Return public profile info
  res.json({
    alias,
    folder: {
      cid: user.folder.cid,
      created: user.folder.created,
      websites_count: user.folder.websites_count || 0,
      gateway_url: `http://localhost:8080/ipfs/${user.folder.cid}`,
      platform_url: `http://localhost:3000/user-folder/${alias}`
    },
    websites: user.directory.dns.map(dns => ({
      dns,
      cid: dns_map[dns]?.cid,
      type: dns_map[dns]?.type,
      created: dns_map[dns]?.created
    }))
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

app.get('/ipfs/:cid/*?', (req, res) => {
  const requestedCID = req.params.cid;
  const path = req.params[0] || '';
  
  // Check if this is an old CID that needs redirecting
  if (cid_redirects[requestedCID]) {
    const currentCID = cid_redirects[requestedCID];
    const redirectURL = `https://uservault.trustgrid.com:8080/ipfs/${currentCID}/${path}`;
    console.log(`🔄 CID Redirect: ${requestedCID} → ${currentCID}`);
    return res.redirect(301, redirectURL);
  }
  
  // If no redirect needed, proxy to IPFS gateway
  const ipfsURL = `https://uservault.trustgrid.com:8080/ipfs/${requestedCID}/${path}`;
  return res.redirect(ipfsURL);
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
